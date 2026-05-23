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

// ── Capability-based checks ────────────────────────────────────────────────
// Finance
export function canManagePayments(session: SessionUser): boolean {
  return session.role === 'admin'
}

// Applications & vetting
export function canReviewApplications(session: SessionUser): boolean {
  return session.role === 'admin' || session.role === 'moderator'
}

// Community reports
export function canModerateReports(session: SessionUser): boolean {
  return session.role === 'admin' || session.role === 'moderator'
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

// Suspending (soft action — admin and moderator)
export function canSuspendUsers(session: SessionUser): boolean {
  return session.role === 'admin' || session.role === 'moderator'
}

// User management (Admin only: roles, bans, delete)
export function canManageUsers(session: SessionUser): boolean {
  return session.role === 'admin'
}

// User list visibility (Admin and Moderator: view profiles, but PII may be masked)
export function canViewUserList(session: SessionUser): boolean {
  return session.role === 'admin' || session.role === 'moderator'
}

// Clubs
export function canManageClubs(session: SessionUser): boolean {
  return session.role === 'admin'
}

// Tags / taxonomy
export function canManageTags(session: SessionUser): boolean {
  return session.role === 'admin'
}

// Broadcasts & notifications
export function canSendBroadcasts(session: SessionUser): boolean {
  return session.role === 'admin' || session.role === 'moderator'
}

// Analytics
export function canViewAnalytics(session: SessionUser): boolean {
  return session.role === 'admin'
}

// Audit log
export function canViewAuditLog(session: SessionUser): boolean {
  return session.role === 'admin' || session.role === 'moderator'
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

// Event message moderation
export function canModerateMessages(session: SessionUser): boolean {
  return session.role === 'admin' || session.role === 'moderator'
}

// Event approval queue
export function canModerateEventQueue(session: SessionUser): boolean {
  return session.role === 'admin' || session.role === 'moderator'
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
