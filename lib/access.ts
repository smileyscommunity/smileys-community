import { prisma } from './prisma'
import type { SessionUser } from './session'

// ── Primitive role checks ──────────────────────────────────────────────────
export function isAdmin(session: SessionUser): boolean {
  return session.role === 'admin'
}

export function isModerator(session: SessionUser): boolean {
  return session.role === 'moderator'
}

export function isAdminOrModerator(session: SessionUser): boolean {
  return session.role === 'admin' || session.role === 'moderator'
}

export function isPartner(session: SessionUser): boolean {
  return session.role === 'partner'
}

// ── City-aware authorisation ──────────────────────────────────────────────
//
// Admins are cross-city by design — they manage the platform. Moderators
// are city-scoped — they only act on resources in the city they were
// recruited from. This helper is the single place that enforces that
// rule; capability checks below layer on top of it.
//
// `targetCityId` is the city of the *resource being acted on* (the
// application's targetCityId, the user's cityId, the event's cityId).
// Pass null/undefined when the target has no city affinity (system-wide
// settings) — in those cases the check falls back to role only.
//
// Defensive: a moderator missing `session.cityId` (e.g. session issued
// from a frame where the DB refresh hasn't run yet) fails closed.
export function canActInCity(session: SessionUser, targetCityId?: string | null): boolean {
  if (session.role === 'admin') return true
  if (session.role !== 'moderator') return false
  if (!targetCityId) return true                // resource has no city — admin/mod parity
  if (!session.cityId) return false             // moderator without a city — fail closed
  return session.cityId === targetCityId
}

// ── Capability-based checks ────────────────────────────────────────────────
// Finance
export function canManagePayments(session: SessionUser): boolean {
  return session.role === 'admin'
}

// Applications & vetting
//
// targetCityId scopes moderators to applications targeting their own
// city. Existing call sites that omit the argument keep the
// pre-multi-city behaviour (moderators can review any application);
// new city-aware call sites pass the application's targetCityId.
export function canReviewApplications(session: SessionUser, targetCityId?: string | null): boolean {
  if (session.role !== 'admin' && session.role !== 'moderator') return false
  return targetCityId === undefined ? true : canActInCity(session, targetCityId)
}

// Community reports — moderator action scopes to the city of the
// reported user (admin handles cross-city).
export function canModerateReports(session: SessionUser, targetCityId?: string | null): boolean {
  if (session.role !== 'admin' && session.role !== 'moderator') return false
  return targetCityId === undefined ? true : canActInCity(session, targetCityId)
}

// Partner Management
export function canManagePartner(session: SessionUser, partnerId: string): boolean {
  if (session.role === 'admin') return true
  return session.role === 'partner' && session.partnerId === partnerId
}

export function canManagePartners(session: SessionUser): boolean {
  return session.role === 'admin' || session.role === 'moderator'
}

// Banning (hard action — admin only)
export function canBanUsers(session: SessionUser): boolean {
  return session.role === 'admin'
}

// Suspending (soft action — admin and moderator). Moderators only
// suspend users in their own city.
export function canSuspendUsers(session: SessionUser, targetCityId?: string | null): boolean {
  if (session.role !== 'admin' && session.role !== 'moderator') return false
  return targetCityId === undefined ? true : canActInCity(session, targetCityId)
}

// User management (Admin only: roles, bans, delete)
export function canManageUsers(session: SessionUser): boolean {
  return session.role === 'admin'
}

// User list visibility (Admin and Moderator: view profiles, but PII
// may be masked). Moderators scoped to their city — admin pages can
// pass the viewer's city to filter the list down.
export function canViewUserList(session: SessionUser, targetCityId?: string | null): boolean {
  if (session.role !== 'admin' && session.role !== 'moderator') return false
  return targetCityId === undefined ? true : canActInCity(session, targetCityId)
}

// Clubs
export function canManageClubs(session: SessionUser): boolean {
  return session.role === 'admin'
}

// Tags / taxonomy
export function canManageTags(session: SessionUser): boolean {
  return session.role === 'admin'
}

// Broadcasts & notifications — moderators broadcast only to members of
// their city. Pass the target city when sending; omit for admin
// global broadcasts.
export function canSendBroadcasts(session: SessionUser, targetCityId?: string | null): boolean {
  if (session.role !== 'admin' && session.role !== 'moderator') return false
  return targetCityId === undefined ? true : canActInCity(session, targetCityId)
}

// Analytics
export function canViewAnalytics(session: SessionUser): boolean {
  return session.role === 'admin'
}

