import { describe, it, expect } from 'vitest'
import { scoreEvent, type ScoreInput, type ScoreContext } from '@/lib/firstEvent'

// Fixed context: member in Kadıköy who wants Social + Food events, "today" is
// 2026-07-05 and the soon window closes 2026-07-12.
const ctx: ScoreContext = {
  wantedTagIds: new Set(['t_social', 't_food']),
  userNeighborhood: 'Kadıköy',
  todayStr: '2026-07-05',
  soonCutoffStr: '2026-07-12',
}
const ev = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  neighborhood: 'Kadıköy',
  isFirstTimerFriendly: false,
  tagIds: [],
  attendeeCount: 0,
  date: '2026-07-06',
  ...over,
})

describe('scoreEvent', () => {
  it('scores interest overlap through the mapped tag ids', () => {
    const { reason } = scoreEvent(ev({ tagIds: ['t_social', 't_food', 't_chill'] }), ctx)
    expect(reason.interestOverlap).toBe(2)              // t_chill is not wanted
    expect(reason.matchedTagIds).toEqual(['t_social', 't_food'])
  })

  it('caps interest overlap so one event cannot run away', () => {
    // 4 wanted tags but cap is 3
    const bigCtx: ScoreContext = { ...ctx, wantedTagIds: new Set(['a', 'b', 'c', 'd']) }
    const { reason } = scoreEvent(ev({ tagIds: ['a', 'b', 'c', 'd'] }), bigCtx)
    expect(reason.interestOverlap).toBe(3)
  })

  it('rewards first-timer-friendly and same-neighborhood events', () => {
    const base = scoreEvent(ev(), ctx).score
    const friendly = scoreEvent(ev({ isFirstTimerFriendly: true }), ctx).score
    expect(friendly).toBe(base + 2)
    const away = scoreEvent(ev({ neighborhood: 'Şişli' }), ctx).score
    expect(base).toBe(away + 2)                         // same-nbhd is worth +2
  })

  it('gives cross-neighborhood credit only when the event is popular', () => {
    const quietAway = scoreEvent(ev({ neighborhood: 'Şişli', attendeeCount: 2 }), ctx).reason
    expect(quietAway.worthTrip).toBe(false)
    const popularAway = scoreEvent(ev({ neighborhood: 'Şişli', attendeeCount: 10 }), ctx).reason
    expect(popularAway.worthTrip).toBe(true)
  })

  it('flags soon vs later against the window', () => {
    expect(scoreEvent(ev({ date: '2026-07-10' }), ctx).reason.soon).toBe(true)
    expect(scoreEvent(ev({ date: '2026-07-20' }), ctx).reason.soon).toBe(false)
  })

  it('ranks a relevant, nearby, first-timer event above a bare one', () => {
    const ideal = scoreEvent(ev({ tagIds: ['t_social', 't_food'], isFirstTimerFriendly: true, attendeeCount: 5 }), ctx).score
    const bare = scoreEvent(ev({ neighborhood: 'Şişli', date: '2026-07-25' }), ctx).score
    expect(ideal).toBeGreaterThan(bare)
  })
})
