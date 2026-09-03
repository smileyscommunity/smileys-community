// Did the no-show policy change behaviour?
//
// The policy went live 2026-09-02 and can pause a member's RSVPs, so the
// question is not rhetorical. Two previous experiments here were read too
// generously and had to be walked back — the first-event matcher's admin tile
// claimed a win against a baseline that didn't apply, and the first-RSVP nudge
// turned out un-winnable at this sample size. This script is deliberately
// unflattering: it reports the interval, not just the point estimate, and says
// plainly when the data cannot separate the two periods.
//
// It measures what the POLICY measures, using the policy's own predicates
// (lib/noShowPolicy) rather than an approximation:
//   · free events only
//   · host and co-hosts excluded from the room
//   · only events where check-in was credible — at least one scan AND at least
//     NO_SHOW_MIN_CHECKIN_RATIO of the room. An event the door stopped scanning
//     is not evidence anybody stayed home, and including it would inflate both
//     periods with noise.
//   · a no-show is isNoShow(): approved and never checked in, or cancelled by
//     the member after the cutoff.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/measure-no-show-policy.ts
//   SINCE=2026-04-01 npx tsx ... scripts/measure-no-show-policy.ts
//
// Read-only.
import { prisma } from '@/lib/prisma'
import { eventStartsAt } from '@/lib/eventTime'
import { DEFAULT_TZ } from '@/lib/cityTime'
import { isFreeEvent, isNoShow, checkInIsCredible } from '@/lib/noShowPolicy'

// The first sweep ran at 23:25 UTC on 2 Sep and settled events from that day.
const POLICY_START = process.env.POLICY_START ?? '2026-09-02'
const SINCE        = process.env.SINCE ?? '2026-06-01'

interface Bucket { events: number; room: number; noShows: number }
const empty = (): Bucket => ({ events: 0, room: 0, noShows: 0 })
const rate  = (b: Bucket) => (b.room ? b.noShows / b.room : 0)

/**
 * Wilson score interval — the honest way to report a proportion from a small
 * sample. A naive ±  on 70 observations hides how wide the uncertainty is,
 * which is exactly the mistake that produced the matcher's invalid verdict.
 */
function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0]
  const p = successes / n
  const d = 1 + z * z / n
  const centre = (p + z * z / (2 * n)) / d
  const half   = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d
  return [Math.max(0, centre - half), Math.min(1, centre + half)]
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

async function main() {
  const cities = await prisma.city.findMany({ select: { id: true, timezone: true } })
  const tzFor  = new Map(cities.map(c => [c.id, c.timezone ?? DEFAULT_TZ]))

  const events = await prisma.event.findMany({
    where:  { date: { gte: SINCE }, status: { in: ['published', 'archived'] }, cancelledAt: null },
    select: {
      id: true, date: true, time: true, endTime: true, price: true, memberPrice: true,
      hostId: true, cityId: true,
      cohosts:   { select: { userId: true } },
      attendees: { where: { status: { in: ['approved', 'cancelled'] } },
                   select: { userId: true, status: true, checkedIn: true, cancelledAt: true, cancelledBy: true } },
    },
    orderBy: { date: 'asc' },
  })

  const before = empty(), after = empty()
  let skippedNotCredible = 0, skippedPaid = 0

  for (const e of events) {
    if (!isFreeEvent(e)) { skippedPaid++; continue }
    const staff = new Set([e.hostId, ...e.cohosts.map(c => c.userId)])
    const room  = e.attendees.filter(a => a.status === 'approved' && !staff.has(a.userId))
    const seen  = room.filter(a => a.checkedIn).length
    if (!checkInIsCredible(seen, room.length)) { skippedNotCredible++; continue }

    const startsAt = eventStartsAt(e, tzFor.get(e.cityId) ?? DEFAULT_TZ)
    const noShows  = e.attendees.filter(a => !staff.has(a.userId) && isNoShow(a, startsAt)).length
    const b = e.date < POLICY_START ? before : after
    b.events++; b.room += room.length; b.noShows += noShows
  }

  const [bLo, bHi] = wilson(before.noShows, before.room)
  const [aLo, aHi] = wilson(after.noShows,  after.room)

  console.log(`No-show rate at free events with credible check-in`)
  console.log(`  window        ${SINCE} → today, policy from ${POLICY_START}`)
  console.log(`  excluded      ${skippedPaid} paid, ${skippedNotCredible} without credible check-in\n`)
  console.log(`  ${'period'.padEnd(8)} ${'events'.padStart(7)} ${'seats'.padStart(7)} ${'no-shows'.padStart(9)} ${'rate'.padStart(7)}   95% CI`)
  console.log(`  ${'before'.padEnd(8)} ${String(before.events).padStart(7)} ${String(before.room).padStart(7)} ${String(before.noShows).padStart(9)} ${pct(rate(before)).padStart(7)}   ${pct(bLo)}–${pct(bHi)}`)
  console.log(`  ${'after'.padEnd(8)} ${String(after.events).padStart(7)} ${String(after.room).padStart(7)} ${String(after.noShows).padStart(9)} ${pct(rate(after)).padStart(7)}   ${pct(aLo)}–${pct(aHi)}`)

  console.log('')
  if (after.room < 200) {
    console.log(`  VERDICT  Too early. ${after.room} seats since the policy — the interval is`)
    console.log(`           ${pct(aLo)}–${pct(aHi)}, wide enough to contain almost any story.`)
    console.log(`           Do not read the point estimate as a result. Re-run at 200+ seats.`)
  } else if (aHi < bLo) {
    console.log(`  VERDICT  No-shows fell: ${pct(rate(before))} → ${pct(rate(after))}, intervals do not overlap.`)
  } else if (aLo > bHi) {
    console.log(`  VERDICT  No-shows ROSE: ${pct(rate(before))} → ${pct(rate(after))}, intervals do not overlap.`)
  } else {
    console.log(`  VERDICT  No detectable change. The intervals overlap (${pct(bLo)}–${pct(bHi)} vs`)
    console.log(`           ${pct(aLo)}–${pct(aHi)}), so this data cannot separate the two periods.`)
    console.log(`           That is a finding, not a failure to find one.`)
  }

  console.log(`\n  Caveats that no sample size fixes:`)
  console.log(`  · Not a randomised comparison — everyone got the policy at once, so a`)
  console.log(`    seasonal shift or a change in event mix would look identical to an effect.`)
  console.log(`  · Hosts clearing cards changes who is carded, not who turned up, so it`)
  console.log(`    does not move this number.`)
  console.log(`  · A member deterred from RSVPing at all leaves the denominator instead of`)
  console.log(`    the numerator — worth watching RSVP volume alongside this.`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
