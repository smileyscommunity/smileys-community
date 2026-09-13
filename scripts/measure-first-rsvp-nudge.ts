// Did the first-RSVP nudge change behaviour?
//
// This one is a randomised experiment, which makes it a better question than
// the no-show policy's before/after: everybody got that policy at once, so a
// seasonal shift there is indistinguishable from an effect. Here the control
// arm is drawn from the same pool the nudge selects — members who had a
// well-matched event waiting — and split by a hash of the member id, so
// nothing but the email differs between the arms.
//
// It measures with the experiment's own predicates (lib/firstRsvpNudge,
// lib/attendance) rather than an approximation of them:
//   · population: members stamped firstRsvpNudgedAt on or after HOLDOUT_START
//     — before that the code emailed everyone regardless of hash, so
//     splitting those cohorts by arm would file half the treated group as
//     controls and flatten any real effect.
//   · and stamped more than GRACE_DAYS ago, so they had a chance to act.
//     Without this the most recent batch enters the denominator having had
//     no opportunity to convert, which drags both arms down and, because
//     batches are half-and-half, adds noise rather than bias.
//   · converted: any RSVP in an active state (activeAttendeeWhere). They had
//     zero RSVPs when nudged, so any active row is attributable.
//
// The first reading of this experiment (2026-08-10) compared nudged members
// against every never-nudged member, which silently compared "had a good
// local option" against "may have had nothing to suggest" and produced a
// +33% relative lift that was noise (p=0.53). The holdout exists because of
// that. This script reports the difference with an interval and, when it
// finds nothing, says what size of effect the sample could actually have
// detected — "no difference" and "not enough data to see one" are different
// findings and get told apart here.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/measure-first-rsvp-nudge.ts
//   GRACE_DAYS=7 npx tsx ... scripts/measure-first-rsvp-nudge.ts
//
// Run it on the SERVER: the local .env points at a dev copy of the database
// and will measure a stale snapshot without saying so.
//
// Read-only.
import { prisma } from '@/lib/prisma'
import { isNudgeHoldout, HOLDOUT_START } from '@/lib/firstRsvpNudge'
import { activeAttendeeWhere } from '@/lib/attendance'

const GRACE_DAYS = Number(process.env.GRACE_DAYS ?? 3)
const MIN_PER_ARM = Number(process.env.MIN_PER_ARM ?? 100)

interface Arm { n: number; converted: number }
const rate = (a: Arm) => (a.n ? a.converted / a.n : 0)

/** Wilson score interval — honest about a proportion from a small sample. */
function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0]
  const p = successes / n
  const d = 1 + z * z / n
  const centre = (p + z * z / (2 * n)) / d
  const half   = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d
  return [Math.max(0, centre - half), Math.min(1, centre + half)]
}

/**
 * Newcombe's hybrid score interval for the difference of two proportions.
 * Built from the two Wilson intervals, and unlike a naive Wald difference it
 * stays sensible when a rate sits near 0 or 1 — which it will while the arms
 * are this small.
 */
function newcombeDiff(a: Arm, b: Arm): [number, number] {
  const p1 = rate(a), p2 = rate(b)
  const [l1, u1] = wilson(a.converted, a.n)
  const [l2, u2] = wilson(b.converted, b.n)
  const d = p1 - p2
  return [
    d - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2),
    d + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2),
  ]
}

/** Two-proportion z test, pooled. */
function zTest(a: Arm, b: Arm): { z: number; p: number } {
  if (!a.n || !b.n) return { z: 0, p: 1 }
  const pooled = (a.converted + b.converted) / (a.n + b.n)
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.n + 1 / b.n))
  if (se === 0) return { z: 0, p: 1 }
  const z = (rate(a) - rate(b)) / se
  // Two-sided p from the normal CDF (Abramowitz & Stegun 26.2.17).
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp(-z * z / 2)
  const p = d * t * (1.330274429 * t ** 4 - 1.821255978 * t ** 3 + 1.781477937 * t ** 2 - 0.356563782 * t + 0.319381530)
  return { z, p: 2 * p }
}

/**
 * Roughly the smallest absolute difference this sample could have detected at
 * 80% power. The point of reporting it: "we found nothing" is only useful
 * alongside "and we could only have seen a difference this big or bigger".
 */
