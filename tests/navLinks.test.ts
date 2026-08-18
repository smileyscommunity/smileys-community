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

// One array serves two audiences, so ORDER is two properties rather than one,
// and the second is easy to break while fixing the first.
//
// Members used to inherit the guest's priorities wholesale: Hangouts and
// Visiting — the only two entries written for members, and the most
// time-sensitive things in the menu — sat last, under the Handbook. Moving them
// up is safe precisely because a guest's menu is the `public` entries in their
// own relative order, so a members-only entry can go anywhere without touching
// it. These tests are what make that safety checkable rather than asserted.
describe('Discover ordering', () => {
  // Pinned exactly, so reordering for members proves it left guests alone.
  // If you genuinely mean to change the guest menu, change this list — that's
  // the point, it should take a deliberate edit.
  it('guest order is deliberate and unchanged', () => {
    expect(DISCOVER_LINKS.filter(l => l.public).map(l => l.label)).toEqual([
      'Members',
      'Experiences',
      'Directory',
      'Neighborhoods',
      'City Guide',
      'Handbook',
      'Hosts',
      'Stories',
      'Community Board',
      'Marketplace',
    ])
  })

  it("puts a member's time-sensitive links above the reference material", () => {
    const labels = forMember.map(l => l.label)
    const firstReference = labels.indexOf('City Guide')
    expect(firstReference).toBeGreaterThan(-1)
    for (const live of ['Hangouts', 'Visiting']) {
      expect(labels.indexOf(live), `${live} belongs above the reference block, not under the Handbook`)
        .toBeLessThan(firstReference)
    }
  })

  it('keeps the two members-only entries together rather than scattered', () => {
    const idx = ['Hangouts', 'Visiting'].map(l => forMember.findIndex(x => x.label === l)).sort((a, b) => a - b)
    expect(idx[1] - idx[0], 'Hangouts and Visiting read as a pair — what is on, and who is coming')
      .toBe(1)
  })

  it('labels read as titles, like every other entry', () => {
    // "City guide" sat among People, Community Board and Marketplace as the one
    // entry in sentence case.
    const odd = DISCOVER_LINKS
      .filter(l => l.label.split(' ').some((w, i) => i > 0 && /^[a-z]/.test(w)))
      .map(l => l.label)
    expect(odd).toEqual([])
  })
})

