import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { cardableSince, windowStart, STANDING_WINDOW_DAYS } from '@/lib/standingPolicy'

// 2026-09-23. Two admin reads answered "how close is this member to a card"
// from the 90-day window ALONE, while issuance answers it from the window AND
// the moment enforcement was switched on (lib/standing.evaluateMember cuts the
// ledger there). Both carried comments promising they could not drift from the
// issuing rule. They could: after enforcement is switched off and on again,
// offences recorded during the off period sit inside the window with no card
// attached — counted by the dashboard, ignored by issuance — so members showed
// as one offence from a yellow when nothing of the sort was true.
//
// The member-facing read (memberStanding) already had the floor right. Only
// the admin side was wrong, which is the worst way round: the page you use to
// decide whether to switch the system on was the one overstating.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const DAY = 24 * 60 * 60 * 1000

describe('cardableSince', () => {
  const now = new Date('2026-09-23T12:00:00Z')

  it('is the plain 90-day window while enforcement is off', () => {
    expect(cardableSince(now, { enforced: false, since: null }).getTime())
      .toBe(windowStart(now).getTime())
  })

  it('falls back to the window when enforcement is on but undated', () => {
    expect(cardableSince(now, { enforced: true, since: null }).getTime())
      .toBe(windowStart(now).getTime())
  })

  it('cuts at the switch when it is more recent than the window', () => {
    // The live case: enforcement went on 2026-09-15, eight days ago, so the
    // window reaches back three months further than anything that can card.
    const since = new Date('2026-09-15T17:57:02Z')
    expect(cardableSince(now, { enforced: true, since }).getTime()).toBe(since.getTime())
  })

  it('keeps the window once enforcement is older than it', () => {
    // A switch thrown a year ago must not widen the window past 90 days.
    const since = new Date(now.getTime() - 400 * DAY)
    expect(cardableSince(now, { enforced: true, since }).getTime())
      .toBe(windowStart(now).getTime())
    expect(now.getTime() - cardableSince(now, { enforced: true, since }).getTime())
      .toBe(STANDING_WINDOW_DAYS * DAY)
  })

  it('never returns a floor in the future', () => {
    const since = new Date(now.getTime() + 5 * DAY)
    expect(cardableSince(now, { enforced: true, since }).getTime()).toBeGreaterThan(windowStart(now).getTime())
  })
})

describe('every "how close to a card" read uses the same floor', () => {
  it('the warnings badge cuts at cardableSince, not the bare window', () => {
    const api = src('app/api/admin/standing/route.ts')
    expect(api).toContain('cardableSince(new Date(), await standingEnforcement())')
    // The call, not the word — the comment above it names windowStart to say
    // what this deliberately is NOT.
    expect(api).not.toContain('windowStart(')
  })

  it('the nearlyCarded tile cuts at cardableSince too', () => {
    const api = src('app/api/admin/standing/enforcement/route.ts')
    expect(api).toContain('cardableSince(new Date(), enforcement)')
    expect(api).not.toContain('windowStart(')
  })

  it('issuance and the member view read it from the same helper', () => {
    const lib = src('lib/standing.ts')
    expect(lib).toContain('const cut = cardableSince(now, enforcement)')
    expect(lib).toContain('const floor = cardableSince(now, enforcement)')
  })
})

describe('the page describes the rule the code actually enforces', () => {
  const page = src('app/admin/standing/page.tsx')

  it('never claims a red card is routed to the host', () => {
    // blocksRsvp refuses the seat outright; the RSVP route answers 403
    // red_card_blocked. Saying "host approval" on the switch that turns this
    // on misdescribes the consequence on the screen that asks to confirm it.
    expect(page).not.toMatch(/host approval/i)
    expect(src('lib/standingPolicy.ts')).not.toMatch(/host approval for red cards/i)
  })

  it('says what actually happens, on the switch and on the banner', () => {
    expect(page).toContain('a red card can no longer take a seat at a limited event at all')
    expect(page).toContain('a red card cannot take a seat at a limited event')
  })

  it('and still says open events are the way back', () => {
    expect(page).toContain('Open events are untouched')
  })
})
