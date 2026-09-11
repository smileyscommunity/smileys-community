// Re-derive Event.spotsLeft from the attendee rows for every published or
// cancelled event, using the same formula the app uses (lib/spotsLeft
// expectedSpotsLeft — hosts and co-hosts take no spot; an unlimited event's
// counter tallies below zero rather than clamping).
//
//   DRY_RUN (default): print what would change, write nothing.
//   DRY_RUN=0:         write.
//
// Run on the server with both env files:
//   npx tsx --env-file=.env --env-file=.env.local scripts/fix-spots-left.ts

import { prisma } from '@/lib/prisma'
import { expectedSpotsLeft } from '@/lib/spotsLeft'

const DRY_RUN = process.env.DRY_RUN !== '0'

async function main() {
  const events = await prisma.event.findMany({
    where:  { status: { in: ['published', 'cancelled'] } },
    select: { id: true, title: true, totalSpots: true, spotsLeft: true },
  })

  let changed = 0
  for (const e of events) {
    const correct = await expectedSpotsLeft(e.id, e.totalSpots)
    if (correct === e.spotsLeft) continue
    changed++
    console.log(`${DRY_RUN ? 'would fix' : 'fixed'}: ${e.title} — ${e.spotsLeft} → ${correct}`)
    if (!DRY_RUN) {
      // Guarded on the current value so a concurrent RSVP is never overwritten.
      await prisma.event.updateMany({ where: { id: e.id, spotsLeft: e.spotsLeft }, data: { spotsLeft: correct } })
    }
  }
  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}${changed} of ${events.length} events ${DRY_RUN ? 'would change. Re-run with DRY_RUN=0 to write.' : 'updated.'}`)
}

main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
