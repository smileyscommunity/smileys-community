// Clean phase for standing v3 (Nate, 2026-09-17): take the v1 no-show system's
// records out of the database — every no-show card (all 95 were already
// waived or overturned, so none shapes anyone's standing) and the
// noShowProcessedAt stamp v1's sweep left on settled events, which still made
// the check-in and close-out routes refuse those events.
//
// Left alone on purpose: event_attendees.attendance = 'no_show' marks (the
// attendance record itself), and everything standing v2/v3 writes
// (standing_offences, standing_cards — both empty as of this script).
//
// NoShowCard has no dependants (only outgoing relations), so the delete is
// clean. One audit row, as the Smileys Admin account, records what was done.
//
//   (default)  DRY RUN — prints the counts, writes nothing
//   APPLY=1    deletes the cards and clears the stamps
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/clear-v1-no-shows.ts
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/clear-v1-no-shows.ts

import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'

const APPLY        = process.env.APPLY === '1'
const AUTHOR_EMAIL = 'info@smileyscommunity.com'

async function main() {
  console.log(APPLY ? 'APPLY — clearing\n' : 'DRY RUN — nothing is written. APPLY=1 clears.\n')

  const [cards, byStatus, stamped] = await Promise.all([
    prisma.noShowCard.count(),
    prisma.noShowCard.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.event.count({ where: { noShowProcessedAt: { not: null } } }),
  ])
  console.log(`No-show cards: ${cards} (${byStatus.map(s => `${s.status} ${s._count._all}`).join(', ') || 'none'})`)
  console.log(`Events stamped noShowProcessedAt: ${stamped}`)
  if (!APPLY) { console.log('\nDry run complete.'); return }

  const actor = await prisma.user.findFirst({
    where:  { email: { equals: AUTHOR_EMAIL, mode: 'insensitive' }, status: 'approved' },
    select: { id: true, name: true },
  })
  if (!actor) throw new Error(`No approved account for ${AUTHOR_EMAIL}`)

  const [deleted, cleared] = await prisma.$transaction([
    prisma.noShowCard.deleteMany({}),
    prisma.event.updateMany({ where: { noShowProcessedAt: { not: null } }, data: { noShowProcessedAt: null } }),
  ])
  await writeAudit(actor.id, actor.name, 'no_show_v1_cleared', undefined, undefined,
    { cardsDeleted: deleted.count, cardsByStatus: byStatus.map(s => [s.status, s._count._all]), stampsCleared: cleared.count },
    `Clean phase: deleted ${deleted.count} v1 no-show cards and cleared ${cleared.count} settled-event stamps`)
  console.log(`\nDeleted ${deleted.count} cards, cleared ${cleared.count} stamps.`)
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
