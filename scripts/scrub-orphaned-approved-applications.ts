// Scrub PII from approved applications whose member is gone and who cannot be
// reached by scrub-deleted-member-applications.
//
// That script matches an application to a self-deleted account by email, using
// the account.self_delete audit row to recover the original address. Six
// tombstoned accounts have no audit row at all — they were deleted before it
// was written — and their tombstone address is a random ghost id, so there is
// no key back to the application. They cannot be matched one by one.
//
// They can be bounded. An approved application whose email matches no user row
// belonged to a member who existed and is now gone. Subtract the ones explained
// by a user.remove audit row — admin removals, whose application is the
// re-apply vetting signal and deliberately kept — and what remains is accounts
// that left without an admin doing it. The six are inside that set.
//
// Two things were checked before treating the set as safe (2026-09-14):
//   · none of them matches a live, non-deleted account by name or phone, so
//     none is an active member who merely changed their email address;
//   · admin-removal auditing runs from 2026-05-12 and the audit log itself
//     begins 2026-05-08, so only a removal inside that six-day window could
//     have gone unaudited. One row (an application dated 2026-05-06) sits near
//     enough to that window to be the single case worth knowing about.
//
// Output is ids and FIELD NAMES only — never a name, email or answer.
//
//   (default)  read-only: list the rows, verdicts and field counts
//   APPLY=1    scrub, each row guarded on id + the email seen
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/scrub-orphaned-approved-applications.ts
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/scrub-orphaned-approved-applications.ts
//
// Run on the server: a local .env points at a stale dev copy.
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import {
  APPLICATION_PII_NULLABLE_FIELDS, TOMBSTONE_EMAIL_SUFFIX,
  applicationPiiFields, applicationScrubData,
} from '@/lib/applicationScrub'

const APPLY = process.env.APPLY === '1'

const SELECT = {
  id: true, email: true, status: true, createdAt: true,
  fullName: true, firstName: true, lastName: true,
  ...Object.fromEntries(APPLICATION_PII_NULLABLE_FIELDS.map(f => [f, true])),
} as const

async function main() {
  console.log(APPLY ? 'APPLY — scrubbing\n' : 'READ-ONLY — nothing is written. APPLY=1 scrubs.\n')

  const apps = await prisma.memberApplication.findMany({ where: { status: 'approved' }, select: SELECT as never })
  const userEmails = new Set((await prisma.user.findMany({ select: { email: true } })).map(u => u.email.toLowerCase()))

  // Emails an admin removal recorded. Those applications stay.
  const removed = new Set<string>()
  for (const r of await prisma.auditLog.findMany({ where: { action: 'user.remove' }, select: { meta: true } })) {
    const m = (r.meta && typeof r.meta === 'object') ? r.meta as Record<string, unknown> : {}
    if (typeof m.email === 'string' && m.email) removed.add(m.email.toLowerCase())
  }

  const targets = (apps as any[]).filter(a => {
    const e = String(a.email).toLowerCase()
    return !userEmails.has(e) && !removed.has(e) && applicationPiiFields(a).length > 0
  })

  for (const a of targets) {
    console.log(`  ${a.id}  created=${a.createdAt.toISOString().slice(0, 10)}  piiFields=${applicationPiiFields(a).length}`)
  }
  console.log(`\nsummary: approved=${apps.length} orphaned+unexplained+holdingPii=${targets.length}` +
    ` (admin removals excluded: ${removed.size} recorded)`)

  if (!APPLY) { console.log('\nDRY RUN — nothing written.'); return }

  let scrubbed = 0, skipped = 0
  for (const a of targets) {
    // A fresh ghost per row, the same shape self-deletion writes, so the row is
    // indistinguishable from one scrubbed by the route.
    const ghost = `deleted_${randomBytes(6).toString('hex')}${TOMBSTONE_EMAIL_SUFFIX}`
    const { count } = await prisma.memberApplication.updateMany({
      where: { id: a.id, email: a.email },   // guarded: a row edited since the read is left alone
      data:  applicationScrubData(ghost),
    })
    if (count) scrubbed++; else skipped++
  }
  console.log(`\napplied: scrubbed=${scrubbed} skipped=${skipped} (row changed since the read)`)
}

main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
