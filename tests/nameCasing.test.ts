import { describe, it, expect } from 'vitest'
import { fixNameCasing, formatName } from '@/lib/data'

// Every case here mirrors a real member record fixed by hand on 2026-07-08;
// the sweeper must reproduce those exact decisions.
describe('fixNameCasing', () => {
  it('de-shouts an ALL-CAPS surname with Turkish casing when nationality is Turkey', () => {
    expect(fixNameCasing('Burak YİĞİTGÜLSÜN', 'Turkey')).toBe('Burak Yiğitgülsün')
  })

  it('uses Turkish dotless ı for I when nationality is Turkey', () => {
    expect(fixNameCasing('AYŞE YILMAZ', 'Turkey')).toBe('Ayşe Yılmaz')
  })

  it('uses default casing (I → i) for non-Turkish members', () => {
    expect(fixNameCasing('Phuong NGO NGOC', 'France')).toBe('Phuong Ngo Ngoc')
    expect(fixNameCasing('YILMAZ', 'Germany')).toBe('Yilmaz')
  })

  it('leaves 1–3 letter caps words alone — they are deliberate initials', () => {
    expect(fixNameCasing('Naz MDT', 'Iran')).toBe('Naz MDT')
    expect(fixNameCasing('Nina AE', 'Turkey')).toBe('Nina AE')
    expect(fixNameCasing('Nour AB', 'Lebanon')).toBe('Nour AB')
  })

  it('fixes lowercase-starting words via formatName', () => {
    expect(fixNameCasing('tarık özçelik', 'Turkey')).toBe('Tarık Özçelik')
    expect(fixNameCasing('Mirza taimoor Zafar', 'Pakistan')).toBe('Mirza Taimoor Zafar')
    expect(fixNameCasing('walid wahba', 'Egypt')).toBe('Walid Wahba')
  })

  it('handles hyphenated shouted names token by token', () => {
    expect(fixNameCasing('JEAN-PIERRE Martin', 'France')).toBe('Jean-Pierre Martin')
  })

  it('preserves intentional mixed casing', () => {
    expect(fixNameCasing('Alice McKenzie', 'Ireland')).toBe('Alice McKenzie')
    expect(fixNameCasing('İbrahim Şahin', 'Turkey')).toBe('İbrahim Şahin')
  })

  it('is idempotent', () => {
    const once = fixNameCasing('AYŞE YILMAZ', 'Turkey')
    expect(fixNameCasing(once, 'Turkey')).toBe(once)
  })

  it('never regresses plain formatName behaviour when nationality is missing', () => {
    expect(fixNameCasing('hagar atef', null)).toBe(formatName('hagar atef'))
  })
})
