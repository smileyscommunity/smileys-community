// Normalise event times that were stored in forms the reader couldn't parse.
//
// The host forms take time/endTime as free text and the create/update routes
// stored it verbatim, so rows hold '22.00', '18', '24:00' (16 events in the
// 2026-09 audit), each silently read as ending 23:59. The routes now validate
// through lib/eventTime normalizeClock; this rewrites the old rows with the
// same normaliser so what's stored is what's read.
//
// Lists every event whose time or endTime isn't strict HH:MM, with the proposed
// value or UNFIXABLE. 'TBA' as a start time is a deliberate value and is not
// listed. A blank endTime is proposed as null (no end — same reading as now).
// UNFIXABLE rows are printed and never written.
//
//   DRY RUN (default): print the plan, write nothing.
//   APPLY=1:           write. Each update is guarded on id + the exact value
//                      read, so a re-run finds nothing and a concurrent edit wins.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/repair-malformed-event-times.ts
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/repair-malformed-event-times.ts

import { prisma } from '@/lib/prisma'
import { normalizeClock, STRICT_HHMM } from '@/lib/eventTime'

export interface TimeRow {
  id:      string
  title:   string
  date:    string
  time:    string
  endTime: string | null
}

export interface TimeFix {
  id:       string
  title:    string
  date:     string
  field:    'time' | 'endTime'
  old:      string
  proposed: string | null | 'UNFIXABLE'
}

/** Pure: one entry per malformed field. */
export function planTimeRepair(rows: TimeRow[]): TimeFix[] {
  const fixes: TimeFix[] = []
  for (const r of rows) {
    if (!STRICT_HHMM.test(r.time) && r.time.trim().toUpperCase() !== 'TBA') {
      fixes.push({ id: r.id, title: r.title, date: r.date, field: 'time', old: r.time,
        proposed: normalizeClock(r.time, 'start') ?? 'UNFIXABLE' })
    }
    if (r.endTime !== null && !STRICT_HHMM.test(r.endTime)) {
      fixes.push({ id: r.id, title: r.title, date: r.date, field: 'endTime', old: r.endTime,
        proposed: r.endTime.trim() === '' ? null : (normalizeClock(r.endTime, 'end') ?? 'UNFIXABLE') })
    }
  }
  return fixes
}

async function main() {
  const APPLY = process.env.APPLY === '1'
  console.log(APPLY ? 'APPLYING\n' : 'DRY RUN — nothing is written. Re-run with APPLY=1 to write.\n')

  const rows = await prisma.$queryRaw<TimeRow[]>`
    SELECT id, title, date, time, "endTime" FROM events
    WHERE time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR ("endTime" IS NOT NULL AND "endTime" !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    ORDER BY date`
  const fixes = planTimeRepair(rows)

  let fixable = 0, written = 0, unfixable = 0
  for (const f of fixes) {
    const shown = f.proposed === null ? 'null' : f.proposed
    console.log(`  ${f.id}  ${f.date}  "${f.title}"  ${f.field} ${JSON.stringify(f.old)} → ${shown}`)
    if (f.proposed === 'UNFIXABLE') { unfixable++; continue }
    fixable++
    if (!APPLY) continue
    const { count } = f.field === 'time'
      ? await prisma.event.updateMany({ where: { id: f.id, time: f.old },    data: { time: f.proposed as string } })
      : await prisma.event.updateMany({ where: { id: f.id, endTime: f.old }, data: { endTime: f.proposed } })
    written += count
    if (!count) console.log('      (changed since it was read — skipped)')
  }

  console.log(`\nsummary: ${rows.length} event(s) with a malformed time, ${fixes.length} field(s): ` +
    `${fixable} fixable${APPLY ? `, ${written} written` : ''}, ${unfixable} UNFIXABLE (left alone)`)
}

// Only run as a CLI — tests import planTimeRepair.
if (/repair-malformed-event-times\.ts$/.test(process.argv[1] ?? '')) {
  main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
}
