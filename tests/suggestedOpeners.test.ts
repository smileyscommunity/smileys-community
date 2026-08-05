import { describe, it, expect } from 'vitest'
import { suggestedOpeners, type ProfileSharedContext } from '../lib/memberOpeners'

const ctx = (over: Partial<ProfileSharedContext>): ProfileSharedContext => ({
  clubs: [], neighborhood: null, events: [], hangouts: [], interests: [], ...over,
})
const club = (name: string) => ({ id: name, name, emoji: '🥾', slug: name.toLowerCase() })

describe('suggestedOpeners', () => {
  it('leads with a shared club', () => {
    const out = suggestedOpeners(ctx({ clubs: [club('Hiking Club')] }), 'Maria')
    expect(out[0]).toBe('Hey Maria! We\'re both in Hiking Club 👋')
  })

  it('offers the shared event and neighborhood too', () => {
    const out = suggestedOpeners(ctx({
      clubs: [club('Hiking Club')],
      events: [{ id: 'e', title: 'Smileys Wednesday', date: '2026-08-12', emoji: '💬' }],
      neighborhood: 'Moda',
    }), 'Maria')
    expect(out).toHaveLength(3)
    expect(out[1]).toContain('Smileys Wednesday')
    expect(out[2]).toContain('Moda')
  })

  it('caps at three so the picker never becomes a wall', () => {
    const out = suggestedOpeners(ctx({
      clubs: [club('Hiking')],
      events: [{ id: 'e', title: 'Wednesday', date: '2026-08-12', emoji: '💬' }],
      neighborhood: 'Moda',
      interests: ['Photography', 'Coffee'],
    }), 'Maria')
    expect(out).toHaveLength(3)
  })

  it('returns nothing without shared context — no generic openers', () => {
    expect(suggestedOpeners(ctx({}), 'Maria')).toEqual([])
    expect(suggestedOpeners(null, 'Maria')).toEqual([])
  })

  it('addresses the person by first name only', () => {
    const out = suggestedOpeners(ctx({ clubs: [club('Sailing Club')] }), 'Maria')
    expect(out[0]).toContain('Maria')
    expect(out[0]).not.toMatch(/Maria \w/)
  })
})
