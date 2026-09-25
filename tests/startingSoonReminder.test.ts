import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { startingSoonDue, startingSoonBody, localHour } from '@/lib/startingSoonReminder'

// "Starting soon" moved from ~2h to ~6h before the event (2026-09-26), with a
// night guard so a morning event doesn't ping members at 03:00.

describe('startingSoonDue', () => {
  it('sends about six hours ahead during the day', () => {
    // 19:00 event: the 13:00 tick is 6h out.
    expect(startingSoonDue(6, 13)).toBe(true)
    expect(startingSoonDue(5.5, 14)).toBe(true)
  })

  it('does not send earlier than the lead', () => {
    expect(startingSoonDue(7, 12)).toBe(false)
  })

  it('holds a night-time six-hour mark for the first morning tick', () => {
    // 10:00 event: 04:00 is 6h out but night; 08:00 (2h out) sends.
    expect(startingSoonDue(6, 4)).toBe(false)
    expect(startingSoonDue(2, 8)).toBe(true)
  })

  it('never sends between 23:00 and 07:59', () => {
    expect(startingSoonDue(6, 23)).toBe(false)
    expect(startingSoonDue(6, 0)).toBe(false)
    expect(startingSoonDue(6, 7)).toBe(false)
  })

  it('skips an event under an hour away', () => {
    // 08:30 event: the 08:00 tick is only 0.5h out — the day-before reminder covers it.
    expect(startingSoonDue(0.5, 8)).toBe(false)
  })
})

describe('startingSoonBody', () => {
  it('rounds the lead to the hour', () => {
    expect(startingSoonBody('Coffee', '19:00', 6.2)).toBe('"Coffee" starts in ~6 hours at 19:00')
    expect(startingSoonBody('Coffee', '10:00', 2)).toBe('"Coffee" starts in ~2 hours at 10:00')
    expect(startingSoonBody('Coffee', '09:30', 1.2)).toBe('"Coffee" starts in ~1 hour at 09:30')
  })
})

describe('localHour', () => {
  it('reads the city clock, midnight as 0', () => {
    // 21:00 UTC = 00:00 in Istanbul (UTC+3).
    expect(localHour(new Date('2026-09-26T21:00:00Z'), 'Europe/Istanbul')).toBe(0)
    expect(localHour(new Date('2026-09-26T10:00:00Z'), 'Europe/Istanbul')).toBe(13)
  })
})

describe('the sweep uses it', () => {
  const route = readFileSync(join(__dirname, '..', 'app/api/admin/cron/reminders/route.ts'), 'utf8')
  it('decides the starting-soon send with startingSoonDue, not a fixed 1–3h window', () => {
    expect(route).toContain('startingSoonDue(diffHours, localHour(now, tzByCity.get(event.cityId) ?? DEFAULT_TZ))')
    expect(route).not.toContain('diffHours >= 1  && diffHours <= 3')
  })
})
