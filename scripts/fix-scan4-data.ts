// One-off repairs for the historical data found by scan 4 (item 33), 2026-09-13.
//
//   1. Limited events whose spotsLeft left the 0..totalSpots range (all
//      archived): re-derived from attendee rows with the app's own formula.
//   2. Events stored as cancelled with no cancelledAt and seats still approved
//      (cancelled before the cancel path stamped and released them): stamped
//      with their last update, seats released as the cancel path now does.
//   3. Event times stored as a bare hour ('12'): padded to 'HH:00'.
//   4. Notifications linking to events that no longer exist: pointed at the
//      events list instead of a 404.
//
// Approved members who never activated are NOT handled here — that is an email
// send, and scripts/reinvite-unactivated.ts already does it with its own
// DRY_RUN.
//
//   DRY_RUN (default): print what would change, write nothing.
//   DRY_RUN=0:         write. Every write is guarded on the value it read, so a
//                      re-run finds nothing and a concurrent edit always wins.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/fix-scan4-data.ts

import { prisma } from '@/lib/prisma'
import { expectedSpotsLeft } from '@/lib/spotsLeft'
import { activeAttendeeWhere } from '@/lib/attendance'

const DRY_RUN = process.env.DRY_RUN !== '0'
const verb    = DRY_RUN ? 'would fix' : 'fixed'

async function spotsCounters(): Promise<number> {
  const rows = await prisma.$queryRaw<{ id: string; title: string; date: string; status: string; totalSpots: number; spotsLeft: number }[]>`
    SELECT id, title, date, status, "totalSpots", "spotsLeft" FROM events
    WHERE "limitedSpots" = true AND ("spotsLeft" < 0 OR "spotsLeft" > "totalSpots")
    ORDER BY date`
  let n = 0
  for (const e of rows) {
    const correct = await expectedSpotsLeft(e.id, e.totalSpots)
    if (correct === e.spotsLeft) continue
    n++
    console.log(`  ${verb}: spotsLeft ${e.date} "${e.title}" (${e.status}) ${e.spotsLeft} → ${correct}`)
    if (!DRY_RUN) await prisma.event.updateMany({ where: { id: e.id, spotsLeft: e.spotsLeft }, data: { spotsLeft: correct } })
  }
  return n
}

async function halfCancelled(): Promise<number> {
  const events = await prisma.event.findMany({
    where:  { status: 'cancelled', cancelledAt: null },
    select: { id: true, title: true, date: true, updatedAt: true, totalSpots: true, spotsLeft: true },
  })
  for (const e of events) {
    const [seats, waiting] = await Promise.all([
      prisma.eventAttendee.count({ where: { eventId: e.id, ...activeAttendeeWhere } }),
      prisma.waitlistEntry.count({ where: { eventId: e.id } }),
    ])
    console.log(`  ${verb}: cancelled "${e.title}" ${e.date} — cancelledAt → ${e.updatedAt.toISOString()}, ${seats} active seat(s) released, ${waiting} waitlisted cleared`)
    if (DRY_RUN) continue
    const stamped = await prisma.event.updateMany({ where: { id: e.id, status: 'cancelled', cancelledAt: null }, data: { cancelledAt: e.updatedAt } })
    if (!stamped.count) continue
    // Released as an admin removal, same as the cancel path: never a no-show.
    await prisma.$transaction([
      prisma.eventAttendee.updateMany({
        where: { eventId: e.id, ...activeAttendeeWhere },
        data:  { status: 'removed', cancelledAt: e.updatedAt, cancelledBy: 'admin' },
      }),
      prisma.waitlistEntry.deleteMany({ where: { eventId: e.id } }),
    ])
    const correct = await expectedSpotsLeft(e.id, e.totalSpots)
    await prisma.event.updateMany({ where: { id: e.id, spotsLeft: e.spotsLeft }, data: { spotsLeft: correct } })
  }
  return events.length
}

async function bareHourTimes(): Promise<number> {
  const rows = await prisma.$queryRaw<{ id: string; title: string; date: string; time: string }[]>`
    SELECT id, title, date, time FROM events WHERE time !~ '^[0-9]{2}:[0-9]{2}$'`
  let n = 0
  for (const e of rows) {
    const m = e.time.trim().match(/^(\d{1,2})$/)
    if (!m || Number(m[1]) > 23) { console.log(`  left alone: "${e.title}" ${e.date} time=${JSON.stringify(e.time)}`); continue }
    const fixed = `${m[1].padStart(2, '0')}:00`
    n++
    console.log(`  ${verb}: time "${e.title}" ${e.date} ${JSON.stringify(e.time)} → ${fixed}`)
    if (!DRY_RUN) await prisma.event.updateMany({ where: { id: e.id, time: e.time }, data: { time: fixed } })
  }
  return n
}

async function deadEventLinks(): Promise<number> {
  const byType = await prisma.$queryRaw<{ type: string; n: bigint }[]>`
    SELECT n.type, count(*) AS n FROM notifications n
    WHERE n.link ~ '^/events/[A-Za-z0-9]+'
      AND NOT EXISTS (SELECT 1 FROM events e WHERE e.id = split_part(split_part(n.link, '/', 3), '?', 1))
    GROUP BY n.type ORDER BY count(*) DESC`
  const total = byType.reduce((s, r) => s + Number(r.n), 0)
  console.log(`  ${verb}: ${total} notifications linking to deleted events → /events`)
  for (const r of byType) console.log(`      ${r.type}: ${r.n}`)
  if (!DRY_RUN && total) {
    const updated = await prisma.$executeRaw`
      UPDATE notifications n SET link = '/events'
      WHERE n.link ~ '^/events/[A-Za-z0-9]+'
        AND NOT EXISTS (SELECT 1 FROM events e WHERE e.id = split_part(split_part(n.link, '/', 3), '?', 1))`
    console.log(`      updated ${updated}`)
  }
  return total
}

async function main() {
  console.log(DRY_RUN ? 'DRY RUN — nothing is written. Re-run with DRY_RUN=0 to write.\n' : 'WRITING\n')
  console.log('1. Out-of-range spot counters');     const a = await spotsCounters()
  console.log('2. Half-cancelled events');          const b = await halfCancelled()
  console.log('3. Bare-hour event times');          const c = await bareHourTimes()
  console.log('4. Notifications to deleted events'); const d = await deadEventLinks()
  console.log(`\nsummary: counters=${a} halfCancelled=${b} times=${c} deadLinks=${d}`)
}

main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
