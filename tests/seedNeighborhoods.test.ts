import { describe, it, expect } from 'vitest'
import { validateEntries, type Entry } from '@/scripts/seed-neighborhoods'

// Neighborhoods are the one hard launch blocker — every picker in the product
// reads that table, and safeNeighborhoodFor silently nulls a name the city
// doesn't have. Until now each city meant a hand-written script, and Bodrum
// then needed four fix-up passes for blank vibe/area, wrong coordinates and
// duplicate emoji.
//
// The judgement stays with a person; this validates the mechanical half before
// anything is written. It matters that it reports EVERY problem at once: fixing
// a 40-row list one error per run is how someone gives up and edits the
// database by hand.

const ok = (over: Partial<Entry> = {}): Entry => ({ name: 'Kadıköy', ...over })

describe('validateEntries', () => {
  it('accepts a minimal row — name is the only required key', () => {
    expect(validateEntries([{ name: 'Moda' }], 'istanbul')).toEqual([])
  })

  it('accepts a fully specified row', () => {
    expect(validateEntries([ok({ emoji: '🎨', vibe: 'Independent', area: 'Asian', cost: 2, lat: 40.99, lng: 29.02 })], 'istanbul')).toEqual([])
  })

  it('requires a name', () => {
    expect(validateEntries([{ name: '  ' } as Entry], 'istanbul')[0]).toMatch(/name/)
    expect(validateEntries([{} as Entry], 'istanbul')[0]).toMatch(/name/)
  })

  it('rejects a name that slugifies to nothing — it would collide with every other such row', () => {
    // (cityId, slug) is unique, so two emoji-only names are the same row.
    expect(validateEntries([{ name: '🎨🎨' }], 'istanbul')[0]).toMatch(/empty slug/)
  })

  it("rejects a name that slugifies to the city's own slug", () => {
    expect(validateEntries([{ name: 'Bodrum' }], 'bodrum')[0]).toMatch(/city's own slug/)
    // Same name is fine in a different city.
    expect(validateEntries([{ name: 'Bodrum' }], 'izmir')).toEqual([])
  })

  it('catches two names that collide only after Turkish transliteration', () => {
    // 'Şişli' and 'Sisli' both slugify to 'sisli'; the DB would reject the
    // second mid-run and leave the list half-applied.
    const problems = validateEntries([{ name: 'Şişli' }, { name: 'Sisli' }], 'istanbul')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/both slugify to "sisli"/)
  })

  it('catches the same name listed twice, case-insensitively', () => {
    expect(validateEntries([{ name: 'Moda' }, { name: 'moda' }], 'istanbul')[0]).toMatch(/listed twice/)
  })

  it('holds cost to the 1–3 tier the cards render', () => {
    expect(validateEntries([ok({ cost: 0 })], 'istanbul')[0]).toMatch(/cost must be/)
    expect(validateEntries([ok({ cost: 4 })], 'istanbul')[0]).toMatch(/cost must be/)
    expect(validateEntries([ok({ cost: 2.5 })], 'istanbul')[0]).toMatch(/cost must be/)
    expect(validateEntries([ok({ cost: 1 })], 'istanbul')).toEqual([])
  })

  it('rejects coordinates outside the globe', () => {
    expect(validateEntries([ok({ lat: 95, lng: 29 })], 'istanbul')[0]).toMatch(/lat out of range/)
    expect(validateEntries([ok({ lat: 40, lng: 200 })], 'istanbul')[0]).toMatch(/lng out of range/)
  })

  it('rejects half a coordinate pair — one alone puts a pin in the sea', () => {
    expect(validateEntries([ok({ lat: 40.99 })], 'istanbul')[0]).toMatch(/only one of lat\/lng/)
    expect(validateEntries([ok({ lng: 29.02 })], 'istanbul')[0]).toMatch(/only one of lat\/lng/)
  })

  it('accepts `lon` as an alias for `lng`, which is what the existing list uses', () => {
    expect(validateEntries([ok({ lat: 37.03, lon: 27.43 })], 'istanbul')).toEqual([])
  })

  it('reports every problem in one pass, not just the first', () => {
    const problems = validateEntries([
      { name: '' },
      ok({ cost: 9 }),
      { name: 'Moda' },
      { name: 'moda' },
    ] as Entry[], 'istanbul')
    expect(problems.length).toBeGreaterThanOrEqual(3)
    expect(problems.some(p => /name/.test(p))).toBe(true)
    expect(problems.some(p => /cost/.test(p))).toBe(true)
    expect(problems.some(p => /listed twice/.test(p))).toBe(true)
  })

  it('names the offending row so a long list is fixable', () => {
    expect(validateEntries([{ name: 'Moda' }, ok({ cost: 9 })], 'istanbul')[0]).toMatch(/^row 2:/)
  })

  it('rejects a non-object row rather than throwing', () => {
    expect(validateEntries(['Moda' as unknown as Entry], 'istanbul')[0]).toMatch(/not an object/)
  })
})
