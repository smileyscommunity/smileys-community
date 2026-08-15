import { describe, it, expect } from 'vitest'
import { countryName, toCountryCode } from '@/lib/country'

describe('countryName', () => {
  it('renders a code as a readable name', () => {
    // 'Türkiye', not 'Turkey' — ICU carries the official 2022 rename, which is
    // the correct rendering for a platform headquartered in Istanbul.
    expect(countryName('TR')).toBe('Türkiye')
    expect(countryName('PT')).toBe('Portugal')
  })
  it('passes legacy full-name rows through unchanged', () => {
    // Until every row is normalised, a stray 'TURKEY' must still render.
    expect(countryName('TURKEY')).toBe('TURKEY')
  })
  it('handles empty input', () => {
    expect(countryName(null)).toBe('')
    expect(countryName('')).toBe('')
  })
})

describe('toCountryCode', () => {
  it('normalises case and whitespace', () => {
    expect(toCountryCode(' tr ')).toBe('TR')
  })
  it('rejects full country names — the input that caused the drift', () => {
    expect(toCountryCode('Turkey')).toBeNull()
    expect(toCountryCode('TURKEY')).toBeNull()
  })
  it('rejects well-formed but unreal regions', () => {
    expect(toCountryCode('ZZ')).toBeNull()
  })
  it('rejects non-strings and junk', () => {
    expect(toCountryCode(undefined)).toBeNull()
    expect(toCountryCode('T')).toBeNull()
    expect(toCountryCode('12')).toBeNull()
  })
})

// approx() lives next door in lib/communityStats and guards the same property:
// a published number must never overstate what the database says.
import { approx } from '@/lib/communityStats'

describe('approx', () => {
  it('never rounds up', () => {
    expect(approx(147)).toBe('140+')     // not 150+
    expect(approx(216)).toBe('200+')
    expect(approx(1442)).toBe('1,400+')
  })
  it('keeps small numbers exact rather than flattering them', () => {
    expect(approx(0)).toBe('0')
    expect(approx(42)).toBe('42')
    expect(approx(99)).toBe('99')
  })
  it('rounds 147 to 140+, not the 100+ a flat step would give', () => {
    expect(approx(147)).not.toBe('100+')
  })
})
