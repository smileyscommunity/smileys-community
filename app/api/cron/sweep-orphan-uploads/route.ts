import { NextRequest, NextResponse } from 'next/server'
import { readdir, stat, unlink } from 'fs/promises'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { uploadRoot } from '@/lib/uploadRoot'
import { recordCronRun } from '@/lib/cronHealth'

// Nightly reaper for orphaned applicant photos. app/api/apply/upload is
// unauthenticated (30/hour/IP) and writes every photo an applicant picks into
// <uploadRoot>/applications/ — re-picks, abandoned forms and junk included —
// and nothing removed a file the application never ended up referencing.
//
// A file is deleted only when ALL of these hold:
//   - it is a regular file with an image name the upload route could have
//     written (anything else in the folder is left alone and counted);
//   - its mtime is older than MIN_AGE_MS, so an applicant still filling in
//     the form after uploading keeps their photo;
//   - no column in REFERENCE_COLUMNS mentions its filename after an
//     `applications/` path segment.
// The reference scan runs AFTER the directory listing, so a row written
// mid-sweep is still seen. If any reference query fails the run throws before
// deleting anything — a referenced file must never go.
//
// Out of scope: the member upload folders (users/, events/, clubs/, …). Those
// files are referenced from many more places and uploaded by signed-in
// members under their own rate limits; reaping them needs its own reference
// map. This sweep only ever reads and deletes inside applications/.
//
// Dry run: `?dryRun=1` or a JSON body `{ "dryRun": true }` returns the list it
// would delete and deletes nothing.
//
// Auth: requires `Authorization: Bearer <CRON_SECRET>`. If CRON_SECRET is
// unset, the endpoint refuses with 503 so a misconfigured prod doesn't
// silently leave the sweeper open to the internet.

export const dynamic = 'force-dynamic'

// Cron secret check delegated to lib/cronAuth.ts so the comparison is
// constant-time (timingSafeEqual) instead of `!==`. See that file for
// the rationale.
import { checkCronAuth } from '@/lib/cronAuth'

const MIN_AGE_MS = 48 * 60 * 60 * 1000
const MAX_DELETIONS_PER_RUN = 500

// Same shape the upload route writes (`<ms>-<hex>.jpg`) and the file route
// will serve. Anything else is not ours to judge.
const IMAGE_FILE = /^[\w-]+\.(jpg|jpeg|png|webp|gif)$/i

// Every column that can hold an applications/ path, as [table, column] in the
// database's own names (the @@map'd table, the camelCase column). The two
// that really do: the application's own photo, and a member avatar from
// before approval started promoting photos into users/ (lib/promotePhoto;
// scripts/fix-revoked-member-avatars.ts shows such rows survive). The rest are
// every other image, URL, rich-text or JSON column a staff member could have
// pasted an upload URL into — today's validators refuse applications/ for
// them, but rows written before those validators existed were never
// rewritten, and over-keeping a file costs nothing. tests/scan4Ops.test.ts
// pins each pair against prisma/schema.prisma.
const REFERENCE_COLUMNS: readonly (readonly [table: string, column: string])[] = [
  ['member_applications', 'profilePhoto'],
  ['users',               'profilePhoto'],
  ['testimonials',        'photo'],
  ['story_photos',        'url'],
  ['event_photos',        'url'],
  ['club_photos',         'url'],
  ['club_resources',      'url'],
  ['clubs',               'coverImage'],
  ['events',              'coverImage'],
  ['events',              'description'],
  ['posts',               'coverImage'],
  ['posts',               'body'],
  ['cities',              'heroImage'],
  ['partners',            'logo'],
  ['partners',            'coverImage'],
  ['campaigns',           'coverImage'],
  ['cup_sponsors',        'logoUrl'],
  ['cup_prizes',          'imageUrl'],
  ['direct_messages',     'imageUrl'],
  ['neighborhood_posts',  'imageUrl'],
  ['listings',            'photo'],
  ['listings',            'photos'],
  ['hangouts',            'photo'],
  ['businesses',          'logo'],
  ['businesses',          'coverImage'],
  ['moving_sales',        'photo'],
  ['reports',             'screenshot'],
  ['guide_entries',       'content'],
  ['app_settings',        'value'],
  ['newsletters',         'bodyHtml'],
  ['audit_logs',          'meta'],
]

// Filenames after an `applications/` segment, whatever prefix precedes it
// (`/app/api/files/`, the pre-lockdown `/app/uploads/`, a bare path). Lower-
// cased so a case difference can only ever keep a file, never delete one.
const REF_NAME = /applications\/([\w.-]+)/gi

function referencedNames(values: readonly (string | null)[]): Set<string> {
  const names = new Set<string>()
  for (const v of values) {
    if (!v) continue
    for (const m of v.matchAll(REF_NAME)) names.add(m[1].replace(/\.+$/, '').toLowerCase())
  }
  return names
}

