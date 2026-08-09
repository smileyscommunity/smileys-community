import { describe, it, expect } from 'vitest'
import { seededShuffle, rotationSeed, ROTATION_WINDOW_MS } from '../lib/rotation'

const ids = Array.from({ length: 40 }, (_, i) => `m${i}`)

describe('seededShuffle', () => {
  it('is stable for the same seed — refreshing must not reshuffle', () => {
    expect(seededShuffle(ids, 'u1:2026-08-07')).toEqual(seededShuffle(ids, 'u1:2026-08-07'))
  })

  it('turns over when the window changes', () => {
    expect(seededShuffle(ids, 'u1:900001')).not.toEqual(seededShuffle(ids, 'u1:900002'))
  })

  it('gives two members different orderings of the same pool', () => {
    expect(seededShuffle(ids, 'u1:2026-08-07')).not.toEqual(seededShuffle(ids, 'u2:2026-08-07'))
  })

  it('keeps every member exactly once and does not mutate the input', () => {
    const input = [...ids]
    const out = seededShuffle(input, 'u1:2026-08-07')
    expect([...out].sort()).toEqual([...ids].sort())
    expect(input).toEqual(ids)
  })

  it('actually moves people into the visible top 8 between windows', () => {
    const top = (w: number) => seededShuffle(ids, `u1:${w}`).slice(0, 8)
    const seen = new Set(top(900001))
    expect(top(900002).filter(id => !seen.has(id)).length).toBeGreaterThan(0)
  })

  it('handles empty and single-item pools', () => {
    expect(seededShuffle([], 'seed')).toEqual([])
    expect(seededShuffle(['only'], 'seed')).toEqual(['only'])
  })
})

describe('rotationSeed', () => {
  // Sit a minute into a window so the +5min case can't straddle a boundary.
  const base = 900_000 * ROTATION_WINDOW_MS + 60_000

  it('scopes the seed to the viewer and the rotation window', () => {
    const s = rotationSeed('user-1', '', base)
    expect(s).toBe('user-1:900000')
    expect(rotationSeed('user-2', '', base)).not.toBe(s)
  })

  it('holds still while someone is browsing', () => {
    expect(rotationSeed('user-1', '', base + 5 * 60_000)).toBe(rotationSeed('user-1', '', base))
  })

  it('turns over once they come back later', () => {
    expect(rotationSeed('user-1', '', base + ROTATION_WINDOW_MS)).not.toBe(rotationSeed('user-1', '', base))
  })

  it('salts independent surfaces apart', () => {
    expect(rotationSeed('user-1', 'meet', base)).not.toBe(rotationSeed('user-1', 'clubs', base))
  })
})
