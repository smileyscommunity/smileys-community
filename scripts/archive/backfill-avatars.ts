// One-off: move existing members' avatars out of the gated applications/
// folder into users/, so the file route can be locked down to admin-only for
// applications/ without 404-ing real members' avatars.
//
// Context: approval used to copy the applicant's applications/<file> URL
// straight onto the new member's profilePhoto. The file route then served
// those by trusting the user-writable profilePhoto column — a bypassable gate
// (any approved member could unlock an arbitrary applicant photo). The route
// is being locked to admin-only; this migrates every already-approved member
// first so none of them breaks. Reuses lib/promotePhoto so the copy + rename
// is identical to what the (fixed) approval flow now does for new members.
//
// Ordering: run this against prod with the CURRENT code still deployed, BEFORE
// deploying the locked-down route. Nothing breaks under the old code (members
// simply move to ungated users/ URLs), and after the migration the new code
// has nothing left pointing into applications/.
//
// Idempotent: a second run finds no applications/ photos and does nothing. The
// UPDATE is guarded on the exact prior value, so a concurrent profile edit
// can't be clobbered.
//
// Dry run by default (prints the plan, copies nothing, writes nothing):
//   npx tsx --env-file=.env --env-file=.env.local scripts/backfill-avatars.ts
// Apply:
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/backfill-avatars.ts
import { prisma } from '../../lib/prisma'
import { promoteApplicationPhoto } from '../../lib/promotePhoto'

const APPLY = process.env.APPLY === '1'

async function main() {
  console.log(APPLY ? '⚠️  APPLY MODE — copying files and writing to the database\n' : '🔍 DRY RUN — no copies, no writes (set APPLY=1 to commit)\n')

  // Scope to approved members deliberately. Today's file-route gate only
  // serves an applications/ photo publicly when it belongs to an APPROVED
  // member; pending/rejected applicants' photos are already 403 to everyone
  // but admins. Migrating only approved members preserves that exact
  // visibility set — the handful of non-approved applications/ photos stay
  // gated (admin-only) rather than being newly exposed under an ungated
  // users/ URL. If such an applicant is later approved, the approval flow
  // promotes their photo then.
  const users = await prisma.user.findMany({
    where:  { status: 'approved', profilePhoto: { contains: '/api/files/applications/' } },
    select: { id: true, name: true, status: true, profilePhoto: true },
    orderBy: { joinedAt: 'asc' },
  })
  console.log(`Approved members with an applications/ avatar: ${users.length}\n`)

  let migrated = 0, missing = 0, skipped = 0

  for (const u of users) {
    const oldUrl = u.profilePhoto!
    if (!APPLY) {
      // Dry run: report the intent without copying. (promoteApplicationPhoto
      // would perform the copy, so it isn't called here.)
      console.log(`[dry] ${u.name} (${u.status}): ${oldUrl}  →  users/…`)
      migrated++
      continue
    }

    const newUrl = await promoteApplicationPhoto(oldUrl)
    if (newUrl === oldUrl) {
      // Helper returns the original on a missing/unreadable source file.
      console.warn(`⚠️  ${u.name} (${u.id}): source file missing, left as-is: ${oldUrl}`)
      missing++
      continue
    }
    const res = await prisma.user.updateMany({
      where: { id: u.id, profilePhoto: oldUrl },   // guard: exact prior value
      data:  { profilePhoto: newUrl },
    })
    if (res.count === 1) {
      console.log(`✓ ${u.name} (${u.status}): → ${newUrl}`)
      migrated++
    } else {
      console.warn(`· ${u.name} (${u.id}): changed concurrently, skipped`)
      skipped++
    }
  }

  console.log(`\nDone. ${APPLY ? 'migrated' : 'would migrate'}=${migrated} missing=${missing} skipped=${skipped}`)
  if (!APPLY && migrated > 0) console.log('Re-run with APPLY=1 to commit — then deploy the locked-down route.')
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
