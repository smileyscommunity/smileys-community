// One-off: fix the users whose profilePhoto still points into the gated
// applications/ folder after the 33df1e6 lockdown.
//
// Who these rows are: scripts/backfill-avatars (run 2026-08-14) migrated every
// APPROVED member off applications/. The rows it left behind are members whose
// application was later rejected — the rejection flow demotes their user row to
// status='pending' (access revoked) — so the backfill skipped them on purpose:
// promoting a rejected applicant's photo into users/ would newly expose it,
// because the file route serves users/ with no session check at all. Their
// avatars now 403 wherever their old profile still renders (historical
// attendee lists etc.), which is the broken-image noise in the prod logs.
//
// Two remedies, chosen with ACTION:
//   ACTION=clear    (default) — null out profilePhoto. The UI falls back to the
//                   initials avatar. The photo file stays in the gated
//                   applications/ store, and the member_applications row still
//                   references it, so if the person is ever re-approved the
//                   approval flow re-promotes the photo from their application
//                   (that branch only fills profilePhoto when it is empty —
//                   which clearing guarantees).
//   ACTION=promote  — copy the file into users/ under a fresh random name and
//                   point profilePhoto there (lib/promotePhoto). NOTE: users/
//                   is world-readable through the file route; only choose this
//                   if exposing these photos publicly is acceptable.
//
// Idempotent: a second run finds no applications/ photos and does nothing.
// Every UPDATE is guarded on the exact prior value, so a concurrent change
// can't be clobbered.
//
// Dry run by default (prints the plan, copies nothing, writes nothing):
//   npx tsx --env-file=.env --env-file=.env.local scripts/fix-revoked-member-avatars.ts
// Apply:
//   APPLY=1 ACTION=clear npx tsx --env-file=.env --env-file=.env.local scripts/fix-revoked-member-avatars.ts
import { prisma } from '../lib/prisma'
import { promoteApplicationPhoto } from '../lib/promotePhoto'

const APPLY  = process.env.APPLY === '1'
const ACTION = process.env.ACTION ?? 'clear'

async function main() {
  if (ACTION !== 'clear' && ACTION !== 'promote') {
    throw new Error(`ACTION must be 'clear' or 'promote', got '${ACTION}'`)
  }
  console.log(APPLY
    ? `⚠️  APPLY MODE (${ACTION}) — writing to the database\n`
    : `🔍 DRY RUN (${ACTION}) — no copies, no writes (set APPLY=1 to commit)\n`)

  const users = await prisma.user.findMany({
    where:  { profilePhoto: { contains: '/api/files/applications/' } },
    select: { id: true, name: true, email: true, status: true, profilePhoto: true, joinedAt: true },
    orderBy: { joinedAt: 'asc' },
  })
  console.log(`Users with an applications/ avatar: ${users.length}\n`)

  let changed = 0, missing = 0, skipped = 0

  for (const u of users) {
    const oldUrl = u.profilePhoto!
    // Context for the log line: what happened to this person's application.
    const app = await prisma.memberApplication.findFirst({
      where:   { email: u.email },
      orderBy: { createdAt: 'desc' },
      select:  { status: true },
    })
    const who = `${u.name} (user:${u.status}, application:${app?.status ?? 'none'})`

    if (!APPLY) {
      console.log(`[dry] ${who}: ${oldUrl}  →  ${ACTION === 'clear' ? 'null (initials avatar)' : 'users/…'}`)
      changed++
      continue
    }

    let newValue: string | null
    if (ACTION === 'clear') {
      newValue = null
    } else {
      newValue = await promoteApplicationPhoto(oldUrl)
      if (newValue === oldUrl) {
        // Helper returns the original on a missing/unreadable source file.
        console.warn(`⚠️  ${who} (${u.id}): source file missing, left as-is: ${oldUrl}`)
        missing++
        continue
      }
    }

    const res = await prisma.user.updateMany({
      where: { id: u.id, profilePhoto: oldUrl },   // guard: exact prior value
      data:  { profilePhoto: newValue },
    })
    if (res.count === 1) {
      console.log(`✓ ${who}: ${oldUrl}  →  ${newValue ?? 'null'}`)
      changed++
    } else {
      console.warn(`· ${who} (${u.id}): changed concurrently, skipped`)
      skipped++
    }
  }

  console.log(`\nDone. ${APPLY ? 'changed' : 'would change'}=${changed} missing=${missing} skipped=${skipped}`)
  if (!APPLY && changed > 0) console.log(`Re-run with APPLY=1 ACTION=${ACTION} to commit.`)
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
