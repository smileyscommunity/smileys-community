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
