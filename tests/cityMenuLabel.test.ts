import { describe, it, expect } from 'vitest'
import { cityMenuLabel } from '@/lib/cityMenuLabel'

// The Cities menu put LIVE beside Ankara and Bursa, which had zero members
// and no event, in the same green as Istanbul. Status was right; the badge
// was not. The label now joins status with derived maturity.

describe('what the Cities menu calls a city', () => {
  it('a live city that is still seeding is Founding, never Live', () => {
    expect(cityMenuLabel('live', 'seeding')).toBe('founding')
  })
  it('a live city with people in it is Live', () => {
    expect(cityMenuLabel('live', 'forming')).toBe('live')
    expect(cityMenuLabel('live', 'self_sustaining')).toBe('live')
  })
  it('unknown maturity falls back to the status word, not the flattering one', () => {
    // A stale client or a failed stats query must not turn an empty city green
    // — but it also must not hide a real one; "live" is the status, honestly.
    expect(cityMenuLabel('live', null)).toBe('live')
    expect(cityMenuLabel('live', undefined)).toBe('live')
  })
  it('anything not live is coming soon whatever its maturity says', () => {
    expect(cityMenuLabel('coming_soon', 'self_sustaining')).toBe('coming_soon')
    expect(cityMenuLabel('preparing', null)).toBe('coming_soon')
    expect(cityMenuLabel('paused', 'forming')).toBe('coming_soon')
  })
})
