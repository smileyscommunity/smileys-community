import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { stillCorrectable, doorEventsWhere } from '@/lib/checkInPrompt'
import { HOST_MARKING_WINDOW_DAYS } from '@/lib/standingPolicy'

const src = (p: string) => readFileSync(p, 'utf-8')
const ev = (id: string, date: string, status = 'archived') =>
  ({ id, date, time: '19:00', endTime: null, status, timezone: 'Europe/Istanbul' }) as never

// A host can mark or waive for HOST_MARKING_WINDOW_DAYS after a room settles,
// but the page that does it listed two days of events. The window existed in
// the API and nowhere a host could reach it.

describe('the door list reaches as far as a host may still act', () => {
  it('asks the database for the whole marking window', () => {
    const where = doorEventsWhere('u1', new Date('2026-10-20T12:00:00Z')) as { date: { gte: string } }
    const days = (new Date('2026-10-20') .getTime() - new Date(where.date.gte).getTime()) / 86_400_000
    expect(days).toBeGreaterThanOrEqual(HOST_MARKING_WINDOW_DAYS)
  })

  it('offers a settled room that is still correctable, newest first', () => {
    const now = new Date('2026-10-20T12:00:00Z')
    const got = stillCorrectable([ev('old', '2026-10-05'), ev('recent', '2026-10-18')], 'Europe/Istanbul', now)
    expect(got.map(e => e.id)).toEqual(['recent', 'old'])
  })

  it('leaves out a room that has not settled — that is the prompt’s job, not this list', () => {
    const now = new Date('2026-10-20T12:00:00Z')
    expect(stillCorrectable([ev('tonight', '2026-10-20', 'published')], 'Europe/Istanbul', now)).toEqual([])
  })

  it('leaves out a room past the window', () => {
    const now = new Date('2026-12-01T12:00:00Z')
    expect(stillCorrectable([ev('ancient', '2026-10-05')], 'Europe/Istanbul', now)).toEqual([])
  })
})

describe('the three pages reach each other', () => {
  it('check-in links to the queue that chases it', () => {
    expect(src('app/host/checkin/page.tsx')).toContain('href="/host/review"')
    expect(src('app/admin/checkin/page.tsx')).toContain('href="/admin/attendance-review"')
  })
  it('an offence links to the door it happened at', () => {
    expect(src('app/admin/standing/page.tsx')).toContain('/admin/checkin?event=${o.event.id}')
  })
})
