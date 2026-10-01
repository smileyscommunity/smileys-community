import { describe, it, expect } from 'vitest'
import { stripEmoji, priceLabel, offerAvailability, eventSeoTitle, eventSeoDescription } from '@/lib/eventSeo'

describe('stripEmoji', () => {
  it('removes pictographs, variation selectors and joiners, keeps text', () => {
    expect(stripEmoji('Blood on the Clocktower 🌙')).toBe('Blood on the Clocktower')
    expect(stripEmoji('🕰️👹 Welcome 👨‍👩‍👧 to Ravenswood')).toBe('Welcome to Ravenswood')
  })
  it('keeps Turkish letters and digits', () => {
    expect(stripEmoji('Kadıköy 18:30 ✨')).toBe('Kadıköy 18:30')
  })
})

describe('title and description', () => {
  it('leads with what, when, where and price', () => {
    expect(eventSeoTitle({ title: 'Sailing 🌊', shareDate: 'Sun 15 Nov', neighborhood: 'Kadıköy', price: '₺1,200' }))
      .toBe('Sailing · Sun 15 Nov, Kadıköy · ₺1,200 — Smileys Community')
  })
  it('never starts with an emoji and stays within 155', () => {
    const d = eventSeoDescription({ when: 'Friday, November 20 at 18:30', price: 'Free', neighborhood: 'Kadıköy', body: '🕰️👹 '.repeat(5) + 'x'.repeat(300) })
    expect(d.startsWith('Free event in Kadıköy')).toBe(true)
    expect(d.length).toBeLessThanOrEqual(155)
    expect(/\p{Extended_Pictographic}/u.test(d)).toBe(false)
  })
  it('falls back to the lead when there is no body', () => {
    expect(eventSeoDescription({ when: 'Sat', price: 'Free', body: '' })).toBe('Free event, Sat.')
  })
  it('labels zero as Free', () => {
    expect(priceLabel(0, p => `₺${p}`)).toBe('Free')
    expect(priceLabel(250, p => `₺${p}`)).toBe('₺250')
  })
})

describe('offerAvailability', () => {
  it('sold out beats everything', () => {
    expect(offerAvailability({ soldOut: true })).toContain('SoldOut')
    expect(offerAvailability({ limitedSpots: true, spotsLeft: 0 })).toContain('SoldOut')
  })
  it('few spots left is limited, plenty or uncapped is in stock', () => {
    expect(offerAvailability({ limitedSpots: true, spotsLeft: 2 })).toContain('LimitedAvailability')
    expect(offerAvailability({ limitedSpots: true, spotsLeft: 12 })).toContain('InStock')
    expect(offerAvailability({ limitedSpots: false, spotsLeft: 2 })).toContain('InStock')
  })
})

import { cancelLine } from '@/lib/eventGoodToKnow'
import { CANCEL_CUTOFF_HOURS } from '@/lib/standingPolicy'

describe('cancelLine — the event page says the number the sweep uses', () => {
  const base = { status: 'published' } as Parameters<typeof cancelLine>[0]
  it('limited events quote the real cutoff', () => {
    expect(cancelLine({ ...base, limitedSpots: true })).toContain(`more than ${CANCEL_CUTOFF_HOURS.scarce} hours`)
  })
  it('a host-set cutoff wins', () => {
    expect(cancelLine({ ...base, limitedSpots: true, cancelCutoffHours: 12 })).toContain('more than 12 hours')
  })
  it('uncapped events say cancelling never counts', () => {
    expect(cancelLine({ ...base, limitedSpots: false })).toContain('never counts against you')
  })
})

import { readFileSync } from 'fs'
describe('one events figure on every public page', () => {
  it.each(['app/about/page.tsx', 'app/why/page.tsx', 'app/advertise/page.tsx', 'app/get-involved/page.tsx'])('%s uses eventsStat, not its own count', f => {
    const src = readFileSync(f, 'utf8')
    expect(src).toContain('eventsStat(s.events)')
    expect(src).not.toContain("label: 'Events on Smileys'")
  })
})

import { COUNTED_CLUB_MEMBERSHIP_WHERE, ENROLLED_CLUB_MEMBERSHIP_WHERE } from '@/lib/clubMemberCount'
describe('club member counts count activated members only', () => {
  it('the counted rule adds activation to the enrolment rule', () => {
    expect(COUNTED_CLUB_MEMBERSHIP_WHERE.user).toEqual({ ...ENROLLED_CLUB_MEMBERSHIP_WHERE.user, password: { not: null } })
  })
})
