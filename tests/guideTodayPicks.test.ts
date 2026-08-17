import { describe, it, expect, vi } from 'vitest'

import { computeTodayPicks } from '@/lib/guideToday'

// Istanbul keeps a hand-curated table of which experiences suit which part of
// the day. A second city can't have one without someone inventing it, so any
// other city derives picks from its OWN mood/collection vocabulary. These pin
// the two behaviours and the rule that a pick must exist.

const bodrum = [
  { slug: 'sunset-gumusluk',  moods: ['sunset'],          collection: 'sunset'   },
  { slug: 'boat-into-bays',   moods: ['boat', 'summer'],  collection: 'boat'     },
  { slug: 'bodrum-castle',    moods: ['history'],         collection: 'history'  },
  { slug: 'night-marina',     moods: ['night-out'],       collection: 'night'    },
  { slug: 'quiet-cove',       moods: ['escape'],          collection: 'hidden'   },
]

const ctx = (available: typeof bodrum, citySlug = 'bodrum') => ({
  citySlug, timezone: 'Europe/Istanbul', available,
})

describe('computeTodayPicks', () => {
  it('only ever returns experiences the city actually has', () => {
    const { slugs } = computeTodayPicks([], ctx(bodrum))
    const have = new Set(bodrum.map(e => e.slug))
    expect(slugs.length).toBeGreaterThan(0)
    for (const s of slugs) expect(have.has(s)).toBe(true)
  })

  it('returns nothing rather than something wrong when the city has no experiences', () => {
    expect(computeTodayPicks([], ctx([])).slugs).toEqual([])
  })

  it('ignores Istanbul\'s curated slugs for another city', () => {
    // 'ferry-at-sunset' et al are Istanbul's table; Bodrum must never surface a
    // slug that belongs to another city's guide.
    const { slugs } = computeTodayPicks([], ctx(bodrum))
    expect(slugs).not.toContain('ferry-at-sunset')
    expect(slugs).not.toContain('meyhane-night')
  })

  it('drops a curated Istanbul slug that is no longer published', () => {
    // Istanbul's path filters its table against what exists, so an unpublished
    // entry leaves no hole in the row.
    const onlyOne = [{ slug: 'turkish-breakfast', moods: ['eat'], collection: 'eat' }]
    const { slugs } = computeTodayPicks([], ctx(onlyOne, 'istanbul'))
    for (const s of slugs) expect(s).toBe('turkish-breakfast')
  })

  it('prefers time-relevance over de-duplication when exclusions gut the list', () => {
    // Everything excluded → still returns picks rather than an empty section.
    const { slugs } = computeTodayPicks(bodrum.map(e => e.slug), ctx(bodrum))
    expect(slugs.length).toBeGreaterThan(0)
  })

  it('is deterministic for a given context', () => {
    const a = computeTodayPicks([], ctx(bodrum))
    const b = computeTodayPicks([], ctx(bodrum))
    expect(a).toEqual(b)
  })
})
