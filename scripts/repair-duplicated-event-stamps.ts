// Clear sweep stamps that upcoming events inherited by being duplicated.
//
// The duplicate route spread the source row into the copy, sweep stamps
// included (fixed in lib/eventDuplicate). A copy of a finished event carried
// noShowProcessedAt / surveyDispatchedAt / surveyReminderAt, so when the copy
// happens the no-show sweeper skips it as 'already_processed' and no survey
// goes out. The 2026-09 audit found 2 such upcoming events.
//
// Which stamps count as inherited — ALL of:
//   - the event is upcoming: date >= today on its city's clock. These stamps
//     are only ever written after an event has ended.
//   - the stamp is OLDER than the row (stamp < createdAt). A sweep can't stamp
//     a row that doesn't exist yet, so this is the signature of a copy. It also
//     keeps real stamps safe: a settled event whose date was later moved
//     forward was stamped after it was created, and clearing that would open a
//     second round of no-show cards (lib/noShow says never reprocess).
//   - nothing the stamp stands for exists on this row: no no-show cards for
//     noShowProcessedAt, no survey responses for the survey stamps.
// Anything upcoming and stamped that fails the last two is listed as left alone.
//
//   DRY RUN (default): print what would be cleared, write nothing.
//   APPLY=1:           clear. Each write is guarded on id + the exact stamp it
//                      read + the date still being upcoming, so a re-run finds
//                      nothing and a concurrent change wins.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/repair-duplicated-event-stamps.ts
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/repair-duplicated-event-stamps.ts

import { prisma } from '@/lib/prisma'
import { todayInTz, DEFAULT_TZ } from '@/lib/cityTime'

export const POST_EVENT_STAMPS = ['noShowProcessedAt', 'surveyDispatchedAt', 'surveyReminderAt'] as const
export type PostEventStamp = (typeof POST_EVENT_STAMPS)[number]

export interface StampedEventRow {
  id:                 string
  title:              string
  date:               string
  cityId:             string
  createdAt:          Date
  noShowProcessedAt:  Date | null
  surveyDispatchedAt: Date | null
  surveyReminderAt:   Date | null
  noShowCards:        number
  surveys:            number
}

export interface StampRepairPlan {
  id:     string
  title:  string
  date:   string
  today:  string
  clear:  { stamp: PostEventStamp; value: Date }[]
  keep:   { stamp: PostEventStamp; value: Date; why: string }[]
}

/** Pure: decides, per upcoming stamped event, which stamps were inherited. */
export function planStampRepair(rows: StampedEventRow[], todayByCity: (cityId: string) => string): StampRepairPlan[] {
  const plans: StampRepairPlan[] = []
  for (const r of rows) {
    const today = todayByCity(r.cityId)
    if (r.date < today) continue            // past: a stamp here is legitimate
    const plan: StampRepairPlan = { id: r.id, title: r.title, date: r.date, today, clear: [], keep: [] }
    for (const stamp of POST_EVENT_STAMPS) {
      const value = r[stamp]
      if (!value) continue
      if (value.getTime() >= r.createdAt.getTime()) {
        plan.keep.push({ stamp, value, why: 'stamped after the row was created — date probably moved; review by hand' })
      } else if (stamp === 'noShowProcessedAt' && r.noShowCards > 0) {
        plan.keep.push({ stamp, value, why: `${r.noShowCards} no-show card(s) exist on this event` })
      } else if (stamp !== 'noShowProcessedAt' && r.surveys > 0) {
        plan.keep.push({ stamp, value, why: `${r.surveys} survey response(s) exist on this event` })
      } else {
        plan.clear.push({ stamp, value })
      }
    }
    if (plan.clear.length || plan.keep.length) plans.push(plan)
  }
  return plans
}

async function main() {
  const APPLY = process.env.APPLY === '1'
  console.log(APPLY ? 'APPLYING\n' : 'DRY RUN — nothing is written. Re-run with APPLY=1 to clear.\n')

  const tzByCity = new Map((await prisma.city.findMany({ select: { id: true, timezone: true } }))
    .map(c => [c.id, c.timezone ?? DEFAULT_TZ]))
  const todayMemo = new Map<string, string>()
  const todayByCity = (cityId: string) => {
    let t = todayMemo.get(cityId)
    if (!t) { t = todayInTz(tzByCity.get(cityId) ?? DEFAULT_TZ); todayMemo.set(cityId, t) }
    return t
  }

  const events = await prisma.event.findMany({
    where: { OR: POST_EVENT_STAMPS.map(s => ({ [s]: { not: null } })) },
    select: {
      id: true, title: true, date: true, cityId: true, createdAt: true,
      noShowProcessedAt: true, surveyDispatchedAt: true, surveyReminderAt: true,
      _count: { select: { noShowCards: true, surveys: true } },
    },
    orderBy: { date: 'asc' },
  })
  const rows: StampedEventRow[] = events.map(({ _count, ...e }) => ({ ...e, noShowCards: _count.noShowCards, surveys: _count.surveys }))
  const plans = planStampRepair(rows, todayByCity)

  let planned = 0, cleared = 0, kept = 0
  for (const p of plans) {
    console.log(`  ${p.id}  ${p.date}  "${p.title}"  (city today ${p.today})`)
    for (const c of p.clear) {
      planned++
      console.log(`      ${APPLY ? 'clearing' : 'would clear'} ${c.stamp} = ${c.value.toISOString()}`)
      if (!APPLY) continue
      const { count } = await prisma.event.updateMany({
        where: { id: p.id, [c.stamp]: c.value, date: { gte: p.today } },
        data:  { [c.stamp]: null },
      })
      cleared += count
      if (!count) console.log('        (changed since it was read — skipped)')
    }
    for (const k of p.keep) {
      kept++
      console.log(`      left alone ${k.stamp} = ${k.value.toISOString()} — ${k.why}`)
    }
  }

  console.log(`\nsummary: ${events.length} stamped event(s) scanned, ${plans.length} upcoming with stamps, ` +
    `${planned} stamp(s) inherited${APPLY ? `, ${cleared} cleared` : ''}, ${kept} left alone`)
}

// Only run as a CLI — tests import planStampRepair.
if (/repair-duplicated-event-stamps\.ts$/.test(process.argv[1] ?? '')) {
  main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
}
