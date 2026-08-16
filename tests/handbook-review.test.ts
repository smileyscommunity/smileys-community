import { describe, it, expect } from 'vitest'
import {
  reviewState, reviewLabel, reviewIntervalFor, readingTime, parseOfficialSources,
} from '@/lib/handbook-review'
import {
  canonicalCategory, storedKeysFor, categoryMeta, CATEGORY_KEYS,
  LEGACY_CATEGORY_ALIASES, HANDBOOK_CATEGORIES,
} from '@/lib/handbook-categories'

const NOW = new Date('2026-08-10T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

describe('reviewIntervalFor', () => {
  it('derives the cadence from the category volatility tier', () => {
    expect(reviewIntervalFor('Residence & Legal')).toBe(90)   // high
    expect(reviewIntervalFor('Living in Istanbul')).toBe(180) // medium
    expect(reviewIntervalFor('Language & Culture')).toBe(365) // low
  })

  it('lets an article override its category default', () => {
    expect(reviewIntervalFor('Language & Culture', 30)).toBe(30)
  })

  it('ignores a nonsense override rather than reviewing every render', () => {
    expect(reviewIntervalFor('Healthcare', 0)).toBe(90)
    expect(reviewIntervalFor('Healthcare', -5)).toBe(90)
  })

  it('falls back to the medium tier for an unknown category', () => {
    expect(reviewIntervalFor('Typo In Admin Form')).toBe(180)
  })

  it('resolves legacy keys through to the successor tier', () => {
    expect(reviewIntervalFor('Bureaucracy')).toBe(90) // → Residence & Legal
  })
})

describe('reviewState', () => {
  const article = (lastReviewedAt: Date | null, category = 'Residence & Legal') =>
    ({ category, lastReviewedAt })

  it('never invents a date for an article nobody reviewed', () => {
    expect(reviewState(article(null), NOW)).toBe('unreviewed')
  })

  it('treats an unparseable stored date as unreviewed, not as current', () => {
    expect(reviewState({ category: 'Healthcare', lastReviewedAt: 'not-a-date' }, NOW)).toBe('unreviewed')
  })

  it('is current well inside the interval', () => {
    expect(reviewState(article(daysAgo(10)), NOW)).toBe('current')
  })

  it('warns editorially in the last quarter of the interval', () => {
    // 90-day interval → review-soon from day 67.5
    expect(reviewState(article(daysAgo(66)), NOW)).toBe('current')
    expect(reviewState(article(daysAgo(70)), NOW)).toBe('review-soon')
  })

  it('is overdue once the interval has elapsed', () => {
    expect(reviewState(article(daysAgo(89)), NOW)).toBe('review-soon')
    expect(reviewState(article(daysAgo(91)), NOW)).toBe('needs-review')
  })

  it('holds a low-volatility article to a far looser standard', () => {
    // 200 days is overdue for a permit article, fine for etiquette.
    expect(reviewState(article(daysAgo(200), 'Residence & Legal'), NOW)).toBe('needs-review')
    expect(reviewState(article(daysAgo(200), 'Language & Culture'), NOW)).toBe('current')
  })
})

describe('reviewLabel', () => {
  it('returns null when there is nothing honest to display', () => {
    expect(reviewLabel({ category: 'Healthcare', lastReviewedAt: null }, NOW)).toBeNull()
  })

  it('renders a real review date', () => {
    const label = reviewLabel({ category: 'Healthcare', lastReviewedAt: new Date('2026-07-27T00:00:00Z') }, NOW)
    expect(label).toEqual({ text: 'Last reviewed 27 July 2026', stale: false })
  })

  it('flags an overdue article as stale', () => {
    expect(reviewLabel({ category: 'Healthcare', lastReviewedAt: daysAgo(200) }, NOW)?.stale).toBe(true)
  })

  it('does not expose review-soon to readers — it is an editorial signal', () => {
    expect(reviewLabel({ category: 'Healthcare', lastReviewedAt: daysAgo(70) }, NOW)?.stale).toBe(false)
  })
})

describe('readingTime', () => {
  it('never returns zero for a real but tiny article', () => {
    expect(readingTime('<p>Short.</p>')).toBe(1)
    expect(readingTime('')).toBe(1)
  })

  it('counts words, not markup', () => {
    const words = Array.from({ length: 440 }, () => 'kelime').join(' ')
    expect(readingTime(`<p>${words}</p>`)).toBe(2)
  })

  it('does not let tags or entities inflate the estimate', () => {
    const bare  = Array.from({ length: 220 }, () => 'word').join(' ')
    const heavy = Array.from({ length: 220 }, () => '<strong>word</strong>&nbsp;').join('')
    expect(readingTime(heavy)).toBe(readingTime(bare))
  })
})

describe('parseOfficialSources', () => {
  it('accepts well-formed https sources', () => {
    expect(parseOfficialSources([{ label: 'Göç İdaresi', url: 'https://www.goc.gov.tr' }]))
      .toEqual([{ label: 'Göç İdaresi', url: 'https://www.goc.gov.tr' }])
  })

  it('rejects non-https links — a cited authority must not be downgradable', () => {
    expect(parseOfficialSources([{ label: 'e-Devlet', url: 'http://turkiye.gov.tr' }])).toEqual([])
    expect(parseOfficialSources([{ label: 'x', url: 'javascript:alert(1)' }])).toEqual([])
  })

  it('survives anything a hand-edited JSON column can contain', () => {
    expect(parseOfficialSources(null)).toEqual([])
    expect(parseOfficialSources('https://example.com')).toEqual([])
    expect(parseOfficialSources([null, 42, { label: 'no url' }, { url: 'https://a.com' }])).toEqual([])
    expect(parseOfficialSources([{ label: '   ', url: 'https://a.com' }])).toEqual([])
  })
})

describe('handbook category IA', () => {
  it('exposes the ten canonical categories in IA order', () => {
    expect(CATEGORY_KEYS).toHaveLength(10)
    expect(CATEGORY_KEYS[0]).toBe('Getting Started')
  })

  it('resolves every legacy key to a real canonical category', () => {
    for (const [legacy, target] of Object.entries(LEGACY_CATEGORY_ALIASES)) {
      expect(canonicalCategory(legacy)).toBe(target)
      expect(HANDBOOK_CATEGORIES[target]).toBeDefined()
    }
  })

  it('leaves canonical keys untouched and rejects unknown ones', () => {
    expect(canonicalCategory('Healthcare')).toBe('Healthcare')
    expect(canonicalCategory('Nonsense')).toBeNull()
  })

  it('queries a category by every stored key that maps to it', () => {
    // The six live articles are still filed under legacy keys; a category page
    // that queried only the canonical key would render empty.
    expect(storedKeysFor('Residence & Legal').sort()).toEqual(['Bureaucracy', 'Residence & Legal'])
    expect(storedKeysFor('Healthcare')).toEqual(['Healthcare'])
  })

  it('gives legacy-keyed articles the successor category metadata', () => {
    expect(categoryMeta('Daily Life')?.label).toBe('Home & Housing')
    expect(categoryMeta('Nonsense')).toBeNull()
  })

  it('keeps the retired city-named key resolving to its successor', () => {
    // 'Living in Istanbul' was canonical until the Handbook went per-city — a
    // category label must not name a city. Rows still store the old value and
    // /handbook/category/Living%20in%20Istanbul is indexed, so both the
    // resolver and the query set have to keep honouring it.
    expect(canonicalCategory('Living in Istanbul')).toBe('Home & Housing')
    expect(categoryMeta('Living in Istanbul')?.label).toBe('Home & Housing')
    expect(storedKeysFor('Home & Housing').sort())
      .toEqual(['Daily Life', 'Home & Housing', 'Living in Istanbul'])
  })

  it('has no category label naming a city', () => {
    // The guard for the whole rename: the Handbook renders per city, so a
    // shelf heading must read the same in Istanbul and Izmir.
    const cityNamed = CATEGORY_KEYS.filter(k => /istanbul|izmir|bodrum/i.test(HANDBOOK_CATEGORIES[k].label))
    expect(cityNamed).toEqual([])
  })

  it('marks exactly the topics where stale advice is costly as high-stakes', () => {
    const highStakes = CATEGORY_KEYS.filter(k => HANDBOOK_CATEGORIES[k].highStakes)
    expect(highStakes.sort()).toEqual([
      'Healthcare', 'Money & Banking', 'Residence & Legal', 'Safety & Emergencies',
    ])
  })
})