async function loadReferences(): Promise<Set<string>> {
  const values: (string | null)[] = []
  for (const [table, column] of REFERENCE_COLUMNS) {
    // Identifiers come from the constant list above, never from input. ::text
    // covers text, text[] (listings.photos) and jsonb alike.
    const rows = await prisma.$queryRawUnsafe<{ v: string | null }[]>(
      `SELECT "${column}"::text AS v FROM "${table}" WHERE "${column}"::text LIKE '%applications/%'`,
    )
    for (const r of rows) values.push(r.v)
  }
  return referencedNames(values)
}

// The last look before a delete. The reference scan in runSweep is a snapshot
// taken before up to MAX_DELETIONS_PER_RUN unlinks, and an application
// submitted in between must keep its photo. Only the two columns written with
// an applications/ path today need the second look. ILIKE, and `_` matching
// any character, can only ever keep a file, never delete one.
async function stillReferenced(name: string): Promise<boolean> {
  const pattern = `%applications/${name}%`
  const rows = await prisma.$queryRaw<{ hit: number }[]>`
    SELECT 1 AS hit FROM member_applications WHERE "profilePhoto" ILIKE ${pattern}
    UNION ALL
    SELECT 1 AS hit FROM users WHERE "profilePhoto" ILIKE ${pattern}
    LIMIT 1`
  return Array.isArray(rows) && rows.length > 0
}

async function runSweep(dryRun: boolean) {
  const dir = join(uploadRoot(), 'applications')
  let entries: import('fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (e) {
    // No folder yet (fresh box, nothing ever uploaded) is an empty run.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { dryRun, scanned: 0, skippedUnrecognised: 0, tooNew: 0, referenced: 0, eligible: 0, deleted: 0, failed: 0, deferred: 0, wouldDelete: [] as string[] }
    }
    throw e
  }

  const cutoff = Date.now() - MIN_AGE_MS
  let skippedUnrecognised = 0
  let tooNew = 0
  const old: string[] = []
  for (const ent of entries) {
    if (!ent.isFile() || !IMAGE_FILE.test(ent.name)) { skippedUnrecognised++; continue }
    try {
      if ((await stat(join(dir, ent.name))).mtimeMs >= cutoff) { tooNew++; continue }
    } catch {
      continue   // vanished between readdir and stat
    }
    old.push(ent.name)
  }

  // Throws on any failed query — before a single unlink.
  const refs = await loadReferences()
  const orphans = old.filter(name => !refs.has(name.toLowerCase())).sort()
  const referenced = old.length - orphans.length
  const batch = orphans.slice(0, MAX_DELETIONS_PER_RUN)
  const deferred = orphans.length - batch.length

  let deleted = 0
  let failed = 0
  let rescued = 0
  if (!dryRun) {
    for (const name of batch) {
      try {
        // References first, then the age, then the delete at once. The apply
        // route refreshes a photo's mtime as it claims it, so an application
        // being submitted right now shows up in one check or the other.
        if (await stillReferenced(name)) { rescued++; continue }
        if ((await stat(join(dir, name))).mtimeMs >= cutoff) { rescued++; continue }
        await unlink(join(dir, name))
        deleted++
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
        failed++
        console.error('[cron sweep-orphan-uploads] could not delete', name, e)
      }
    }
  }

  const counts = { dryRun, scanned: entries.length, skippedUnrecognised, tooNew, referenced, eligible: orphans.length, deleted, failed, deferred, rescued }
  console.log('[cron sweep-orphan-uploads]', JSON.stringify(counts))
  return { ...counts, wouldDelete: dryRun ? batch : [] }
}

async function wantsDryRun(req: NextRequest): Promise<boolean> {
  const q = req.nextUrl.searchParams.get('dryRun')
  if (q === '1' || q === 'true') return true
  try {
    const body = await req.json()
    return body?.dryRun === true
  } catch {
    return false   // no body / not JSON — the cron wrapper sends none
  }
}

export async function POST(req: NextRequest) {
  const denied = await checkCronAuth(req)
  if (denied) return denied

  const dryRun = await wantsDryRun(req)
  try {
    const result = await runSweep(dryRun)
    // A dry run is a human looking, not the nightly run: stamping it would
    // tell the staleness check the reaper ran when it deleted nothing.
    if (!dryRun) await recordCronRun('sweep-orphan-uploads', result.failed === 0)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-orphan-uploads]', e)
    if (!dryRun) await recordCronRun('sweep-orphan-uploads', false, e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}

// No GET handler: the old "?key=<CRON_SECRET>" browser-testing path put
// the secret in query strings (nginx access logs, browser history) — the
// same class as the 2026-08 DB-password-in-crontab incident. Test with:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" <url>?dryRun=1