// Audit log — moderator visibility scoped to their city when the
// caller wants a city-narrowed view. Admins always see everything.
export function canViewAuditLog(session: SessionUser, targetCityId?: string | null): boolean {
  if (session.role !== 'admin' && session.role !== 'moderator') return false
  return targetCityId === undefined ? true : canActInCity(session, targetCityId)
}

// Platform settings
export function canManageSettings(session: SessionUser): boolean {
  return session.role === 'admin'
}

// Articles / Posts
export function canManagePosts(session: SessionUser): boolean {
  return session.role === 'admin' || session.role === 'moderator'
}

// Blacklist
export function canManageBlacklist(session: SessionUser): boolean {
  return session.role === 'admin'
}

// Event message moderation — moderator scoped to events in their city.
export function canModerateMessages(session: SessionUser, targetCityId?: string | null): boolean {
  if (session.role !== 'admin' && session.role !== 'moderator') return false
  return targetCityId === undefined ? true : canActInCity(session, targetCityId)
}

// Event approval queue — moderator scoped to events in their city.
export function canModerateEventQueue(session: SessionUser, targetCityId?: string | null): boolean {
  if (session.role !== 'admin' && session.role !== 'moderator') return false
  return targetCityId === undefined ? true : canActInCity(session, targetCityId)
}

// Escalation
export function canEscalate(session: SessionUser): boolean {
  return session.role === 'admin' || session.role === 'moderator'
}

// Moderator oversight stats
export function canViewModStats(session: SessionUser): boolean {
  return session.role === 'admin' || session.role === 'moderator'
}

// ── Async host checks ──────────────────────────────────────────────────────
export async function isClubHost(userId: string): Promise<boolean> {
  const count = await prisma.clubMembership.count({
    where: { userId, status: 'approved', role: 'host' },
  })
  return count > 0
}

export async function isClubHostFor(userId: string, clubId: string): Promise<boolean> {
  const m = await prisma.clubMembership.findUnique({
    where: { userId_clubId: { userId, clubId } },
    select: { status: true, role: true },
  })
  return m?.status === 'approved' && m?.role === 'host'
}

// ── City-level host capabilities ──────────────────────────────────────────
//
// Three layers of city-level hosting authority, ordered by status:
//   1. admin           — global, can host anywhere
//   2. city consul     — appointed lead for that city (City.consulUserId)
//   3. city host       — granted operational hosting (CityHost row)
//
// canHostInCity combines them so callers don't have to re-implement
// the cascade. Club hosting (ClubMembership.role='host') is separate
// and per-club — handled by isClubHostFor above.

/** Is `userId` the appointed consul for `cityId`? Cheap single query. */
export async function isCityConsul(userId: string, cityId: string): Promise<boolean> {
  const city = await prisma.city.findUnique({
    where:  { id: cityId },
    select: { consulUserId: true },
  })
  return city?.consulUserId === userId
}

/** Has `userId` been granted city-host status (approved) for `cityId`? */
export async function isCityHost(userId: string, cityId: string): Promise<boolean> {
  const row = await prisma.cityHost.findUnique({
    where:  { userId_cityId: { userId, cityId } },
    select: { status: true },
  })
  return row?.status === 'approved'
}

/**
 * Can the session host events in this city WITHOUT a club affiliation?
 * Used by the events-create flow when the new event has no clubId.
 *
 *   - Admins: yes, anywhere.
 *   - Consul of the city: yes.
 *   - User with an approved CityHost row for the city: yes.
 *   - Otherwise: no.
 *
 * Note: a club host is NOT automatically a city host. Hosting a club
 * series doesn't make you an authority on city-wide programming —
 * those need explicit promotion.
 */
export async function canHostInCity(session: SessionUser, cityId: string): Promise<boolean> {
  if (session.role === 'admin') return true
  if (await isCityConsul(session.id, cityId)) return true
  if (await isCityHost(session.id, cityId))   return true
  return false
}

/**
 * Top-level event-creation authority. The caller passes the proposed
 * event's cityId (always required now) and clubId (optional — null/
 * undefined for city-level events).
 *
 *   - Admin: yes.
 *   - Club event (clubId set): must be a club host of that club.
 *   - City event (no clubId):  must be admin / consul / city host.
 */
export async function canCreateEvent(
  session: SessionUser,
  cityId: string,
  clubId?: string | null,
): Promise<boolean> {
  if (session.role === 'admin') return true
  if (clubId) return isClubHostFor(session.id, clubId)
  return canHostInCity(session, cityId)
}
