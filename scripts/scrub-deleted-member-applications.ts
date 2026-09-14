// Scrub PII from the MemberApplication rows of members who already deleted
// their own account. Until 2026-09-14 self-deletion (app/api/auth/delete-account)
// nulled only phone/instagram/bio/photo on the application, leaving full name,
// email and every free-text answer behind. The route now scrubs the whole row
// (lib/applicationScrub); this backfills the accounts deleted before that.
//
// How an application is linked to a deleted account (applications have no
// userId — they are keyed by email):
//   - a deleted account is a user row with banReason='deleted' AND a
//     `…@deleted.smileys` email (the self-delete tombstone), paired with its
//     `account.self_delete` audit row, whose meta.email is the original address;
//   - SURE:   the application already carries that tombstone address (partly
//             scrubbed), OR its email equals the original address
//             (case-insensitive), it was created before the deletion, and no
//             live account uses that address today;
//   - UNSURE: the address matches but a live account now uses it (they may have
//             come back), or the application is newer than the deletion, or a
//             tombstone address matches no deleted account. Listed, never written.
// Out of scope: accounts removed by an admin (user.remove hard-deletes the
// user). Their application is the re-apply signal for vetting; scrubbing those
// is a product call, not hygiene.
//
// Output is ids and FIELD NAMES only — never a name, email or answer.
//
//   (default)  read-only: list rows still holding PII, with verdict + fields
//   APPLY=1    scrub SURE rows only, each guarded on id + the email seen
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/scrub-deleted-member-applications.ts
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/scrub-deleted-member-applications.ts

import { prisma } from '@/lib/prisma'
import {
  APPLICATION_PII_NULLABLE_FIELDS, TOMBSTONE_EMAIL_SUFFIX,
  applicationPiiFields, applicationScrubData, isTombstoneEmail,
  type ApplicationPiiRow, type ApplicationPiiField,
} from '@/lib/applicationScrub'

const APPLY_MODE = process.env.APPLY === '1'

export interface DeletedAccount {
  userId:         string
  tombstoneEmail: string
  originalEmail:  string | null   // from the account.self_delete audit meta
  deletedAt:      Date | null     // that audit row's createdAt
}

export type ApplicationFacts = ApplicationPiiRow & { id: string; createdAt: Date }

export interface PlannedScrub {
  id:             string
  verdict:        'sure' | 'unsure'
  reason:         string
  piiFields:      ApplicationPiiField[]
  userId:         string | null
  tombstoneEmail: string | null
  seenEmail:      string          // guard value for APPLY; never printed
}

/** Pure: which applications still hold PII, and which of them are SURE to be a deleted member's. */
export function planApplicationScrub(input: {
  apps:       ApplicationFacts[]
  deleted:    DeletedAccount[]
  liveEmails: Set<string>          // lowercased addresses of live (non-tombstone) users
}) {
  const byTombstone = new Map(input.deleted.map(d => [d.tombstoneEmail.toLowerCase(), d]))
  const rows: PlannedScrub[] = []
  let clean = 0

  for (const app of input.apps) {
    const piiFields = applicationPiiFields(app)
    const e = app.email.toLowerCase()
    const base = { id: app.id, piiFields, seenEmail: app.email }

    if (isTombstoneEmail(e)) {
      if (piiFields.length === 0) { clean++; continue }
      const d = byTombstone.get(e)
      rows.push(d
        ? { ...base, verdict: 'sure', reason: 'already linked to the tombstone address', userId: d.userId, tombstoneEmail: d.tombstoneEmail }
        : { ...base, verdict: 'unsure', reason: 'tombstone address matches no deleted account', userId: null, tombstoneEmail: null })
      continue
    }

    const matches = input.deleted.filter(d => d.originalEmail?.toLowerCase() === e)
    if (matches.length === 0) continue          // not a deleted member's application
    if (piiFields.length === 0) { clean++; continue }

    if (input.liveEmails.has(e)) {
      rows.push({ ...base, verdict: 'unsure', reason: 'a live account uses this address now', userId: matches[0].userId, tombstoneEmail: null })
      continue
    }
    const eligible = matches
      .filter(d => d.deletedAt && app.createdAt.getTime() <= d.deletedAt.getTime())
      .sort((a, b) => a.deletedAt!.getTime() - b.deletedAt!.getTime())
    if (eligible.length === 0) {
      rows.push({ ...base, verdict: 'unsure', reason: 'application is newer than the deletion (or deletion time unknown)', userId: matches[0].userId, tombstoneEmail: null })
      continue
    }
    rows.push({ ...base, verdict: 'sure', reason: 'original address of a self-deleted account', userId: eligible[0].userId, tombstoneEmail: eligible[0].tombstoneEmail })
  }

  return {
    rows,
    counts: {
      listed:              rows.length,
      sure:                rows.filter(r => r.verdict === 'sure').length,
      unsure:              rows.filter(r => r.verdict === 'unsure').length,
      alreadyClean:        clean,
      deletedAccounts:     input.deleted.length,
      deletedWithoutEmail: input.deleted.filter(d => !d.originalEmail).length,
    },
  }
}

