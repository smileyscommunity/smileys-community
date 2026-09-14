// Limited events holding more approved seats than they have spots — the
// 2026-09 production audit found 13. Staff approve / add / promote seated
// people with no cap check, an edit could lower totalSpots under the seats
// already held, a restore brought every seat back regardless of the cap, and a
// counter left stale-high (series apply, co-host changes) let member RSVPs
// through the spotsLeft gate. All of those are closed in code now
// (lib/eventCapacity); this lists what they left behind.
//
// For every event with limitedSpots on and approved non-staff seats (host and
// co-hosts take none, as in lib/spotsLeft) above totalSpots: id, date, city,
// status, whether it is still upcoming, approved / totalSpots / how many over,
// and the stored spotsLeft next to the correct one.
//
//   (default)  READ-ONLY: print every row, write nothing.
//   APPLY=1    re-derive spotsLeft to max(0, totalSpots − approved) on the rows
//              whose stored counter is wrong — counted fresh at write time, and
//              guarded on the spotsLeft / totalSpots / limitedSpots the plan saw
//              so a concurrent seat change wins. NEVER unseats anyone: who is
//              over the cap is a host's call, not a script's.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/audit-overcapacity-events.ts
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/audit-overcapacity-events.ts

import { prisma } from '@/lib/prisma'
import { citiesByToday } from '@/lib/city'
import { expectedSpotsLeft } from '@/lib/spotsLeft'

const APPLY_MODE = process.env.APPLY === '1'

export interface CapacityFacts {
  eventId:      string
  title:        string
  date:         string   // 'YYYY-MM-DD'
  status:       string
  cancelled:    boolean
  city:         string
  cityToday:    string   // 'YYYY-MM-DD' on the event city's clock
  limitedSpots: boolean
  totalSpots:   number
  spotsLeft:    number
  approved:     number   // approved, host and co-hosts excluded
}

export interface OvercapacityRow extends CapacityFacts {
  over:             number
  upcoming:         boolean
  correctSpotsLeft: number
  action:           'recompute_spots_left' | 'none'
}

/** Pure: the over-capacity events, what spotsLeft should read, and the counts. */
export function planOvercapacity(facts: CapacityFacts[]) {
  const rows: OvercapacityRow[] = facts
    .filter(f => f.limitedSpots && f.approved > f.totalSpots)
    .map(f => {
      const correctSpotsLeft = Math.max(0, f.totalSpots - f.approved)
      return {
        ...f,
        over:     f.approved - f.totalSpots,
        upcoming: f.date >= f.cityToday,
        correctSpotsLeft,
        action:   f.spotsLeft !== correctSpotsLeft ? 'recompute_spots_left' as const : 'none' as const,
      }
    })
    .sort((a, b) => Number(b.upcoming) - Number(a.upcoming) || a.date.localeCompare(b.date) || a.eventId.localeCompare(b.eventId))
  return {
    rows,
    counts: {
      events:      rows.length,
      upcoming:    rows.filter(r => r.upcoming).length,
      seatsOver:   rows.reduce((s, r) => s + r.over, 0),
      toRecompute: rows.filter(r => r.action === 'recompute_spots_left').length,
    },
  }
}

async function loadFacts(): Promise<CapacityFacts[]> {
  const [events, days] = await Promise.all([
    prisma.event.findMany({
      where:  { limitedSpots: true },
      select: {
        id: true, title: true, date: true, status: true, cancelledAt: true, cityId: true, hostId: true,
        totalSpots: true, spotsLeft: true, limitedSpots: true,
        city: { select: { name: true } }, cohosts: { select: { userId: true } },
      },
    }),
    citiesByToday(),
  ])
  if (events.length === 0) return []
  const seats = await prisma.eventAttendee.findMany({
    where:  { eventId: { in: events.map(e => e.id) }, status: 'approved' },
    select: { eventId: true, userId: true },
  })
  const todayOf = new Map(days.flatMap(d => d.cityIds.map(id => [id, d.date] as const)))
  return events.map(e => {
    const staff = new Set([e.hostId, ...e.cohosts.map(c => c.userId)])
    return {
      eventId: e.id, title: e.title, date: e.date, status: e.status, cancelled: !!e.cancelledAt,
      city: e.city?.name ?? e.cityId,
      // A city missing from the grouping can't be judged upcoming: treat as past.
      cityToday: todayOf.get(e.cityId) ?? '9999-12-31',
      limitedSpots: e.limitedSpots, totalSpots: e.totalSpots, spotsLeft: e.spotsLeft,
      approved: seats.filter(s => s.eventId === e.id && !staff.has(s.userId)).length,
    }
  })
}

async function apply(rows: OvercapacityRow[]) {
  let fixed = 0
  let skipped = 0
  for (const r of rows) {
    if (r.action !== 'recompute_spots_left') continue
    // Counted again now, not taken from the plan.
    const correct = await expectedSpotsLeft(r.eventId, r.totalSpots)
    const res = await prisma.event.updateMany({
      where: { id: r.eventId, spotsLeft: r.spotsLeft, totalSpots: r.totalSpots, limitedSpots: true },
      data:  { spotsLeft: correct },
    })
    if (res.count) fixed++
    else skipped++
  }
  return { fixed, skipped }
}

async function main() {
  console.log(APPLY_MODE
    ? 'APPLY — re-deriving spotsLeft on over-capacity events. Nobody is unseated.\n'
    : 'READ-ONLY — nothing is written. APPLY=1 re-derives spotsLeft (never unseats anyone).\n')
  const { rows, counts } = planOvercapacity(await loadFacts())

  // Every row, never truncated.
  for (const r of rows) {
    console.log(
      `  ${r.date} ${r.eventId} [${r.city}] "${r.title}" (${r.cancelled ? 'cancelled' : r.status}, ${r.upcoming ? 'upcoming' : 'past'})` +
      ` approved=${r.approved} totalSpots=${r.totalSpots} over=${r.over}` +
      ` spotsLeft=${r.spotsLeft} correct=${r.correctSpotsLeft} → ${r.action}`,
    )
  }
  console.log(`\nsummary: events=${counts.events} upcoming=${counts.upcoming} seatsOver=${counts.seatsOver} spotsLeftToRecompute=${counts.toRecompute}`)

  if (!APPLY_MODE) return
  const { fixed, skipped } = await apply(rows)
  console.log(`\napplied: spotsLeft re-derived on ${fixed} event(s), skipped=${skipped} (counter or cap changed since the read)`)
}

// Only run as a CLI — tests import planOvercapacity.
if (/audit-overcapacity-events\.ts$/.test(process.argv[1] ?? '')) {
  main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
}
