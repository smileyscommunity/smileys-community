import { describe, it, expect } from 'vitest'
import { whatsappUrl } from '@/lib/data'

// Shapes mirror real member records surveyed on 2026-07-11 (the phone
// backfill from applications) — each branch exists because of one of them.
describe('whatsappUrl', () => {
  it('passes through +-prefixed international numbers', () => {
    expect(whatsappUrl('+905443303068', 'Kazakhstan')).toBe('https://wa.me/905443303068')
  })

  it('strips separators', () => {
    expect(whatsappUrl('+90 544 330 30 68', 'Turkey')).toBe('https://wa.me/905443303068')
  })

  it('treats 11-digit 05x numbers as Turkish mobiles regardless of nationality', () => {
    expect(whatsappUrl('05010087512', 'Iran')).toBe('https://wa.me/905010087512')
    expect(whatsappUrl('053 0774 0083', 'Syria')).toBe('https://wa.me/905307740083')
  })

  it('drops the 00 international prefix wa.me does not accept', () => {
    expect(whatsappUrl('00971507239540', 'Palestine')).toBe('https://wa.me/971507239540')
  })

  it('adds 90 to other local-zero formats only for Turkish members', () => {
    expect(whatsappUrl('0212 345 67 89', 'Turkey')).toBe('https://wa.me/902123456789')
    // French local mobile (10 digits) must NOT be mangled into a +90 number.
    expect(whatsappUrl('0612345678', 'France')).toBe('https://wa.me/0612345678')
  })

  it('returns null when there is no number', () => {
    expect(whatsappUrl(null)).toBeNull()
    expect(whatsappUrl('')).toBeNull()
    expect(whatsappUrl('n/a')).toBeNull()
  })
})
