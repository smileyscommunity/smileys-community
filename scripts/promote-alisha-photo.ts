// One-off: give Alisha Khan the profile photo she uploaded when she applied.
//
// Her approval (2026-06-02) half-applied — the application row was marked
// approved but the account step never completed, so she sat at `pending` for
// three and a half months AND her applicant photo was never promoted out of
// the gated applications/ folder onto her profile. The account was fixed on
// 2026-09-23; this is the other half.
//
// Uses the same promoteApplicationPhoto helper the approval path uses, so the
// file lands in users/ under a fresh random name (the application filename
// must not be recoverable from a public avatar URL).
//
// DRY_RUN=1 to print the plan without writing.
//   npx tsx --env-file=.env --env-file=.env.local scripts/promote-alisha-photo.ts
import { prisma } from '../lib/prisma'
import { promoteApplicationPhoto } from '../lib/promotePhoto'

const USER_ID = 'cmpx1nx970008x06fle5tj330'
const DRY = process.env.DRY_RUN === '1'

async function main() {
  const user = await prisma.user.findUnique({
    where:  { id: USER_ID },
    select: { id: true, name: true, email: true, profilePhoto: true, status: true },
  })
  if (!user) throw new Error(`user ${USER_ID} not found`)

  const app = await prisma.memberApplication.findFirst({
    where:   { email: user.email, status: 'approved' },
    select:  { profilePhoto: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  console.log('user:', { id: user.id, name: user.name, status: user.status, profilePhoto: user.profilePhoto })
  console.log('application photo:', app?.profilePhoto ?? null)

  if (user.profilePhoto) {
    console.log('SKIP: the member already has a profile photo — nothing to do.')
    return
  }
  if (!app?.profilePhoto) {
    console.log('SKIP: no approved application photo to promote.')
    return
  }

  if (DRY) {
    console.log('DRY RUN: would copy the applications/ file into users/ under a new random name')
    console.log('DRY RUN: would set profilePhoto on', user.id, '(guarded on it still being empty)')
    return
  }

  const promoted = await promoteApplicationPhoto(app.profilePhoto)
  if (!promoted || promoted === app.profilePhoto) {
    throw new Error(`promotion did not produce a users/ URL (got ${promoted}) — file missing or unreadable`)
  }

  // Guarded: only writes while the column is still empty, so a photo the
  // member sets herself in the meantime always wins.
  const res = await prisma.user.updateMany({
    where: { id: user.id, OR: [{ profilePhoto: null }, { profilePhoto: '' }] },
    data:  { profilePhoto: promoted },
  })
  console.log(res.count ? `DONE: profilePhoto = ${promoted}` : 'NO-OP: the column was no longer empty')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
