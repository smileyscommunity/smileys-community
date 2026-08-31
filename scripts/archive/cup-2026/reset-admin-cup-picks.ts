// One-off: clear all CupPrediction + CupBracketPick rows for users
// with role='admin'. Use when admin accounts have been used to
// smoke-test the cup flow and the entries need to come out before
// real picks happen.
//
//   npx tsx --env-file=.env scripts/reset-admin-cup-picks.ts
//
// Idempotent in the trivial sense — re-running after zero admins
// have submitted does nothing. NOT reversible; the audit log for
// member events doesn't cover cup picks (intentional — picks are
// in-band signals, not admin actions).

import { prisma } from '@/lib/prisma'

async function main() {
  const admins = await prisma.user.findMany({
    where:  { role: 'admin' },
    select: { id: true, name: true, email: true },
  })
  if (admins.length === 0) {
    console.log('No admins found. Nothing to reset.')
    return
  }
  const adminIds = admins.map(a => a.id)
  console.log(`Found ${admins.length} admin user${admins.length === 1 ? '' : 's'}:`)
  for (const a of admins) console.log(`  · ${a.name} <${a.email}> (${a.id})`)

  // Pre-count so we can show what changed.
  const [predBefore, brackBefore] = await Promise.all([
    prisma.cupPrediction.count({ where: { userId: { in: adminIds } } }),
    prisma.cupBracketPick.count({ where: { userId: { in: adminIds } } }),
  ])
  console.log(`\nBefore reset:`)
  console.log(`  · ${predBefore} cup_predictions`)
  console.log(`  · ${brackBefore} cup_bracket_picks`)

  if (predBefore === 0 && brackBefore === 0) {
    console.log('\nNothing to delete. Done.')
    return
  }

  // One transaction — either both tables clear or neither does.
  const [delPred, delBrack] = await prisma.$transaction([
    prisma.cupPrediction.deleteMany({ where: { userId: { in: adminIds } } }),
    prisma.cupBracketPick.deleteMany({ where: { userId: { in: adminIds } } }),
  ])

  console.log(`\nDeleted:`)
  console.log(`  · ${delPred.count} cup_predictions`)
  console.log(`  · ${delBrack.count} cup_bracket_picks`)
  console.log('\nDone.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
