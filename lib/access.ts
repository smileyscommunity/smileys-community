import { prisma } from './prisma'
import type { SessionUser } from './session'
import { Role, MembershipStatus } from './constants'

// ── Primitive role checks ──────────────────────────────────────────────────
//
// totpVerified is stored on the Session row (true only when the session was
// created via the TOTP verify step). The column exists for future enforcement
// — use isAdminStrict() on the most sensitive routes once all admins have
// re-authenticated through the 2FA flow. Plain isAdmin() and
// isAdminOrModerator() do role-only checks so existing sessions aren't
// broken by the migration default of totpVerified=false.
export function isAdmin(session: SessionUser): boolean {
  return session.role === Role.Admin
}

// Requires the session to have passed through the TOTP verify step.
// Use on routes where a stolen password alone must not grant access
// (e.g. bulk deletes, payment refunds, role changes).
export function isAdminStrict(session: SessionUser): boolean {
  return session.role === Role.Admin && session.totpVerified === true
}

export function isModerator(session: SessionUser): boolean {
  return session.role === Role.Moderator
}

export function isAdminOrModerator(session: SessionUser): boolean {
  return session.role === Role.Admin || session.role === Role.Moderator
}

export function isPartner(session: SessionUser): boolean {
  return session.role === Role.Partner
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
/**
 * The cityId a MODERATOR's list queries scope to: their own city, or — for a
 * moderator with no city — a sentinel that matches no rows (fail CLOSED).
 *
 * Before this, the idiom was hand-rolled ~12 times with two different
 * sentinel spellings ('__no_city__' and '__none__'), and one route
 * (moderation) once inverted it into fail-OPEN. One helper, one spelling,
 * one behavior to audit.
 */
export function failClosedCityId(session: Pick<SessionUser, 'cityId'>): string {
  return session.cityId ?? '__no_city__'
}

export function canActInCity(session: SessionUser, targetCityId?: string | null): boolean {
  if (session.role === Role.Admin) return true
  if (session.role !== 'moderator') return false
  if (!targetCityId) return true                // resource has no city — admin/mod parity
  if (!session.cityId) return false             // moderator without a city — fail closed
  return session.cityId === targetCityId
}

// ── Capability-based checks ────────────────────────────────────────────────
// Finance
export function canManagePayments(session: SessionUser): boolean {
  return session.role === Role.Admin
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
  if (session.role === Role.Admin) return true
  return session.role === Role.Partner && session.partnerId === partnerId
}

export function canManagePartners(session: SessionUser): boolean {
  return session.role === Role.Admin || session.role === Role.Moderator
}

// Banning (hard action — admin only)

// Suspending — admin only. Moderators must escalate to an admin.
export function canSuspendUsers(session: SessionUser): boolean {
  return session.role === Role.Admin
}

// User management (Admin only: roles, bans, delete)
export function canManageUsers(session: SessionUser): boolean {
  return session.role === Role.Admin
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
  return session.role === Role.Admin
}

// Tags / taxonomy
export function canManageTags(session: SessionUser): boolean {
  return session.role === Role.Admin
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
  return session.role === Role.Admin
}

// Audit log — moderator visibility scoped to their city when the
// caller wants a city-narrowed view. Admins always see everything.
export function canViewAuditLog(session: SessionUser, targetCityId?: string | null): boolean {
  if (session.role !== 'admin' && session.role !== 'moderator') return false
  return targetCityId === undefined ? true : canActInCity(session, targetCityId)
}

// Platform settings
export function canManageSettings(session: SessionUser): boolean {
  return session.role === Role.Admin
}

// Articles / Posts
export function canManagePosts(session: SessionUser): boolean {
  return session.role === Role.Admin || session.role === Role.Moderator
}

// Blacklist
export function canManageBlacklist(session: SessionUser): boolean {
  return session.role === Role.Admin
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

// Moderator oversight stats
export function canViewModStats(session: SessionUser): boolean {
  return session.role === Role.Admin || session.role === Role.Moderator
}

// ── Async host checks ──────────────────────────────────────────────────────

/**
 * May this user manage a specific EVENT's operations — participants,
 * check-in, attendee actions?
 *
 * True for: admins; the event's host; its CO-hosts; and approved hosts of
 * its parent club. This predicate used to exist as two byte-identical
 * private copies (admin participants route + public check-in route), both
 * of which OMITTED co-hosts — so a co-host added via the cohosts route
 * could see the event chat and photos (those siblings check eventCoHost)
 * but couldn't run the door at their own event. One home, co-hosts
 * included, so the next fix lands everywhere at once.
 *
 * Deliberately admin-only at the role level (not moderators): participant
 * mutations are event-ops, and a moderator with no relationship to the
 * event has no business at its door. Moderators who host still qualify
 * through the host/co-host arms.
 */
export async function canManageEventOps(sessionId: string, sessionRole: string, eventId: string): Promise<boolean> {
  if (sessionRole === 'admin') return true
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { clubId: true, hostId: true } })
  if (!event) return false
  if (event.hostId === sessionId) return true
  const cohost = await prisma.eventCoHost.findUnique({
    where: { eventId_userId: { eventId, userId: sessionId } },
    select: { userId: true },
  })
  if (cohost) return true
  if (!event.clubId) return false
  const membership = await prisma.clubMembership.findFirst({
    where: { userId: sessionId, clubId: event.clubId, role: 'host', status: 'approved' },
    select: { id: true },
  })
  return !!membership
}
export async function isClubHost(userId: string): Promise<boolean> {
  const count = await prisma.clubMembership.count({
    where: { userId, status: MembershipStatus.Approved, role: 'host' },
  })
  return count > 0
}

export async function isClubHostFor(userId: string, clubId: string): Promise<boolean> {
  const m = await prisma.clubMembership.findUnique({
    where: { userId_clubId: { userId, clubId } },
    select: { status: true, role: true },
  })
  return m?.status === MembershipStatus.Approved && m?.role === 'host'
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
  return row?.status === MembershipStatus.Approved
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
  if (session.role === Role.Admin) return true
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
