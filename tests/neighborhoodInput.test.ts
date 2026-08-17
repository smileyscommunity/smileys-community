import { describe, it, expect, vi, beforeEach } from 'vitest'

// The rule every write path that sets User.neighborhood must apply. Pinned
// because the failure it prevents is silent and flattering: a member with a
// value that isn't in their city's registry keeps a filled-in profile while
// being excluded from their own neighborhood page, "members near you" and
// neighborhood event matching. Nobody reports it. 33 prod rows had to be
// repaired by hand before this existed (scripts/fix-member-neighborhoods.ts).

vi.mock('@/lib/prisma', () => ({ prisma: { neighborhood: { findMany: vi.fn() } } }))
vi.mock('@/lib/city', () => ({
  getCityConfig:     vi.fn(async () => ({ slug: 'bodrum' })),
  DEFAULT_CITY_SLUG: 'istanbul',
}))

import { prisma } from '@/lib/prisma'
import { normalizeNeighborhoodInput, classifyNeighborhoodValue, foldPlaceName, coerceNeighborhoodFor } from '@/lib/neighborhoodsDb'

const BODRUM = [{ name: 'Bodrum Merkez' }, { name: 'Gümbet' }, { name: 'Yalıkavak' }]

beforeEach(() => {
  vi.clearAllMocks()
  // getNeighborhoodsForCity memoizes per cityId for 5 minutes, so each test
  // uses a fresh city id rather than fighting the cache.
  ;(prisma.neighborhood.findMany as any).mockResolvedValue(BODRUM)
})

let n = 0
const freshCity = () => `c-bodrum-${n++}`

describe('normalizeNeighborhoodInput', () => {
  it('accepts a real neighborhood of the city', async () => {
    expect(await normalizeNeighborhoodInput(freshCity(), 'Gümbet')).toEqual({ ok: true, value: 'Gümbet' })
  })

  it('trims before matching', async () => {
    expect(await normalizeNeighborhoodInput(freshCity(), '  Gümbet  ')).toEqual({ ok: true, value: 'Gümbet' })
  })

  it('treats blank as "clear it", never as a value', async () => {
    // The 21-row bug: '' stored as if it were a neighborhood.
    for (const blank of ['', '   ', null, undefined]) {
      expect(await normalizeNeighborhoodInput(freshCity(), blank)).toEqual({ ok: true, value: null })
    }
  })

  it('rejects another city\'s neighborhood', async () => {
    // A Bodrum member holding an Istanbul district — how Serhan Baykan ended
    // up with "Beyoğlu" and two Antalya members with "Kadıköy" / "Moda".
    const res = await normalizeNeighborhoodInput(freshCity(), 'Kadıköy')
    expect(res.ok).toBe(false)
  })

  it('rejects a diacritic-stripped near-miss rather than storing it', async () => {
    // 'Gumbet' looks right to a human and matches nothing. The repair script
    // folds these; the write path's job is to never accept one in the first
    // place, since the picker offers the real spelling.
    expect((await normalizeNeighborhoodInput(freshCity(), 'Gumbet')).ok).toBe(false)
    expect((await normalizeNeighborhoodInput(freshCity(), 'gümbet')).ok).toBe(false)
  })

  it('rejects non-text and over-long input', async () => {
    expect((await normalizeNeighborhoodInput(freshCity(), 42)).ok).toBe(false)
    expect((await normalizeNeighborhoodInput(freshCity(), { name: 'Gümbet' })).ok).toBe(false)
    expect((await normalizeNeighborhoodInput(freshCity(), 'x'.repeat(201))).ok).toBe(false)
  })

  it('accepts nothing at all for a city with no neighborhoods seeded', async () => {
    // Antalya's state: nothing valid exists, so every value must be refused —
    // and clearing must still work, which is the only honest option there.
    ;(prisma.neighborhood.findMany as any).mockResolvedValue([])
    const city = freshCity()
    expect((await normalizeNeighborhoodInput(city, 'Kadıköy')).ok).toBe(false)
    expect(await normalizeNeighborhoodInput(city, '')).toEqual({ ok: true, value: null })
  })

  it('only ever queries that city\'s ACTIVE neighborhoods', async () => {
    const city = freshCity()
    await normalizeNeighborhoodInput(city, 'Gümbet')
    expect((prisma.neighborhood.findMany as any).mock.calls[0][0].where).toEqual({ cityId: city, active: true })
  })
})

