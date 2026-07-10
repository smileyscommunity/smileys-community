/**
 * One-off CLI wrapper around lib/regionalClubSeeding. The same logic is exposed
 * in the admin panel (Clubs → "Seed from nationality"); this is for running it
 * from the server shell.
 *
 *   DRY_RUN=true  npx tsx --env-file=.env --env-file=.env.local scripts/seed-regional-clubs.ts
 *   DRY_RUN=false npx tsx --env-file=.env --env-file=.env.local scripts/seed-regional-clubs.ts
 *   INCLUDE_TURKEY=true  ... (adds Turkey → Mediterranean; off by default)
 */
import { prisma } from '@/lib/prisma'
import { seedRegionalClubs } from '@/lib/regionalClubSeeding'

const DRY_RUN        = process.env.DRY_RUN !== 'false'
const INCLUDE_TURKEY = process.env.INCLUDE_TURKEY === 'true'

async function main() {
  const r = await seedRegionalClubs({ dryRun: DRY_RUN, includeTurkey: INCLUDE_TURKEY })
  console.log(`Turkey included: ${r.includeTurkey}`)
  console.log(`Members scanned: ${r.scanned} · desired memberships: ${r.desired} · net-new: ${r.netNew}\n`)
  console.log('Net-new members per club:')
  for (const c of r.perClub) console.log(`  ${String(c.added).padStart(4)}  ${c.name}`)
  console.log(r.written ? `\nDone. Inserted ${r.netNew} memberships and synced memberCount.` : '\nDRY_RUN — nothing written. Re-run with DRY_RUN=false to seed.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