async function load() {
  const users = await prisma.user.findMany({
    where:  { banReason: 'deleted', email: { endsWith: TOMBSTONE_EMAIL_SUFFIX } },
    select: { id: true, email: true },
  })
  const audits = users.length === 0 ? [] : await prisma.auditLog.findMany({
    where:   { action: 'account.self_delete', targetId: { in: users.map(u => u.id) } },
    select:  { targetId: true, createdAt: true, meta: true },
    orderBy: { createdAt: 'asc' },
  })
  const auditBy = new Map(audits.map(a => [a.targetId, a]))
  const deleted: DeletedAccount[] = users.map(u => {
    const a = auditBy.get(u.id)
    const meta = (a?.meta ?? null) as { email?: unknown } | null
    return {
      userId:         u.id,
      tombstoneEmail: u.email,
      originalEmail:  typeof meta?.email === 'string' && meta.email ? meta.email : null,
      deletedAt:      a?.createdAt ?? null,
    }
  })

  const originals = [...new Set(deleted.map(d => d.originalEmail?.toLowerCase()).filter((e): e is string => !!e))]
  const live = await prisma.$queryRaw<{ e: string }[]>`
    SELECT lower(email) AS e FROM users WHERE lower(email) = ANY(${originals}::text[])`
  const ids = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM member_applications
    WHERE lower(email) = ANY(${originals}::text[]) OR lower(email) LIKE ${'%' + TOMBSTONE_EMAIL_SUFFIX}`

  const select = {
    id: true, createdAt: true, email: true, fullName: true, firstName: true, lastName: true,
    ...Object.fromEntries(APPLICATION_PII_NULLABLE_FIELDS.map(f => [f, true])),
  }
  const apps = ids.length === 0 ? [] : await prisma.memberApplication.findMany({
    where: { id: { in: ids.map(r => r.id) } },
    select,
  }) as unknown as ApplicationFacts[]

  return { apps, deleted, liveEmails: new Set(live.map(r => r.e)) }
}

async function main() {
  console.log(APPLY_MODE
    ? 'APPLY — scrubbing SURE rows only\n'
    : 'READ-ONLY — nothing is written. APPLY=1 scrubs the SURE rows.\n')
  const { rows, counts } = planApplicationScrub(await load())

  // Every row, never truncated. Ids and field names only.
  for (const r of rows) {
    console.log(`  ${r.id} ${r.verdict.toUpperCase().padEnd(6)} user=${r.userId ?? '-'} fields=${r.piiFields.join(',')} — ${r.reason}`)
  }
  console.log(`\nsummary: listed=${counts.listed} sure=${counts.sure} unsure=${counts.unsure} alreadyClean=${counts.alreadyClean}` +
    ` deletedAccounts=${counts.deletedAccounts} (without a recorded original email: ${counts.deletedWithoutEmail})`)

  if (!APPLY_MODE) return
  let scrubbed = 0, skipped = 0
  for (const r of rows) {
    if (r.verdict !== 'sure' || !r.tombstoneEmail) continue
    // Guarded on the email we planned from: a row edited since the read is left alone.
    const { count } = await prisma.memberApplication.updateMany({
      where: { id: r.id, email: r.seenEmail },
      data:  applicationScrubData(r.tombstoneEmail),
    })
    if (count) scrubbed++
    else skipped++
  }
  console.log(`\napplied: scrubbed=${scrubbed} skipped=${skipped} (row changed since the read)`)
}

// Only run as a CLI — tests import planApplicationScrub.
if (/scrub-deleted-member-applications\.ts$/.test(process.argv[1] ?? '')) {
  main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
}
