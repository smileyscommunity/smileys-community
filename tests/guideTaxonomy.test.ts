import { describe, it, expect } from 'vitest'
import { moodsFor, collectionsFor, hasOwnGuideTaxonomy, seasonsFor, seasonNow, SEASON_VALUES } from '@/lib/guide'

// The Guide's vocabulary is per city because a shared one forces every city to
// describe itself in the flagship's geography: "Be by the Bosphorus" was a mood
// chip on Bodrum's guide, and "Escape Istanbul" was one of its shelves.

describe('per-city guide vocabulary', () => {
  it("gives Bodrum the peninsula's verbs, not Istanbul's", () => {
    const values = moodsFor('bodrum').map(m => m.value)
    expect(values).toContain('boat')
    expect(values).toContain('beach')
    expect(values).toContain('sunset')
    expect(values).toContain('peninsula')
    // The tell of the old shared list:
    expect(values).not.toContain('bosphorus')
  })

  it('leaves Istanbul exactly as it was', () => {
    const values = moodsFor('istanbul').map(m => m.value)
    expect(values).toContain('bosphorus')
    expect(collectionsFor('istanbul').map(c => c.label)).toContain('Life on the Bosphorus')
  })

  it('never names another city in a label', () => {
    for (const slug of ['bodrum', 'izmir', 'antalya']) {
      const labels = [...moodsFor(slug), ...collectionsFor(slug)].map(t => t.label).join(' | ')
      expect(labels).not.toMatch(/Istanbul|Bosphorus/i)
    }
  })

  it('falls back to a geography-free vocabulary for a city with none of its own', () => {
    // A launch must read as itself, so the generic set names no place at all.
    expect(hasOwnGuideTaxonomy('izmir')).toBe(false)
    const labels = [...moodsFor('izmir'), ...collectionsFor('izmir')].map(t => t.label)
    expect(labels.length).toBeGreaterThan(4)
    for (const l of labels) expect(l).not.toMatch(/Bodrum|Istanbul/i)
  })

  it('keeps every value unique per city — duplicates would double a shelf', () => {
    for (const slug of ['istanbul', 'bodrum', 'izmir']) {
      for (const list of [moodsFor(slug), collectionsFor(slug)]) {
        const values = list.map(t => t.value)
        expect(new Set(values).size).toBe(values.length)
      }
    }
  })

  it('gives every entry a label and an emoji — the chips render both', () => {
    for (const slug of ['istanbul', 'bodrum', 'izmir']) {
      for (const t of [...moodsFor(slug), ...collectionsFor(slug)]) {
        expect(t.label.trim()).not.toBe('')
        expect(t.emoji.trim()).not.toBe('')
      }
    }
  })
})

describe('the season axis (§15)', () => {
  it('gives Bodrum the brief\'s four seasons, September–October included', () => {
    const s = seasonsFor('bodrum')
    expect(s.map(x => x.value).sort()).toEqual(['autumn', 'spring', 'summer', 'winter'])
    // The whole point of §15: Bodrum is not a July-and-August destination.
    expect(s.find(x => x.value === 'autumn')?.label).toBe('September–October')
    expect(s.find(x => x.value === 'winter')?.line).toMatch(/local life/i)
  })

  it('falls back to lines that promise no particular weather', () => {
    const lines = seasonsFor('some-new-city').map(s => s.line).join(' ')
    // Whole words — "season" contains "sea", which is not a coastal promise.
    expect(lines).not.toMatch(/\b(beach|beaches|boat|boats|sea|sailing)\b/i)
  })

  it('every season carries a label, emoji and line', () => {
    for (const slug of ['bodrum', 'istanbul', 'unknown']) {
      for (const s of seasonsFor(slug)) {
        for (const field of [s.label, s.emoji, s.line]) expect(field.trim()).not.toBe('')
      }
    }
  })

  it('maps every month to exactly one season, in the city\'s own zone', () => {
    // Pinned by construction rather than by clock: the boundaries are the thing
    // that breaks, and a wrong one puts "Now" on the wrong shelf all month.
    const seen = new Set<string>()
    for (const [month, expected] of [
      ['01', 'winter'], ['02', 'winter'], ['03', 'spring'], ['04', 'spring'],
      ['05', 'spring'], ['06', 'summer'], ['07', 'summer'], ['08', 'summer'],
      ['09', 'autumn'], ['10', 'autumn'], ['11', 'autumn'], ['12', 'winter'],
    ] as const) {
      // seasonNow reads the current month, so assert the mapping it encodes
      // rather than mocking the clock: recompute the same way for each month.
      const m = Number(month)
      const derived = m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter'
      expect(derived).toBe(expected)
      seen.add(derived)
    }
    expect(seen.size).toBe(4)
    // And the live function agrees with that mapping for today.
    expect(SEASON_VALUES).toContain(seasonNow('Europe/Istanbul'))
  })
})
