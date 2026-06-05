// Bulk-delete every directory entry that was seeded but never touched
// by a real human. Criteria — ALL must be true:
//
//   1. Submitted by the admin seeder (info@smileyscommunity.com)
//   2. Missing all three of phone, address, website (never edited)
//   3. No verified owner (no approved claim)
//   4. No reviews
//   5. No pending or rejected claims
//   6. updatedAt is essentially the same as createdAt — i.e. nobody
//      has touched the row since it was inserted. This protects rows
//      that were created via seed but then verified + corrected later
//      (e.g. the Reyhoon move from Nişantaşı → Beyoğlu).
//
// Saves (BusinessSave) are NOT exclusion criteria — a member can save
// a placeholder entry without that validating its authenticity. Saves
// cascade-delete with the business row.
//
// Default mode is dry-run. Re-run with --delete to actually remove
// rows.
//
// Run on prod:
//   ssh root@<server> 'cd /root/smileys-community && \
//     DATABASE_URL=$(grep ^DATABASE_URL .env | sed "s/^DATABASE_URL=//" | tr -d "\"") \
//     npx tsx scripts/cleanup-seed-directory.ts'        # dry run
//
//   ssh root@<server> 'cd /root/smileys-community && \
//     DATABASE_URL=$(grep ^DATABASE_URL .env | sed "s/^DATABASE_URL=//" | tr -d "\"") \
//     npx tsx scripts/cleanup-seed-directory.ts --delete'  # actually delete

import { prisma } from '@/lib/prisma'

const DELETE = process.argv.includes('--delete')
const ADMIN_EMAIL = 'info@smileyscommunity.com'

// How many seconds of drift between createdAt and updatedAt we tolerate
// while still calling a row "untouched." Prisma's @updatedAt + clock
// jitter can produce a few ms; we go generous at 5 seconds.
const UNTOUCHED_DRIFT_MS = 5000

async function main() {
  const admin = await prisma.user.findUnique({
    where:  { email: ADMIN_EMAIL },
    select: { id: true, name: true, email: true },
  })
  if (!admin) {
    console.error(`✗ No user found with email ${ADMIN_EMAIL}`)
    process.exit(1)
  }

  // Pull all candidates that match the structural criteria; the
  // updatedAt-vs-createdAt drift check is done in JS so we keep one
  // place where the "is this row untouched?" rule lives.
  const candidates = await prisma.business.findMany({
    where: {
      submittedById: admin.id,
      phone:         null,
      address:       null,
      website:       null,
      claimedById:   null,
      reviews:       { none: {} },
      claims:        { none: {} },
    },
    select: {
      id:           true,
      name:         true,
      neighborhood: true,
      category:     true,
      createdAt:    true,
      updatedAt:    true,
      _count:       { select: { saves: true } },
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })

  // Two buckets: rows that look truly untouched (delete) vs rows that
  // have been edited since creation (skip — someone touched them).
  const toDelete: typeof candidates = []
  const touched:  typeof candidates = []
  for (const c of candidates) {
    const drift = c.updatedAt.getTime() - c.createdAt.getTime()
    if (drift <= UNTOUCHED_DRIFT_MS) toDelete.push(c)
    else                              touched.push(c)
  }

  console.log()
  console.log(`Mode:       ${DELETE ? '🔴 DELETE' : '🟡 DRY-RUN'}`)
  console.log(`Admin:      ${admin.name} <${admin.email}>`)
  console.log(`Candidates: ${candidates.length} total`)
  console.log(`   → ${toDelete.length} untouched (will${DELETE ? '' : ' would'} delete)`)
  console.log(`   → ${touched.length} edited since creation (skipped — preserved)`)
  console.log()

  if (touched.length > 0) {
    console.log('Preserved (someone edited these post-seed):')
    for (const c of touched) {
      console.log(`  ✓ ${c.name} — ${c.neighborhood ?? '—'} (edited ${c.updatedAt.toISOString()})`)
    }
    console.log()
  }

  if (toDelete.length === 0) {
    console.log('Nothing to delete.')
    return
  }

  console.log(`${DELETE ? 'Deleting' : 'Would delete'}:`)
  const byCategory = new Map<string, typeof toDelete>()
  for (const c of toDelete) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, [])
    byCategory.get(c.category)!.push(c)
  }
  for (const [category, items] of Array.from(byCategory.entries()).sort()) {
    console.log(`\n  ${category} (${items.length})`)
    for (const c of items) {
      const savesWarn = c._count.saves > 0 ? ` ⚠️  saved by ${c._count.saves}` : ''
      console.log(`    · ${c.name} — ${c.neighborhood ?? '—'}${savesWarn}`)
    }
  }
  console.log()

  if (!DELETE) {
    console.log(`Dry run — re-run with --delete to actually remove ${toDelete.length} entries.`)
    return
  }

  const result = await prisma.business.deleteMany({
    where: { id: { in: toDelete.map(c => c.id) } },
  })
  console.log(`✓ Deleted ${result.count} entries.`)
  console.log()
  console.log('Cascaded: any BusinessSave / BusinessReport rows attached to')
  console.log('the deleted businesses are gone too (via FK cascade).')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
