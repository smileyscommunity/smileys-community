import { describe, it, expect } from 'vitest'
import { contextLabel, EMPTY_CONTEXT, type SharedContext } from '../lib/sharedContext'

const ctx = (over: Partial<SharedContext>): SharedContext => ({ ...EMPTY_CONTEXT, ...over })
const club = (name: string) => ({ id: name, name, emoji: '🥾', slug: name.toLowerCase() })

describe('contextLabel', () => {
  it('names the club when exactly one is shared', () => {
    expect(contextLabel(ctx({ clubs: [club('Hiking Club')] }))).toBe('Also in Hiking Club')
  })

  it('counts when several clubs are shared', () => {
    expect(contextLabel(ctx({ clubs: [club('Hiking'), club('Sailing')] }))).toBe('2 clubs in common')
  })

  it('falls back through events, hangouts, neighborhood, interests', () => {
    expect(contextLabel(ctx({ events: [{ id: 'e', title: 'Smileys Wednesday', date: '2026-08-12', emoji: '💬' }] })))
      .toBe('Also going to Smileys Wednesday')
    expect(contextLabel(ctx({ hangouts: [{ id: 'h', title: 'Coffee in Moda' }] }))).toBe('Joining Coffee in Moda')
    expect(contextLabel(ctx({ neighborhood: 'Moda' }))).toBe('Lives around Moda')
    expect(contextLabel(ctx({ interests: ['Photography'] }))).toBe('Both into Photography')
  })

  it('prefers the strongest signal when several exist', () => {
    const rich = ctx({
      clubs: [club('Hiking Club')],
      events: [{ id: 'e', title: 'Wednesday', date: '2026-08-12', emoji: '💬' }],
      neighborhood: 'Moda',
      interests: ['Coffee'],
    })
    expect(contextLabel(rich)).toBe('Also in Hiking Club')
  })

  it('returns null when nothing is shared — cards then show no context line', () => {
    expect(contextLabel(EMPTY_CONTEXT)).toBeNull()
  })

  it('never exposes the sort weight in the label', () => {
    const label = contextLabel(ctx({ clubs: [club('Hiking Club')], weight: 99 }))
    expect(label).not.toMatch(/\d+%|score|match|99/)
  })
})
