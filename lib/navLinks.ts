// ── Shared nav link catalogue ───────────────────────────────────────────────
// One source for the desktop "Discover" dropdown and the mobile bottom-nav
// sheet. They previously had nothing in common: the mobile sheet carried only
// account links, so a member on a phone couldn't reach Experiences, Cities,
// the Guide, the Directory or the Board at all — every discovery surface was
// desktop-only. Keeping the list here means adding a section reaches both.

export interface NavLink {
  label:  string
  href:   string
  emoji:  string
  /** Visible to signed-out visitors. */
  public: boolean
  /** Lives in a member's primary bar instead, so it's hidden from theirs. */
  guestOnly?: boolean
}

// Everything that isn't a primary action. Ordered by what a visitor deciding
// whether to join actually wants: the people and the places first, the
// reference material after. `guestOnly` items are the ones that live in a
// member's primary bar instead, so nobody sees the same link twice.
//
// Smileys Cup 2026 nav entry removed post-tournament (recap published as its
// own Community post); /cup page + data stay live for anyone linking in from
// there or a bookmark, just no longer in nav.
export const DISCOVER_LINKS: NavLink[] = [
  { label: 'People',          href: '/members',       emoji: '👋', public: true,  guestOnly: true },
  { label: 'Experiences',     href: '/experiences',   emoji: '✨', public: true  },
  { label: 'Directory',       href: '/directory',     emoji: '📍', public: true  },
  { label: 'Neighborhoods',   href: '/neighborhoods', emoji: '🏘️', public: true  },
  // The two members-only entries, placed together and ABOVE the reference
  // block. They are the most time-sensitive things in this menu — a coffee
  // happening this week, someone landing in your city on Thursday — and they
  // were both at the bottom, under the Handbook, because the list is ordered
  // for a guest deciding whether to join and members inherited those
  // priorities wholesale.
  //
  // Moving them changes nothing for guests: a guest's menu is the `public`
  // items in their existing relative order, and neither of these is public.
  // `public: false` is the mirror of `guestOnly` — a guest reaches Visiting
  // from their primary bar instead, so nobody sees either link twice.
  { label: 'Hangouts',        href: '/hangouts',      emoji: '☕', public: false },
  { label: 'Visiting',        href: '/visiting',      emoji: '👋', public: false },
  { label: 'City Guide',      href: '/guide',         emoji: '🗺️', public: true  },
  { label: 'Handbook',        href: '/handbook',      emoji: '📖', public: true  },
  { label: 'Hosts',           href: '/hosts',         emoji: '🎤', public: true  },
  { label: 'Stories',         href: '/posts',         emoji: '📰', public: true  },
  { label: 'Community Board', href: '/board',         emoji: '💬', public: true  },
  { label: 'Marketplace',     href: '/marketplace',   emoji: '🛍️', public: true  },
]

// Kept out of the bar to hold it at five, but not orphaned — a guest weighing
// up whether this is for them still needs a way to reach them.
export const ABOUT_LINKS = [
  { label: 'Why Smileys?', href: '/why',   emoji: '💡' },
  { label: 'About',        href: '/about', emoji: '😊' },
]
