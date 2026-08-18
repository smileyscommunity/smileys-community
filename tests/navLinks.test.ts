import { describe, it, expect } from 'vitest'
import { DISCOVER_LINKS } from '@/lib/navLinks'

// Guests and members get different navigation, and the link catalogue encodes
// that with two flags rather than two lists:
//
//   public: false   → members only (a guest reaches it another way, or can't)
//   guestOnly: true → guests only (a member has it in their primary bar)
//
// Getting one wrong doesn't break anything loudly — a section just becomes
// unreachable for half the audience, silently. /visiting was exactly that: when
// the guest and member bars diverged (d6fc70c) it moved into the guest bar and
// was dropped from this list, which left a signed-in member no route to it at
// all, on desktop or on their dashboard. Nobody noticed until someone went
// looking for it in the menu.
//
// These mirror the filters the three consumers actually apply:
//   Navbar desktop dropdown  (isLoggedIn || public) && !(isLoggedIn && guestOnly)
//   Navbar guest mobile menu public
//   Member dashboard block   !guestOnly

const forMember = DISCOVER_LINKS.filter(l => !l.guestOnly)
const forGuest  = DISCOVER_LINKS.filter(l => l.public)

const hrefs = (ls: typeof DISCOVER_LINKS) => ls.map(l => l.href)

describe('Discover link visibility', () => {
  it('gives members a route to /visiting — welcoming a visitor is a member action', () => {
    expect(hrefs(forMember)).toContain('/visiting')
  })

  it('does not repeat /visiting for guests, who already have it in their primary bar', () => {
    expect(hrefs(forGuest)).not.toContain('/visiting')
  })

  it('keeps /members out of a member menu, since it is in their primary bar', () => {
    expect(hrefs(forMember)).not.toContain('/members')
    expect(hrefs(forGuest)).toContain('/members')
  })

  it('shows every audience something', () => {
    expect(forMember.length).toBeGreaterThan(5)
    expect(forGuest.length).toBeGreaterThan(5)
  })

  it('never marks a link both members-only and guests-only, which would hide it from everyone', () => {
    const orphaned = DISCOVER_LINKS.filter(l => !l.public && l.guestOnly).map(l => l.href)
    expect(orphaned).toEqual([])
  })

  it('has no duplicate hrefs', () => {
    const seen = hrefs(DISCOVER_LINKS)
    expect(seen.length).toBe(new Set(seen).size)
  })
})
