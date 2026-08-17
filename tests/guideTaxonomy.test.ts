import { describe, it, expect } from 'vitest'
import { moodsFor, collectionsFor, hasOwnGuideTaxonomy } from '@/lib/guide'

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
