// Relink approved applications left behind under a member's OLD email address.
//
// Applications have no userId — they are keyed by email. Until 2026-09-15 a
// member who changed their address (self-service or an admin edit) kept their
// application under the old one, so it matched no user and looked like a
// departed member's. That state is what let scrub-orphaned-approved-applications
// erase six live members' applications on 2026-09-14, and it hides the row from
// self-deletion's scrub. Both change paths now move the application; this
// repairs the rows changed before that.
//
// An application is relinked only on strong evidence:
//   · its email matches no user row at all (any status), it is approved, and it
//     is not a scrubbed tombstone;
//   · its fullName (trimmed, case-insensitive) AND its phone (exact) both match
//     the SAME single live account — not banned, not self-deleted.
// Everything weaker is AMBIGUOUS and never written: several accounts match both,
// or only the name, or only the phone, or name and phone point at different
// accounts. Rows with no candidate at all are counted, not listed.
//
// Output is application ids, user ids and the match basis — never a name,
// email or phone.
//
//   (default)  read-only: list RELINK and AMBIGUOUS rows
//   APPLY=1    set each RELINK row's email to the account's current address,
//              guarded on id + the old email seen
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/relink-email-changed-applications.ts
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/relink-email-changed-applications.ts
//
// Run on the server: a local .env points at a stale dev copy.

import { prisma } from '@/lib/prisma'
import { isTombstoneEmail } from '@/lib/applicationScrub'

const APPLY_MODE = process.env.APPLY === '1'

export interface RelinkApplication {
  id:       string
  email:    string
  fullName: string
  phone:    string | null
}

export interface RelinkUser {
  id:        string
  email:     string
  name:      string
  phone:     string | null
  status:    string
  banReason: string | null
}

export type RelinkRow =
  | { id: string; verdict: 'relink'; userId: string; basis: 'name+phone'; seenEmail: string; newEmail: string }
  | { id: string; verdict: 'ambiguous'; basis: string; candidates: string[] }

// Self-deleted accounts are status 'banned' too; banReason is checked on its
// own so a NULL never reads as "not deleted" by accident (the 2026-09-14 trap).
export function isLiveUser(u: Pick<RelinkUser, 'status' | 'banReason' | 'email'>): boolean {
  return u.status !== 'banned' && u.banReason !== 'deleted' && !isTombstoneEmail(u.email)
}

const normName = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/** Pure: which applications are a live member's under an old address, and which are only suspected. */
export function planRelink(input: { apps: RelinkApplication[]; users: RelinkUser[] }) {
  const anyUserEmail = new Set(input.users.map(u => u.email.toLowerCase()))
  const live = input.users.filter(isLiveUser)
  const rows: RelinkRow[] = []
  let linked = 0, tombstones = 0, unmatched = 0

  for (const app of input.apps) {
    const e = app.email.toLowerCase()
    if (isTombstoneEmail(e)) { tombstones++; continue }
    if (anyUserEmail.has(e)) { linked++; continue }

    const name = normName(app.fullName)
    const phone = app.phone && app.phone.trim() !== '' ? app.phone : null
    const byName  = name  ? live.filter(u => normName(u.name) === name) : []
    const byPhone = phone ? live.filter(u => u.phone === phone) : []
    const both = byName.filter(u => byPhone.includes(u))

    if (both.length === 1 && both[0].email.toLowerCase() !== e) {
      rows.push({ id: app.id, verdict: 'relink', userId: both[0].id, basis: 'name+phone', seenEmail: app.email, newEmail: both[0].email })
    } else if (both.length > 1) {
      rows.push({ id: app.id, verdict: 'ambiguous', basis: `name+phone match ${both.length} accounts`, candidates: both.map(u => u.id) })
    } else if (byName.length && byPhone.length) {
      rows.push({ id: app.id, verdict: 'ambiguous', basis: 'name and phone match different accounts', candidates: [...new Set([...byName, ...byPhone].map(u => u.id))] })
    } else if (byName.length) {
      rows.push({ id: app.id, verdict: 'ambiguous', basis: phone ? 'name only (phone differs)' : 'name only (application has no phone)', candidates: byName.map(u => u.id) })
    } else if (byPhone.length) {
      rows.push({ id: app.id, verdict: 'ambiguous', basis: 'phone only (name differs)', candidates: byPhone.map(u => u.id) })
    } else {
      unmatched++
    }
  }

  return {
    rows,
    counts: {
      applications: input.apps.length,
      relink:       rows.filter(r => r.verdict === 'relink').length,
      ambiguous:    rows.filter(r => r.verdict === 'ambiguous').length,
      linked, tombstones, unmatched,
    },
  }
}

async function main() {
  console.log(APPLY_MODE
    ? 'APPLY — relinking RELINK rows only\n'
    : 'READ-ONLY — nothing is written. APPLY=1 relinks the RELINK rows.\n')

  const apps = await prisma.memberApplication.findMany({
    where:  { status: 'approved' },
    select: { id: true, email: true, fullName: true, phone: true },
  })
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, phone: true, status: true, banReason: true },
  })
  const { rows, counts } = planRelink({ apps, users })

  // Every row, never truncated. Ids and basis only.
  for (const r of rows) {
    if (r.verdict === 'relink') console.log(`  ${r.id} RELINK    user=${r.userId} basis=${r.basis}`)
    else console.log(`  ${r.id} AMBIGUOUS candidates=${r.candidates.join(',')} basis=${r.basis}`)
  }
  console.log(`\nsummary: approvedApplications=${counts.applications} relink=${counts.relink} ambiguous=${counts.ambiguous}` +
    ` linked=${counts.linked} tombstones=${counts.tombstones} noCandidate=${counts.unmatched}`)

  if (!APPLY_MODE) { console.log('\nDRY RUN — nothing written.'); return }
  let relinked = 0, skipped = 0
  for (const r of rows) {
    if (r.verdict !== 'relink') continue
    // Guarded on the address we planned from: a row edited since the read is left alone.
    const { count } = await prisma.memberApplication.updateMany({
      where: { id: r.id, email: r.seenEmail },
      data:  { email: r.newEmail },
    })
    if (count) relinked++
    else skipped++
  }
  console.log(`\napplied: relinked=${relinked} skipped=${skipped} (row changed since the read)`)
}

// Only run as a CLI — tests import planRelink.
if (/relink-email-changed-applications\.ts$/.test(process.argv[1] ?? '')) {
  main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
}
