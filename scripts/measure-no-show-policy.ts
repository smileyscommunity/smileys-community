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
// ── Two corrections, made 2026-09-11 ───────────────────────────────────────
// The first read of this script said no-shows had risen 31.4% → 42.6%. Both
// halves of that number were wrong, in the same direction, for the same
// reason: soft-cancel rows (commit 5ff2f61) shipped ON 2026-09-02, the very
// day the policy went live.
//
//   1. DENOMINATOR. isNoShow() counts a late member cancel, whose row has
//      status 'cancelled'. The old denominator counted only status
//      'approved' — so late cancels landed in the numerator without ever
//      joining the denominator, and the rate could exceed 100%. The seat at
//      risk is one still held at the cancellation cutoff, so that is the
//      denominator now: approved + late-cancelled, non-staff.
//   2. COMPARABILITY. Before 2026-09-02 a member had no soft-cancel to make,
//      so the baseline contains zero late cancels by construction. Comparing
//      a composite (ghost + late cancel) against a baseline that could only
//      ever record ghosts is the matcher's mistake wearing a new hat.
//
// So the composite is reported but never used for the verdict. The verdict
// reads GHOSTING — approved, never scanned, never cancelled — which means the
// same thing on both sides of the policy date. Late cancels are reported
// beside it as a new quantity with no baseline, because a member who cancels
// late still returns the seat and still tells the host, which is not the same
// failure as simply not arriving.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/measure-no-show-policy.ts
//   SINCE=2026-04-01 npx tsx ... scripts/measure-no-show-policy.ts
//
// The production database is only reachable from the server — running this
// against a local .env silently measures a stale dev copy. Run it there:
//   ssh root@178.105.37.133 'cd /root/smileys-community && npx tsx \
//     --env-file=.env --env-file=.env.local scripts/measure-no-show-policy.ts'
//
// Read-only.
import { prisma } from '@/lib/prisma'
import { eventStartsAt } from '@/lib/eventTime'
import { DEFAULT_TZ } from '@/lib/cityTime'
import { isFreeEvent, isNoShow, checkInIsCredible } from '@/lib/noShowPolicy'

// The first sweep ran at 23:25 UTC on 2 Sep and settled events from that day.
const POLICY_START = process.env.POLICY_START ?? '2026-09-02'
const SINCE        = process.env.SINCE ?? '2026-06-01'

/** `seats` is every seat still held at the cancellation cutoff. */
interface Bucket { events: number; seats: number; ghosts: number; lateCancels: number }
const empty = (): Bucket => ({ events: 0, seats: 0, ghosts: 0, lateCancels: 0 })
const total = (b: Bucket) => b.ghosts + b.lateCancels
const rate  = (n: number, d: number) => (d ? n / d : 0)

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
const ci  = ([lo, hi]: [number, number]) => `${pct(lo)}–${pct(hi)}`

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
    // Credibility is a fact about check-in, so it is judged on the scannable
    // room — the approved seats — not on the widened denominator below.
    if (!checkInIsCredible(seen, room.length)) { skippedNotCredible++; continue }

    const startsAt = eventStartsAt(e, tzFor.get(e.cityId) ?? DEFAULT_TZ)
    const b = e.date < POLICY_START ? before : after
    b.events++
    b.seats += room.length

    for (const a of e.attendees) {
      if (staff.has(a.userId)) continue
      if (!isNoShow(a, startsAt)) continue
      if (a.status === 'cancelled') { b.lateCancels++; b.seats++ }  // held the seat to the cutoff
      else b.ghosts++
    }
  }

  const bGhost = wilson(before.ghosts, before.seats)
  const aGhost = wilson(after.ghosts,  after.seats)

  console.log(`No-show rate at free events with credible check-in`)
  console.log(`  window        ${SINCE} → today, policy from ${POLICY_START}`)
  console.log(`  excluded      ${skippedPaid} paid, ${skippedNotCredible} without credible check-in`)
  console.log(`  seats         every seat still held at the cancellation cutoff\n`)

  const row = (label: string, b: Bucket) => {
    const g = wilson(b.ghosts, b.seats), t = wilson(total(b), b.seats)
    console.log(`  ${label.padEnd(8)} ${String(b.events).padStart(6)} ${String(b.seats).padStart(6)} ` +
                `${String(b.ghosts).padStart(7)} ${pct(rate(b.ghosts, b.seats)).padStart(6)} ${ci(g).padStart(13)} ` +
                `${String(b.lateCancels).padStart(7)} ${pct(rate(b.lateCancels, b.seats)).padStart(6)} ` +
                `${String(total(b)).padStart(6)} ${pct(rate(total(b), b.seats)).padStart(6)} ${ci(t)}`)
  }
  console.log(`  ${'period'.padEnd(8)} ${'events'.padStart(6)} ${'seats'.padStart(6)} ` +
              `${'ghosts'.padStart(7)} ${'rate'.padStart(6)} ${'95% CI'.padStart(13)} ` +
              `${'lateCx'.padStart(7)} ${'rate'.padStart(6)} ${'total'.padStart(6)} ${'rate'.padStart(6)} 95% CI`)
  row('before', before)
  row('after',  after)

  console.log('')
  if (before.lateCancels === 0 && after.lateCancels > 0) {
    console.log(`  NOTE     The baseline records 0 late cancels because soft-cancel rows`)
    console.log(`           shipped on ${POLICY_START} itself. The 'total' column is therefore`)
    console.log(`           NOT comparable across the policy line — only 'ghosts' is.`)
    console.log('')
  }

  // The verdict reads ghosting, the one quantity that means the same thing on
  // both sides of the policy date.
  if (after.seats < 200) {
    console.log(`  VERDICT  Too early. ${after.seats} seats since the policy — ghosting's interval`)
    console.log(`           is ${ci(aGhost)}, wide enough to contain almost any story.`)
    console.log(`           Do not read the point estimate as a result. Re-run at 200+ seats.`)
  } else if (aGhost[1] < bGhost[0]) {
    console.log(`  VERDICT  Ghosting fell: ${pct(rate(before.ghosts, before.seats))} → ${pct(rate(after.ghosts, after.seats))}, intervals do not overlap.`)
  } else if (aGhost[0] > bGhost[1]) {
    console.log(`  VERDICT  Ghosting ROSE: ${pct(rate(before.ghosts, before.seats))} → ${pct(rate(after.ghosts, after.seats))}, intervals do not overlap.`)
  } else {
    console.log(`  VERDICT  No detectable change in ghosting. The intervals overlap`)
    console.log(`           (${ci(bGhost)} vs ${ci(aGhost)}), so this data cannot`)
    console.log(`           separate the two periods. That is a finding, not a failure to find one.`)
  }

  console.log(`\n  Caveats that no sample size fixes:`)
  console.log(`  · Not a randomised comparison — everyone got the policy at once, so a`)
  console.log(`    seasonal shift or a change in event mix would look identical to an effect.`)
  console.log(`  · Soft-cancel shipped with the policy, so a fall in ghosting may be members`)
  console.log(`    using a button that did not exist before rather than a deterrent working.`)
  console.log(`    The two cannot be separated by this data.`)
  console.log(`  · Hosts clearing cards changes who is carded, not who turned up, so it`)
  console.log(`    does not move this number.`)
  console.log(`  · A member deterred from RSVPing at all leaves the denominator instead of`)
  console.log(`    the numerator — worth watching RSVP volume alongside this.`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
