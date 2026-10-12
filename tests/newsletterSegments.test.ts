import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { SEGMENTS, SEGMENT_INFO, isSegment, recipientWhere } from '@/lib/newsletterSegments'

const NOW = new Date('2026-10-13T10:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

describe('newsletter audiences', () => {
  it('every audience has a label and a description for the page', () => {
    for (const s of SEGMENTS) {
      expect(SEGMENT_INFO[s].label.length).toBeGreaterThan(0)
      expect(SEGMENT_INFO[s].desc.length).toBeGreaterThan(0)
    }
  })

  it('never attended: activated members with no approved event, admins and partners out', () => {
    const w = recipientWhere('never_attended_new', undefined, NOW) as Record<string, unknown>
    expect(w).toMatchObject({
      emailMarketing: true, emailVerified: true, status: 'approved',
      password: { not: null },
      role: { notIn: ['admin', 'partner'] },
      joinedEvents: { none: { status: 'approved' } },
    })
  })

  it('splits the never-attended cohort into two non-overlapping batches, with a week of grace', () => {
    const recent = recipientWhere('never_attended_new', undefined, NOW) as { joinedAt: { gte: Date; lt: Date } }
    const older  = recipientWhere('never_attended_old', undefined, NOW) as { joinedAt: { lt: Date } }
    expect(recent.joinedAt).toEqual({ gte: daysAgo(60), lt: daysAgo(7) })
    expect(older.joinedAt).toEqual({ lt: daysAgo(60) })
  })

  it('narrows any audience to a city when given one', () => {
    expect(recipientWhere('never_attended_old', 'c1', NOW)).toMatchObject({ cityId: 'c1' })
    expect(recipientWhere('all', 'c1', NOW)).toMatchObject({ cityId: 'c1' })
  })

  it('an unknown audience matches nobody, never the whole list', () => {
    expect(recipientWhere('everyone-please', undefined, NOW)).toEqual({ id: { in: [] } })
    expect(isSegment('everyone-please')).toBe(false)
    expect(isSegment('never_attended_new')).toBe(true)
  })

  it('the page, the send route and the scheduled sweeper read the one shared list', () => {
    for (const f of ['app/admin/newsletter/page.tsx', 'app/api/admin/newsletter/route.ts', 'app/api/cron/sweep-newsletters/route.ts']) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).toMatch(/from '@\/lib\/newsletterSegments'/)
      expect(src, f).not.toMatch(/type Segment = 'all'/)
      expect(src, f).not.toMatch(/function recipientWhere/)
    }
  })

  it('the send route refuses an unknown audience instead of reading it as "all"', () => {
    const src = readFileSync('app/api/admin/newsletter/route.ts', 'utf8')
    expect(src).toMatch(/!isSegment\(body\.segment\)[\s\S]{0,200}status: 400/)
  })
})
