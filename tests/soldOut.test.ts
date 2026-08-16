import { describe, it, expect } from 'vitest'
import { isSoldOut, isManuallySoldOut } from '@/lib/soldOut'

// The card's stamp, the detail page's banner, the structured data and the
// three RSVP join paths all ask these two questions. They were four separate
// hand-written copies of the counter rule before, none of which knew a manual
// flag existed — so the risk being pinned here is disagreement, not arithmetic.

describe('isSoldOut', () => {
  it('is false for an event with spots left', () => {
    expect(isSoldOut({ limitedSpots: true, spotsLeft: 4 })).toBe(false)
  })

  it('is true when the counter runs out', () => {
    expect(isSoldOut({ limitedSpots: true, spotsLeft: 0 })).toBe(true)
  })

  it('ignores the counter when the event has no spot limit', () => {
    // An unlimited event sits at spotsLeft 0 as a matter of course; reading
    // that as sold out would close every open-door event on the site.
    expect(isSoldOut({ limitedSpots: false, spotsLeft: 0 })).toBe(false)
  })

  it('is true when a human says so, whatever the counter says', () => {
    expect(isSoldOut({ soldOut: true, limitedSpots: true, spotsLeft: 12 })).toBe(true)
    expect(isSoldOut({ soldOut: true, limitedSpots: false, spotsLeft: 99 })).toBe(true)
  })

  it('treats missing fields as open rather than closed', () => {
    // Partial event shapes are everywhere (cards, search results). Defaulting
    // to sold out would silently shut events that are running fine.
    expect(isSoldOut({})).toBe(false)
  })
})

describe('isManuallySoldOut', () => {
  it('distinguishes a human decision from a full house', () => {
    expect(isManuallySoldOut({ soldOut: true, limitedSpots: true, spotsLeft: 12 })).toBe(true)
    // Flag set AND genuinely full: the count already explains it, so the
    // interface shouldn't claim someone made a call.
    expect(isManuallySoldOut({ soldOut: true, limitedSpots: true, spotsLeft: 0 })).toBe(false)
    expect(isManuallySoldOut({ limitedSpots: true, spotsLeft: 0 })).toBe(false)
  })
})
