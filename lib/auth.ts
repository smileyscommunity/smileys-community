export type UserRole = 'admin' | 'moderator' | 'member' | 'partner'

export interface AppUser {
  id: string
  name: string
  initials: string
  color: string
  role: UserRole
  isClubHost?: boolean
  // Cities where the viewer holds city-level hosting authority — consul of
  // the city, or a live city-host grant for it (lib/access.hostCityIds).
  // Empty/undefined for everyone else. Undefined rather than [] on sessions
  // whose payload predates the field, so `?? []` at every read.
  hostCityIds?: string[]
  joinedEvents?: string[]
  joinedAt?: string
  email?: string
  bio?: string
  neighborhood?: string
  instagram?: string
  emailVerified?: boolean
  phone?: string
  nationality?: string
  languages?: string[]
  interests?: string[]
  status?: string
  membershipType?: string
  profilePhoto?: string
  partnerId?: string | null
  totpEnabled?: boolean
}

// ── /host panel gates ──────────────────────────────────────────────────────
//
// The host panel is a client-rendered shell, so these take the AppUser from
// /api/auth/me rather than a SessionUser. They decide what the panel offers;
// every route behind it still authorises on its own server-side (that's
// where the per-city and per-event checks live — lib/access.ts).
//
// Kept here, next to AppUser, so the layout gate and the dashboard gate
// can't drift apart again: the two used to hold their own inlined copies of
// the rule, and the city-level roles were added to neither.

/**
 * Does the viewer hold city-level hosting authority in at least one city?
 * "Somewhere" because the panel gates are global while the authority is
 * per-city — hostCityIds says which cities, and any route that acts on a
 * specific city re-checks it with canHostInCity.
 */
export function isCityHostSomewhere(user: AppUser): boolean {
  return (user.hostCityIds?.length ?? 0) > 0
}

/**
 * Does the viewer hold hosting authority of either kind — a club, or a city?
 * This is the audience for the "Host Panel" links in the account menu and
 * command palette: people with something of their own to run, as opposed to
 * admins and moderators, who have their own panels.
 */
export function hasHostAuthority(user: AppUser): boolean {
  return user.isClubHost === true || isCityHostSomewhere(user)
}

/**
 * May the viewer open /host at all? Anyone with hosting authority of either
 * kind, plus admins and moderators for oversight.
 */
export function canEnterHostPanel(user: AppUser): boolean {
  return user.role === 'admin' || user.role === 'moderator' || hasHostAuthority(user)
}

/**
 * May the viewer use the events tools (My Events, Check-In, event stats)?
 *
 * Hosting authority, not oversight — a plain moderator has no events of
 * their own, so the panel shows them the clubs side instead. That predates
 * the city roles and stays as it was; a moderator who also holds a city-host
 * grant passes on the grant, not on the role.
 */
export function canHostEvents(user: AppUser): boolean {
  return user.role === 'admin' || hasHostAuthority(user)
}

/**
 * May the viewer use the club tools? Club hosting is granted per club, and a
 * city host is deliberately NOT a club host (see canHostInCity in
 * lib/access.ts) — so city authority buys nothing here.
 */
export function canHostClubs(user: AppUser): boolean {
  return user.role === 'admin' || user.isClubHost === true
}

