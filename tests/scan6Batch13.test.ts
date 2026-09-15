import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  clampOccurrences, seriesOutcomeMessage,
  MIN_SERIES_OCCURRENCES, MAX_SERIES_OCCURRENCES, MIN_SERIES_COPIES, MAX_SERIES_COPIES,
} from '@/lib/seriesCreate'

// The edit pages' "Create N more" (make recurring) flow was missed when the
// new-event pages were fixed: occurrences unclamped, the PUT {seriesId}
// response ignored, and the loop aborting at the first failure without saying
// how many copies already existed.

const read = (f: string) => readFileSync(f, 'utf8')
const EDIT_PAGES = ['app/admin/events/[id]/edit/page.tsx', 'app/host/events/[id]/edit/page.tsx']

describe('clampOccurrences bounds', () => {
  it('defaults are unchanged for the new-event pages (2..52)', () => {
    expect(clampOccurrences(500)).toBe(MAX_SERIES_OCCURRENCES)
    expect(clampOccurrences(1)).toBe(MIN_SERIES_OCCURRENCES)
    expect(clampOccurrences('abc')).toBe(MIN_SERIES_OCCURRENCES)
  })
  it('copies of an existing event run 1..51 — the source event counts toward the server cap', () => {
    expect(MIN_SERIES_COPIES).toBe(1)
    expect(MAX_SERIES_COPIES).toBe(MAX_SERIES_OCCURRENCES - 1)
    expect(clampOccurrences(500, MIN_SERIES_COPIES, MAX_SERIES_COPIES)).toBe(51)
    expect(clampOccurrences(1, MIN_SERIES_COPIES, MAX_SERIES_COPIES)).toBe(1)
    expect(clampOccurrences(0, MIN_SERIES_COPIES, MAX_SERIES_COPIES)).toBe(1)
    expect(clampOccurrences('', MIN_SERIES_COPIES, MAX_SERIES_COPIES)).toBe(1)
    expect(clampOccurrences('abc', MIN_SERIES_COPIES, MAX_SERIES_COPIES)).toBe(1)
    expect(clampOccurrences(7.9, MIN_SERIES_COPIES, MAX_SERIES_COPIES)).toBe(7)
  })
  it('a partial spawn warns that resubmitting would duplicate', () => {
    const msg = seriesOutcomeMessage(4, 2, [{ date: '2026-10-27', error: 'x' }, { date: '2026-11-03', error: 'y' }])!
    expect(msg).toMatch(/Created 2 of 4 events; 2 failed/)
    expect(msg).toMatch(/duplicate the 2 already created/)
  })
})

describe.each(EDIT_PAGES)('%s "Create N more"', (file) => {
  const src = read(file)
  const spawn = src.slice(src.indexOf('function buildSpawnDates'), src.indexOf('if (loading) return'))

  it('clamps occurrences in the dates, the input and the button label', () => {
    expect(spawn).toMatch(/i <= clampOccurrences\(occurrences, MIN_SERIES_COPIES, MAX_SERIES_COPIES\); i\+\+/)
    expect(spawn).not.toMatch(/i <= occurrences;/)
    expect(src).toMatch(/max=\{MAX_SERIES_COPIES\}/)
    expect(src).not.toMatch(/max=\{52\}/)
    expect(src).toMatch(/`Create \$\{clampOccurrences\(occurrences, MIN_SERIES_COPIES, MAX_SERIES_COPIES\)\} more`/)
    expect(src).not.toMatch(/`Create \$\{occurrences\} more`/)
  })

  it('checks the PUT {seriesId} response and stops with the server reason before creating anything', () => {
    const put = spawn.slice(spawn.indexOf("method: 'PUT'"), spawn.indexOf("fetch('/app/api/admin/events'"))
    expect(put).toMatch(/if \(!res\.ok\) \{[\s\S]{0,200}?data\?\.error[\s\S]{0,200}?setSpawning\(false\); return/)
    expect(put).toMatch(/Nothing created/)
    // setSeriesId only after the link succeeded
    expect(put.indexOf('setSeriesId(sid)')).toBeGreaterThan(put.indexOf('if (!res.ok)'))
    // No bare, unchecked `await fetch(...PUT...)` statement left
    expect(spawn).not.toMatch(/^\s*await fetch\(`\/app\/api\/admin\/events\/\$\{id\}`, \{\s*method: 'PUT'/m)
  })

  it('attempts every date and reports created vs failed', () => {
    expect(spawn).toMatch(/if \(!res\.ok\) \{ failures\.push\(\{ date, error: data\?\.error \?\? .+?\}\); continue \}/)
    expect(spawn).toMatch(/failures\.push\(\{ date, error: 'network error' \}\)/)
    expect(spawn).toMatch(/const outcome = seriesOutcomeMessage\(dates\.length, created, failures\)/)
    expect(src).not.toMatch(/Failed to create some events/)
  })
})
