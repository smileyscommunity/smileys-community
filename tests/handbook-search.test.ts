import { describe, it, expect } from 'vitest'
import { fold, searchHandbook, type HandbookSearchItem } from '@/lib/handbook-search'

const item = (over: Partial<HandbookSearchItem>): HandbookSearchItem => ({
  slug: 'x', title: '', excerpt: '', category: '', emoji: '📖',
  reviewed: null, minutes: 1, tags: [],
  ...over,
})

const CORPUS: HandbookSearchItem[] = [
  item({
    slug: 'residence-permit-first-application',
    title: 'Residence Permit (Ikamet): Your first application, without the panic',
    excerpt: 'Apply online through the official e-İkamet system.',
    category: 'Residence & Legal',
    tags: ['ikamet', 'göç', 'visa', 'tax number'],
  }),
  item({
    slug: 'istanbulkart-mastery',
    title: 'Istanbulkart Mastery: The only ticket that matters',
    excerpt: 'One tap covers the metro, tram, bus, ferries, Marmaray.',
    category: 'Getting Around',
    tags: ['metro', 'ferry', 'transport', 'airport'],
  }),
  item({
    slug: 'healthcare-in-istanbul-how-the-system-works',
    title: 'Healthcare in Istanbul: How the system works',
    excerpt: 'Find the after-hours duty pharmacy (Nöbetçi Eczane).',
    category: 'Healthcare',
    tags: ['doctor', 'eczane', 'hospital', '112'],
  }),
]

describe('fold', () => {
  it('collapses Turkish letters onto their plain forms', () => {
    expect(fold('İkamet')).toBe('ikamet')
    expect(fold('ŞİŞLİ')).toBe('sisli')
    expect(fold('Nöbetçi Eczane')).toBe('nobetci eczane')
    expect(fold('Kadıköy')).toBe('kadikoy')
  })
})

describe('searchHandbook', () => {
  it('returns nothing for an empty or whitespace query', () => {
    expect(searchHandbook(CORPUS, '')).toEqual([])
    expect(searchHandbook(CORPUS, '   ')).toEqual([])
  })

  it('matches the Turkish term a member actually types', () => {
    // "ikamet" typed plain must find the article titled with "İkamet".
    expect(searchHandbook(CORPUS, 'ikamet')[0]?.slug).toBe('residence-permit-first-application')
    expect(searchHandbook(CORPUS, 'eczane')[0]?.slug).toBe('healthcare-in-istanbul-how-the-system-works')
  })

  it('matches via tags when the word is in neither title nor excerpt', () => {
    expect(searchHandbook(CORPUS, 'doctor')[0]?.slug).toBe('healthcare-in-istanbul-how-the-system-works')
    expect(searchHandbook(CORPUS, 'airport')[0]?.slug).toBe('istanbulkart-mastery')
  })

  it('ANDs multiple terms — more words narrow, not widen', () => {
    expect(searchHandbook(CORPUS, 'metro')).toHaveLength(1)
    expect(searchHandbook(CORPUS, 'metro ikamet')).toHaveLength(0)
  })

  it('ranks a title hit above a tag or excerpt hit', () => {
    const corpus = [
      item({ slug: 'tagged',  title: 'Something else',   tags: ['banking'] }),
      item({ slug: 'titled',  title: 'Turkish banking',  tags: [] }),
    ]
    expect(searchHandbook(corpus, 'banking').map(r => r.slug)).toEqual(['titled', 'tagged'])
  })

  it('keeps the curated order for equal scores', () => {
    const corpus = [
      item({ slug: 'first',  title: 'Istanbul basics' }),
      item({ slug: 'second', title: 'Istanbul extras' }),
    ]
    expect(searchHandbook(corpus, 'istanbul').map(r => r.slug)).toEqual(['first', 'second'])
  })

  it('finds nothing rather than something wrong for an off-corpus query', () => {
    expect(searchHandbook(CORPUS, 'schengen')).toEqual([])
  })
})
