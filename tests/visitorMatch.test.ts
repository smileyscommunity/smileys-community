import { describe, it, expect } from 'vitest'
import { sharedSignals, MAX_SHARED_INTERESTS, MAX_SHARED_LANGUAGES } from '@/lib/visitorMatch'

// The /visiting card showed a visitor's languages and neighbourhood as plain
// facts and only ever compared interests, so an Arabic speaker was never told
// the visitor also speaks Arabic. These are the rules the card now applies.

const p = (o: Partial<Parameters<typeof sharedSignals>[0]> = {}) =>
  ({ interests: [], languages: [], neighborhood: null, ...o })

describe('sharedSignals', () => {
  it('finds what the two have in common', () => {
    const s = sharedSignals(
      p({ interests: ['Hiking', 'Yoga'], languages: ['English', 'Arabic'], neighborhood: 'Kadıköy' }),
      p({ interests: ['Yoga', 'Chess'],  languages: ['Arabic'],            neighborhood: 'Kadıköy' }),
    )
    expect(s).toEqual({ interests: ['Yoga'], languages: ['Arabic'], sameNeighborhood: true })
  })

  it('matches case- and whitespace-insensitively — both sides are typed by members', () => {
    const s = sharedSignals(
      p({ interests: ['hiking'], languages: ['  english '], neighborhood: 'kadıköy' }),
      p({ interests: ['Hiking'], languages: ['English'],    neighborhood: 'Kadıköy' }),
    )
    expect(s.interests).toEqual(['Hiking'])
    expect(s.languages).toEqual(['English'])
    expect(s.sameNeighborhood).toBe(true)
  })

  it("echoes the visitor's spelling, not the viewer's", () => {
    // The visitor wrote "Türkçe"; showing them "turkish" reads as another word.
    const s = sharedSignals(p({ languages: ['türkçe'] }), p({ languages: ['Türkçe'] }))
    expect(s.languages).toEqual(['Türkçe'])
  })

  it('gives a logged-out viewer nothing — "you both speak Arabic" needs a you', () => {
    const s = sharedSignals(p(), p({ interests: ['Yoga'], languages: ['Arabic'], neighborhood: 'Beşiktaş' }))
    expect(s).toEqual({ interests: [], languages: [], sameNeighborhood: false })
  })

  it('never calls two unknown neighbourhoods a match', () => {
    expect(sharedSignals(p(), p()).sameNeighborhood).toBe(false)
    expect(sharedSignals(p({ neighborhood: 'Şişli' }), p()).sameNeighborhood).toBe(false)
    expect(sharedSignals(p(), p({ neighborhood: 'Şişli' })).sameNeighborhood).toBe(false)
    expect(sharedSignals(p({ neighborhood: '' }), p({ neighborhood: '' })).sameNeighborhood).toBe(false)
  })

  it('does not repeat a value the visitor listed twice', () => {
    const s = sharedSignals(p({ languages: ['English'] }), p({ languages: ['English', 'english', 'ENGLISH'] }))
    expect(s.languages).toEqual(['English'])
  })

  it('caps the chips so a card stays glanceable', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f']
    const s = sharedSignals(p({ interests: many, languages: many }), p({ interests: many, languages: many }))
    expect(s.interests).toHaveLength(MAX_SHARED_INTERESTS)
    expect(s.languages).toHaveLength(MAX_SHARED_LANGUAGES)
  })

  it('ignores blank entries rather than matching them against each other', () => {
    const s = sharedSignals(p({ interests: ['', '  '] }), p({ interests: ['', 'Yoga'] }))
    expect(s.interests).toEqual([])
  })
})
