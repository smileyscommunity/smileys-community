import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { reportOrder, isAutoReport, agingWait, waitedTooLong, AGING_DAYS, TOO_LONG_DAYS } from '@/lib/admin/reportQueue'

const read = (p: string) => readFileSync(p, 'utf8')
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

// The queue held four pending reports and showed them newest-first, so the
// harassment report — the only one with a corroborating block — sat third
// under two lower-urgency items, 43 days old, and the 70-day-old one was last.
const LIVE_QUEUE_2026_09_21 = [
  { status: 'pending', reason: 'other',             createdAt: daysAgo(21), who: 'RabiaNur B'      },
  { status: 'pending', reason: 'post_event_survey', createdAt: daysAgo(30), who: 'Hulya .'         },
  { status: 'pending', reason: 'harassment',        createdAt: daysAgo(43), who: 'Ertuğrul Yılmaz' },
  { status: 'pending', reason: 'post_event_survey', createdAt: daysAgo(70), who: 'Ryan Lotfey'     },
]

describe('moderation queue order', () => {
  it('puts the real 2026-09-21 queue in the order a moderator should work it', () => {
    expect([...LIVE_QUEUE_2026_09_21].sort(reportOrder).map(r => r.who)).toEqual([
      'Ertuğrul Yılmaz',  // harassment, member-filed, longest-waiting of those
      'RabiaNur B',       // member-filed
      'Ryan Lotfey',      // survey-generated, oldest
      'Hulya .',          // survey-generated
    ])
  })

  it('outstanding work comes before anything already settled', () => {
    const rows = [
      { status: 'actioned',  reason: 'harassment', createdAt: daysAgo(1)   },
      { status: 'pending',   reason: 'harassment', createdAt: daysAgo(100) },
      { status: 'dismissed', reason: 'harassment', createdAt: daysAgo(2)   },
    ]
    expect(rows.sort(reportOrder)[0].status).toBe('pending')
  })

  it('a member taking the trouble to file outranks the survey sweep', () => {
    // …even when the survey flag is much older, which is the one case where
    // "oldest first" on its own gives the wrong answer.
    const rows = [
      { status: 'pending', reason: 'post_event_survey', createdAt: daysAgo(90) },
      { status: 'pending', reason: 'spam',              createdAt: daysAgo(1)  },
    ]
    expect(rows.sort(reportOrder)[0].reason).toBe('spam')
  })

  it('orders by age inside a group', () => {
    const rows = [
      { status: 'pending', reason: 'spam',  createdAt: daysAgo(3)  },
      { status: 'pending', reason: 'other', createdAt: daysAgo(30) },
      { status: 'pending', reason: 'fake',  createdAt: daysAgo(10) },
    ]
    expect(rows.sort(reportOrder).map(r => r.reason)).toEqual(['other', 'fake', 'spam'])
  })

  it('ranks nothing else by reason — a guess in code buries what it gets wrong', () => {
    // Comments name the incident; the CODE must not branch on a reason
    // other than the survey one, so strip prose before asserting.
    const code = read('lib/admin/reportQueue.ts')
      .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n')
    expect(code).toContain("'post_event_survey'")
    expect(code).not.toMatch(/'(harassment|offensive|spam|no_show|fake|inappropriate|other)'/)
    expect(isAutoReport({ status: 'pending', reason: 'post_event_survey', createdAt: daysAgo(1) })).toBe(true)
    expect(isAutoReport({ status: 'pending', reason: 'harassment',        createdAt: daysAgo(1) })).toBe(false)
  })
})

describe('how long it has waited', () => {
  it('a report filed today looks like nothing in particular', () => {
    expect(agingWait(daysAgo(1))).toBe(false)
    expect(waitedTooLong(daysAgo(1))).toBe(false)
  })
  it('starts showing its age, then stops being ignorable', () => {
    expect(agingWait(daysAgo(AGING_DAYS + 1))).toBe(true)
    expect(waitedTooLong(daysAgo(AGING_DAYS + 1))).toBe(false)
    expect(waitedTooLong(daysAgo(TOO_LONG_DAYS + 1))).toBe(true)
  })
  it('the 43-day harassment report reads as too long', () => {
    expect(waitedTooLong(daysAgo(43))).toBe(true)
  })
})

describe('the page uses all of it', () => {
  const src = read('app/admin/moderation/page.tsx')

  it('sorts the list it renders', () => {
    expect(src).toContain('.sort(reportOrder)')
  })

  it('opens on the work, not on everything', () => {
    expect(src).toMatch(/\? \(searchParams\.get\('status'\) as StatusFilter\) : 'pending'/)
  })

  it('shows an age rather than a date, and keeps showing one', () => {
    // The default cutover turns a relative time back into a date after a
    // week — exactly when a queue item starts to matter.
    expect(src).toContain("timeAgo(r.createdAt, { cutoverDays: 3650 })")
    expect(src).not.toContain('{new Date(r.createdAt).toLocaleDateString()}')
  })

  it('colours a report that has waited, and only while it is outstanding', () => {
    expect(src).toMatch(/r\.status !== 'pending' \? '' : waitedTooLong\(r\.createdAt\)/)
  })
})
