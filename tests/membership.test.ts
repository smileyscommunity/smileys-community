import { describe, it, expect } from 'vitest'
import { isPremium, membershipTierLabel, MEMBERSHIP_TYPES } from '@/lib/membership'

describe('membership tier helpers', () => {
  it('isPremium is true only for paid tiers', () => {
    expect(isPremium('premium')).toBe(true)
    expect(isPremium('vip')).toBe(true)
  })

  it('isPremium is false for free / unknown / empty', () => {
    expect(isPremium('free')).toBe(false)
    expect(isPremium('member')).toBe(false)
    expect(isPremium('')).toBe(false)
    expect(isPremium(null)).toBe(false)
    expect(isPremium(undefined)).toBe(false)
  })

  it('membershipTierLabel maps paid tiers and returns null otherwise', () => {
    expect(membershipTierLabel('premium')).toBe('Premium')
    expect(membershipTierLabel('vip')).toBe('VIP')
    expect(membershipTierLabel('free')).toBeNull()
    expect(membershipTierLabel(null)).toBeNull()
    expect(membershipTierLabel(undefined)).toBeNull()
  })

  it('MEMBERSHIP_TYPES is the canonical closed set (matches the admin validator)', () => {
    expect([...MEMBERSHIP_TYPES]).toEqual(['free', 'premium', 'vip'])
  })
})
