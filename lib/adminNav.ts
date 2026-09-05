// Admin navigation as plain data — no JSX here on purpose, so both the
// sidebar and the layout's moderator page gate read from one list and the
// unit tests can import it (Sidebar.tsx holds module-level JSX that vitest
// cannot parse under tsconfig's `jsx: preserve`).

export type AdminNavItem = {
  label: string
  href:  string
  exact: boolean
  roles: string[]
  icon:  string
}

export const NAV_GROUPS: { label: string; items: AdminNavItem[] }[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard',    href: '/admin',            exact: true,  roles: ['admin'],      icon: 'dashboard' },
      { label: 'Mod Home',     href: '/admin/moderator',  exact: true,  roles: ['moderator'],  icon: 'modHome'   },
      { label: 'Analytics',    href: '/admin/analytics',  exact: false, roles: ['admin'],      icon: 'analytics' },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Applications', href: '/admin/applications', exact: false, roles: ['admin', 'moderator'],  icon: 'applications' },
      { label: 'Users',        href: '/admin/users',        exact: false, roles: ['admin'],               icon: 'users'        },
      // "Reports" used to point at a misnamed analytics page; the actual
      // member-reports queue lives at /admin/moderation (default tab).
      { label: 'Moderation',   href: '/admin/moderation',   exact: false, roles: ['admin', 'moderator'],  icon: 'moderation'   },
      // Moderators get a Retention shortcut here since they can't see Analytics
      // (admin-only API). Admins access the same data via Analytics > Members
      // tab, where it's folded in alongside the engagement summary.
      { label: 'Retention',    href: '/admin/retention',    exact: false, roles: ['moderator'],  icon: 'retention'    },
      { label: 'Audit Log',    href: '/admin/audit',        exact: false, roles: ['admin', 'moderator'],  icon: 'audit'        },
    ],
  },
  {
    label: 'Events',
    items: [
      // `host` is not a login role: the sidebar adds it to a viewer's roles
      // when user.isClubHost is set. Only admins and moderators reach /admin,
      // so in practice it means "a moderator who also hosts a club" — four of
      // them today — and the three APIs admit a club host. Not a leftover.
      { label: 'Events',       href: '/admin/events',       exact: false, roles: ['admin', 'host'],            icon: 'events'       },
      { label: 'Participants', href: '/admin/participants',  exact: false, roles: ['admin', 'host'],            icon: 'participants' },
      { label: 'Check-In',     href: '/admin/checkin',       exact: false, roles: ['admin', 'host'],            icon: 'checkin'      },
      // No-show cards: appeals inbox + card history. Hosts waive from Participants.
      { label: 'No-shows',     href: '/admin/no-shows',      exact: false, roles: ['admin', 'moderator'],       icon: 'noshows'      },
      // Feedback ✿ = post-event safety + quality surveys. Lives here
      // because it's per-event signal, not a moderation action. The
      // auto-filed anomaly Reports still surface under Moderation
      // (where they get triaged).
      { label: 'Feedback',     href: '/admin/feedback',      exact: false, roles: ['admin', 'moderator'],       icon: 'feedback'     },
      // NPS = quarterly Net Promoter Score across all members.
      // Sibling to Feedback ✿ but a different cadence: one number
      // every quarter vs. per-event drip. Anonymous from the
      // responder's perspective; admins see scores + comments, not
      // who wrote them.
      { label: 'NPS',          href: '/admin/nps',           exact: false, roles: ['admin', 'moderator'],       icon: 'nps'          },
      // Campaigns — sponsorship + fundraising drives. The Smileys
      // Cup 2026 is the first one; future tournaments and non-
      // tournament pushes (anniversary, referral) get their own row.
      // Fixture management + result entry live on the campaign's
      // own detail page as the "Fixtures + results" tab; the old
      // standalone /admin/cup route was deleted as part of the
      // campaign consolidation.
      { label: 'Campaigns',    href: '/admin/campaigns',     exact: false, roles: ['admin', 'moderator'],       icon: 'campaigns'    },
    ],
  },
  {
    label: 'Community',
    items: [
      { label: 'Cities',       href: '/admin/cities',       exact: false, roles: ['admin'],               icon: 'cities'       },
      { label: 'Clubs',        href: '/admin/clubs',        exact: false, roles: ['admin'],               icon: 'clubs'        },
      { label: 'Hosts',        href: '/admin/hosts',        exact: false, roles: ['admin'],               icon: 'hosts'        },
      { label: 'Marketplace',  href: '/admin/listings',     exact: false, roles: ['admin', 'moderator'],  icon: 'board'        },
      { label: 'Moving Sales', href: '/admin/moving-sales', exact: false, roles: ['admin', 'moderator'],  icon: 'board'        },
      { label: 'Hangouts',     href: '/admin/hangouts',     exact: false, roles: ['admin', 'moderator'],  icon: 'hangouts'     },
      { label: 'Spotlight',    href: '/admin/spotlight',    exact: false, roles: ['admin', 'moderator'],  icon: 'spotlight'    },
      { label: 'Partners',     href: '/admin/partners',     exact: false, roles: ['admin', 'moderator'],  icon: 'partners'     },
      { label: 'Directory',    href: '/admin/directory',    exact: false, roles: ['admin', 'moderator'],  icon: 'directory'    },
      { label: 'Tags',         href: '/admin/tags',         exact: false, roles: ['admin'],               icon: 'tags'         },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Payments', href: '/admin/payments', exact: false, roles: ['admin'], icon: 'payments' },
      // Sponsors = B2B leads from /advertise worked as a pipeline
      // (new → … → won/lost). Lives under Finance because won deals
      // carry the closed sponsorship revenue number.
      { label: 'Sponsors', href: '/admin/sponsors', exact: false, roles: ['admin'], icon: 'partners' },
      // Smileys Pro waitlist — founding-member cohort for the upcoming
      // professional tier. Lives in Finance because it's the leading
      // indicator for the next paid revenue line.
      { label: 'Pro waitlist', href: '/admin/pro-waitlist', exact: false, roles: ['admin'], icon: 'campaigns' },
    ],
  },
  {
    label: 'Content',
    items: [
      { label: 'Notifications', href: '/admin/notifications',                 exact: false, roles: ['admin', 'moderator'],  icon: 'notifications' },
      { label: 'Newsletter',    href: '/admin/newsletter',                    exact: false, roles: ['admin'],                icon: 'campaigns'     },
      // Announcements + Polls used to share /admin/announcements behind a ?tab=
      // query (a single-page tab nav). That left both tabs visible from either
      // sidebar entry, so clicking "Polls" still showed an "Announcements" tab
      // and vice versa — confusing. Split into focused routes now.
      { label: 'Announcements', href: '/admin/announcements', exact: false, roles: ['admin', 'moderator'],  icon: 'banners'    },
      { label: 'Polls',         href: '/admin/polls',         exact: false, roles: ['admin', 'moderator'],  icon: 'engagement' },
      { label: 'Stories',       href: '/admin/stories',                     exact: false, roles: ['admin', 'moderator'],  icon: 'stories'       },
      { label: 'Articles',      href: '/admin/posts',         exact: false, roles: ['admin', 'moderator'],  icon: 'articles'      },
      { label: 'Neighborhoods', href: '/admin/neighborhoods', exact: false, roles: ['admin', 'moderator'],  icon: 'tags'          },
      // Two different things, both called 'guide': /admin/guide edits the
      // practical resources list, /admin/guide-entries edits the experiences
      // the public /guide is actually built from (per city).
      { label: 'Guide resources',  href: '/admin/guide',         exact: true,  roles: ['admin', 'moderator'],  icon: 'content'       },
      { label: 'Guide experiences', href: '/admin/guide-entries', exact: false, roles: ['admin', 'moderator'],  icon: 'content'       },
      { label: 'Banners',       href: '/admin/banners',       exact: false, roles: ['admin', 'moderator'],  icon: 'banners'       },
      { label: 'Content',       href: '/admin/content',       exact: false, roles: ['admin', 'moderator'],  icon: 'content'       },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Settings',  href: '/admin/settings',  exact: false, roles: ['admin'],  icon: 'settings' },
      { label: 'Security',  href: '/admin/security',  exact: false, roles: ['admin'],  icon: 'security'  },
    ],
  },
]