// The classifier the weekly scan (scan-neighborhood-hygiene.ts) and the repair
// script (fix-member-neighborhoods.ts) share, so "fixable" can't come to mean
// two different things in the report and the fix.
describe('classifyNeighborhoodValue', () => {
  it('separates valid from merely-close', async () => {
    expect(await classifyNeighborhoodValue(freshCity(), 'Gümbet')).toEqual({ kind: 'valid', name: 'Gümbet' })
    // Spelling-only difference → the repair script can resolve it unattended.
    expect(await classifyNeighborhoodValue(freshCity(), 'Gumbet')).toEqual({ kind: 'canonical', name: 'Gümbet' })
    expect(await classifyNeighborhoodValue(freshCity(), 'gümbet')).toEqual({ kind: 'canonical', name: 'Gümbet' })
  })

  it('calls another city\'s district unknown, not fixable', async () => {
    // Orphaned: nothing in Bodrum folds to 'Kadıköy', so no automatic answer
    // exists — this is the bucket that needs a human or CLEAR_UNMATCHED=1.
    expect(await classifyNeighborhoodValue(freshCity(), 'Kadıköy')).toEqual({ kind: 'unknown' })
  })

  it('treats blank as blank, not as a defect', async () => {
    expect(await classifyNeighborhoodValue(freshCity(), '')).toEqual({ kind: 'blank' })
    expect(await classifyNeighborhoodValue(freshCity(), null)).toEqual({ kind: 'blank' })
  })

  it('refuses to guess when two registry rows fold alike', async () => {
    // A city naming both 'Merkez' and 'merkéz' must never be auto-resolved:
    // silently picking one would write a value the member never chose.
    ;(prisma.neighborhood.findMany as any).mockResolvedValue([{ name: 'Merkez' }, { name: 'Merkéz' }])
    const v = await classifyNeighborhoodValue(freshCity(), 'merkez')
    expect(v.kind).toBe('ambiguous')
    expect(v.kind === 'ambiguous' && v.matches).toEqual(['Merkez', 'Merkéz'])
  })
})

describe('foldPlaceName', () => {
  it('folds every Turkish letter that broke real member data', async () => {
    // The 9 prod values and their canonical spellings.
    const pairs: [string, string][] = [
      ['Beyoglu', 'Beyoğlu'], ['Besiktas', 'Beşiktaş'], ['Uskudar', 'Üsküdar'],
      ['Sariyer', 'Sarıyer'], ['sarıyer', 'Sarıyer'], ['Bakirkoy', 'Bakırköy'],
      ['Bahcelievler', 'Bahçelievler'], ['Eyupsultan', 'Eyüpsultan'], ['Zekeriyakoy', 'Zekeriyaköy'],
    ]
    for (const [typed, canonical] of pairs) {
      expect(foldPlaceName(typed)).toBe(foldPlaceName(canonical))
    }
  })

  it('does not collapse genuinely different names', async () => {
    expect(foldPlaceName('Moda')).not.toBe(foldPlaceName('Modo'))
    expect(foldPlaceName('Bitez')).not.toBe(foldPlaceName('Bodrum Merkez'))
  })

  it('ignores spacing and punctuation', async () => {
    expect(foldPlaceName('  Bodrum   Merkez ')).toBe(foldPlaceName('Bodrum-Merkez'))
  })
})

// Registration and application-approval coerce instead of rejecting, so a bad
// neighborhood can't block an approved member from signing up. The cost is that
// the loss leaves no trace in the data — a NULL is indistinguishable from
// "never set", and the weekly scan can only see what's still there. The log line
// IS the trace, so it's tested like any other output.
describe('coerceNeighborhoodFor', () => {
  it('keeps a valid value silently', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await coerceNeighborhoodFor(freshCity(), 'Gümbet', 'register')).toBe('Gümbet')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('rescues a spelling variant rather than dropping it, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await coerceNeighborhoodFor(freshCity(), 'Gumbet', 'register')).toBe('Gümbet')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('canonicalized')
    warn.mockRestore()
  })

  it('logs the dropped value, the reason and the city when nothing matches', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const city = freshCity()
    expect(await coerceNeighborhoodFor(city, 'Kadıköy', 'approve application app_1')).toBeNull()
    const msg = String(warn.mock.calls[0][0])
    // Everything needed to diagnose a stale client from the PM2 log alone.
    expect(msg).toContain('DROPPED')
    expect(msg).toContain('Kadıköy')
    expect(msg).toContain('approve application app_1')
    expect(msg).toContain(city)
    warn.mockRestore()
  })

  it('stays quiet for a blank value — nothing was lost', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await coerceNeighborhoodFor(freshCity(), '', 'register')).toBeNull()
    expect(await coerceNeighborhoodFor(freshCity(), null, 'register')).toBeNull()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('names both candidates when the registry itself is ambiguous', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;(prisma.neighborhood.findMany as any).mockResolvedValue([{ name: 'Merkez' }, { name: 'Merkéz' }])
    expect(await coerceNeighborhoodFor(freshCity(), 'merkez', 'register')).toBeNull()
    expect(String(warn.mock.calls[0][0])).toContain('ambiguous between Merkez / Merkéz')
    warn.mockRestore()
  })
})
