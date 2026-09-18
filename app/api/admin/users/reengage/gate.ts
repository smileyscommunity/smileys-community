import type { SessionUser } from '@/lib/session'
import { canManageUsers, canActInCity } from '@/lib/access'

// Who may draft and send a "we miss you" nudge to a member. The Retention page
// is a moderator page, but both of its actions used to be admin-only, so every
// moderator who pressed Nudge got a 403. Moderators nudge the members of their
// own city; admins nudge anyone. The member's city is checked explicitly
// rather than left to canActInCity, which admits a moderator to a resource
// with no city — a member row without one fails closed here instead.
export function mayReengage(session: SessionUser, memberCityId: string | null | undefined): boolean {
  if (canManageUsers(session)) return true
  if (session.role !== 'moderator') return false
  if (!memberCityId) return false
  return canActInCity(session, memberCityId)
}

// Moderators can now send these, so a member must not be nudged again and
// again by several staff in a row: one nudge per member per week, whoever
// sends it. The per-sender caps keep a stuck button (or a loop) from sending
// or paying for model calls without end.
export const REENGAGE_DEDUPE_MS   = 7 * 24 * 60 * 60 * 1000
export const REENGAGE_SEND_LIMIT  = 30
export const REENGAGE_DRAFT_LIMIT = 30
export const REENGAGE_WINDOW_MS   = 60 * 60 * 1000
export const REENGAGE_MAX_LENGTH  = 1000

export const reengageClaimKey = (userId: string) => `reengage:${userId}`
