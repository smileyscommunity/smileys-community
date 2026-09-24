import { describe, it, expect } from 'vitest'
import { clubHref } from '@/lib/clubLink'

// Club pages are members-only (app/(member)/clubs/[slug]); a guest following a
// club card from a public page got an empty page and a login form. These pin
// where each kind of viewer is sent.
describe('clubHref', () => {
  it('sends members to the club page', () => {
    expect(clubHref('coworking', 'member', 'istanbul')).toBe('/clubs/coworking')
  })
  it('sends guests to the application for the club\'s city', () => {
    expect(clubHref('coworking', 'guest', 'istanbul')).toBe('/apply?city=istanbul')
    expect(clubHref('coworking', 'guest', null)).toBe('/apply')
  })
  it('keeps the club page while sign-in is unresolved — never sends a member to apply', () => {
    expect(clubHref('coworking', 'unknown', 'istanbul')).toBe('/clubs/coworking')
  })
})
