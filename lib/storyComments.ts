import { canManagePosts, canActOnCityContent } from '@/lib/access'
import type { SessionUser } from '@/lib/session'

export const COMMENT_MAX_LEN = 1000

// Who may take down anyone's comment on a story: admins everywhere, and
// moderators on global stories (most of them have no city) or stories of
// their own city.
export function canModerateComments(session: SessionUser, postCityId: string | null): boolean {
  return canManagePosts(session) && (postCityId == null || canActOnCityContent(session, postCityId))
}

// Shared by post and edit: trimmed, capped, at most one link.
export function cleanCommentBody(raw: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const body = typeof raw === 'string' ? raw.trim().slice(0, COMMENT_MAX_LEN) : ''
  if (!body) return { ok: false, error: 'Comment cannot be empty' }
  if ((body.match(/\b(?:https?:\/\/|www\.)\S+/gi) ?? []).length > 1) return { ok: false, error: 'One link per comment, please' }
  return { ok: true, body }
}