function minDetectableEffect(baseline: number, nPerArm: number): number {
  if (nPerArm <= 0) return 1
  return (1.96 + 0.8416) * Math.sqrt(2 * baseline * (1 - baseline) / nPerArm)
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const pp  = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}pp`

async function main() {
  const cutoff = new Date(Date.now() - GRACE_DAYS * 86_400_000)
  const rows = await prisma.user.findMany({
    where:  { firstRsvpNudgedAt: { gte: HOLDOUT_START, lt: cutoff } },
    select: { id: true, firstRsvpNudgedAt: true, _count: { select: { joinedEvents: { where: activeAttendeeWhere } } } },
  })

  const treated: Arm = { n: 0, converted: 0 }
  const control: Arm = { n: 0, converted: 0 }
  for (const u of rows) {
    const arm = isNudgeHoldout(u.id) ? control : treated
    arm.n++
    if (u._count.joinedEvents > 0) arm.converted++
  }

  const first = rows.reduce<Date | null>((m, r) => (!m || (r.firstRsvpNudgedAt! < m) ? r.firstRsvpNudgedAt! : m), null)
  const last  = rows.reduce<Date | null>((m, r) => (!m || (r.firstRsvpNudgedAt! > m) ? r.firstRsvpNudgedAt! : m), null)

  console.log('First-RSVP nudge — randomised holdout')
  console.log(`  population    stamped ${HOLDOUT_START.toISOString().slice(0, 10)} → ${GRACE_DAYS}d ago, and given ${GRACE_DAYS} days to act`)
  console.log(`  cohorts       ${first ? first.toISOString().slice(0, 10) : '—'} … ${last ? last.toISOString().slice(0, 10) : '—'}`)
  console.log(`  converted     holds at least one RSVP in an active state\n`)

  const [tLo, tHi] = wilson(treated.converted, treated.n)
  const [cLo, cHi] = wilson(control.converted, control.n)
  console.log(`  ${'arm'.padEnd(9)} ${'n'.padStart(5)} ${'RSVP\'d'.padStart(7)} ${'rate'.padStart(7)}   95% CI`)
  console.log(`  ${'emailed'.padEnd(9)} ${String(treated.n).padStart(5)} ${String(treated.converted).padStart(7)} ${pct(rate(treated)).padStart(7)}   ${pct(tLo)}–${pct(tHi)}`)
  console.log(`  ${'held out'.padEnd(9)} ${String(control.n).padStart(5)} ${String(control.converted).padStart(7)} ${pct(rate(control)).padStart(7)}   ${pct(cLo)}–${pct(cHi)}`)

  const diff = rate(treated) - rate(control)
  const [dLo, dHi] = newcombeDiff(treated, control)
  const { z, p } = zTest(treated, control)
  const mde = minDetectableEffect(rate(control) || 0.3, Math.min(treated.n, control.n))
  console.log(`\n  difference    ${pp(diff)}   95% CI ${pp(dLo)} … ${pp(dHi)}   (z=${z.toFixed(2)}, p=${p.toFixed(2)})`)

  console.log('')
  if (Math.min(treated.n, control.n) < MIN_PER_ARM) {
    console.log(`  VERDICT  Too early. ${Math.min(treated.n, control.n)} members in the smaller arm, and the`)
    console.log(`           difference could be anywhere from ${pp(dLo)} to ${pp(dHi)}.`)
    console.log(`           Do not read the point estimate. Re-run at ${MIN_PER_ARM}+ per arm.`)
  } else if (dLo > 0) {
    console.log(`  VERDICT  The nudge works: ${pct(rate(control))} → ${pct(rate(treated))} (${pp(diff)}), and the`)
    console.log(`           interval for the difference stays above zero.`)
  } else if (dHi < 0) {
    console.log(`  VERDICT  The nudge HURTS: ${pct(rate(control))} → ${pct(rate(treated))} (${pp(diff)}), and the`)
    console.log(`           interval for the difference stays below zero.`)
  } else {
    console.log(`  VERDICT  No detectable effect. The interval spans zero (${pp(dLo)} … ${pp(dHi)}),`)
    console.log(`           so this data cannot say the nudge does anything.`)
    console.log(`           At this sample size only a difference of about ${pp(mde)} or larger`)
    console.log(`           would have been visible, so a real but modest effect would hide here.`)
    console.log(`           That is a finding about the experiment, not only about the nudge.`)
  }

  console.log(`\n  Caveats:`)
  console.log(`  · Conversion is "any active RSVP since", not "RSVP'd to the event we`)
  console.log(`    suggested" — a member who booked something else still counts.`)
  console.log(`  · Members stamped before ${HOLDOUT_START.toISOString().slice(0, 10)} are excluded on purpose: the code`)
  console.log(`    emailed all of them, so their hash does not describe what happened.`)
  console.log(`  · The arms come from one hash, so a bumped HOLDOUT_SALT invalidates`)
  console.log(`    every comparison across the change.`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