export const navItems = NAV_GROUPS.flatMap(g => g.items)

// Moderator mobile bottom nav — six pinned shortcuts. Lives here rather
// than inline in the layout so the page gate below can promise every tab
// it shows.
export const MODERATOR_BOTTOM_NAV = [
  { label: 'Home',   href: '/admin/moderator',    icon: 'modHome',       exact: true  },
  { label: 'Apps',   href: '/admin/applications', icon: 'applications',  exact: false },
  { label: 'Events', href: '/admin/events',       icon: 'events',        exact: false },
  { label: 'Mod',    href: '/admin/moderation',   icon: 'moderation',    exact: false },
  { label: 'Notify', href: '/admin/notifications',icon: 'notifications', exact: false },
  { label: 'Content',href: '/admin/stories',      icon: 'stories',       exact: false },
]

// Pages a moderator may open that no nav entry with a moderator role points
// at: 2FA enrollment, plus the hub/shortcut pages that are only reachable
// from Mod Home or a host's sidebar (a moderator who hosts a club sees the
// `host` items too). Retention and Mod Home are already nav-derived; they
// are listed so a role edit on the sidebar cannot lock moderators out of
// their own landing page.
const MODERATOR_EXTRA_PATHS = [
  '/admin/security',
  '/admin/checkin',
  '/admin/retention',
  '/admin/moderator',
]

const pathOf = (href: string) => href.split('?')[0]

// Every path prefix the admin layout admits for the moderator role. Derived
// from the nav so the sidebar can never advertise a page the layout bounces
// (that drift shipped nine dead links — see docs/admin-panel-audit-2026-09-05.md,
// finding 1). `host` items are included because the sidebar shows them to a
// moderator who also hosts a club.
export const MODERATOR_ALLOWED_PATHS: string[] = Array.from(new Set([
  ...navItems
    .filter(item => item.roles.includes('moderator') || item.roles.includes('host'))
    .map(item => pathOf(item.href)),
  ...MODERATOR_BOTTOM_NAV.map(item => pathOf(item.href)),
  ...MODERATOR_EXTRA_PATHS,
]))

// Prefix match, same as the layout always did: `/admin/guide` also admits
// `/admin/guide-entries` and `/admin/events` admits `/admin/events/123`.
export function isModeratorPageAllowed(pathname: string): boolean {
  return MODERATOR_ALLOWED_PATHS.some(p => pathname.startsWith(p))
}
