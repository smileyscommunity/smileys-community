import { firstNameOf } from '@/lib/data'
import { restrictedSetFor } from '@/lib/memberPrivacy'
import type { SessionUser } from '@/lib/session'

export interface AuthorRow {
  id:                string
  name:              string
  color:             string
  profilePhoto:      string | null
  profileVisibility: string | null
}

export interface ShownAuthor {
  id:           string
  name:         string
  color:        string
  profilePhoto: string | null
}

/**
 * How the author of a board post, reply, guide tip, directory review or moving
 * sale is shown to this viewer — one rule for the public APIs that list them.
 *
 *   - A guest sees a first name and a colour, no photo and no member id: the
 *     content is public, who wrote it is for members. (Listings already go
 *     further and show "Smileys member"; lib/listingsPublic.)
 *   - A member sees the author in full, except a connections-only author they
 *     aren't connected to, who shows a first name and no photo — the rule the
 *     member pages apply (lib/memberPrivacy restrictedSetFor).
 *
 * These endpoints handed every visitor full names, member ids and photos, and
 * the business page's own first-name rule was undone by the API behind it.
 * The returned function never passes profileVisibility through.
 */
export async function authorProjector(
  session: SessionUser | null,
  authors: AuthorRow[],
): Promise<(a: AuthorRow) => ShownAuthor> {
  if (!session) {
    return a => ({ id: 'member', name: firstNameOf(a.name) || 'Smileys member', color: a.color, profilePhoto: null })
  }
  const restricted = await restrictedSetFor(session, authors)
  return a => restricted.has(a.id)
    ? { id: a.id, name: firstNameOf(a.name), color: a.color, profilePhoto: null }
    : { id: a.id, name: a.name, color: a.color, profilePhoto: a.profilePhoto }
}
