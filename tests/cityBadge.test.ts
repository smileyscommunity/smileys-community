import { describe, it, expect } from 'vitest'
import { cityBadge } from '@/lib/cityBadge'

// The events eyebrow shipped "ISTANBUL · ISTANBUL" to production: the city was
// appended to the CMS badge, and the client-state default badge is itself a
// city name while prod's CMS value is empty. Three feeds render this eyebrow;
// the bug only surfaced on one, which is why the rule lives in one place now.

describe('cityBadge', () => {
  it('joins a real badge and the city', () => {
    expect(cityBadge('Events', 'Bodrum')).toBe('Events · Bodrum')
  })

  it('collapses when the badge IS the city — the shipped bug', () => {
    expect(cityBadge('Istanbul', 'Istanbul')).toBe('Istanbul')
  })

  it('collapses case-insensitively, since an editor types freely', () => {
    expect(cityBadge('istanbul', 'Istanbul')).toBe('Istanbul')
    expect(cityBadge('  Bodrum  ', 'Bodrum')).toBe('Bodrum')
  })

  it('falls back to the city when the CMS value is empty — prod\'s actual state', () => {
    expect(cityBadge('', 'Bodrum')).toBe('Bodrum')
    expect(cityBadge(null, 'Bodrum')).toBe('Bodrum')
    expect(cityBadge(undefined, 'Bodrum')).toBe('Bodrum')
  })

  it('renders the badge alone until the city resolves, never a half-built string', () => {
    expect(cityBadge('Events', '')).toBe('Events')
    expect(cityBadge('Events', null)).toBe('Events')
  })

  it('has nothing to say when it knows nothing', () => {
    expect(cityBadge('', '')).toBe('')
  })
})
