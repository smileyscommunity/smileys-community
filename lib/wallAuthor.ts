import { restrictedSetFor } from '@/lib/memberPrivacy'
import { firstNameOf } from '@/lib/data'
import type { SessionUser } from '@/lib/session'

// Who wrote it, as this viewer may see them — for the neighbourhood wall.
//
// The wall read its authors raw: full name, photo and member id for
// everyone. `buildAuthor` in lib/posts "never passes profileVisibility
// through" only because it never read it, so a member who had set their
// profile to connections-only was shown in full to strangers on the wall
// while every other surface gave them a first name and no photo.
//
// Deliberately NOT in lib/posts: that module has no imports at all and its
// helpers are shape-only, which keeps it safe to pull into a client bundle.
// This one reaches the database.
//
// Blocks and banned/hidden authors are filtered in the query itself
// (LIVE_BOARD_AUTHOR + blockedIdsFor) — a restricted author is still shown
// here, just as a first name, the same as the board.
export type WallAuthorRow = {
  id: string
  name: string
  color: string
  profilePhoto: string | null
  role: string
  profileVisibility: string | null
}

export type ShownWallAuthor = {
  id: string; name: string; color: string; photo: string | null; role: string
}

export async function wallAuthors(
  session: SessionUser,
  rows: WallAuthorRow[],
): Promise<(u: WallAuthorRow) => ShownWallAuthor> {
  const restricted = await restrictedSetFor(session, rows)
  return u => restricted.has(u.id)
    ? { id: u.id, name: firstNameOf(u.name), color: u.color, photo: null, role: u.role }
    : { id: u.id, name: u.name, color: u.color, photo: u.profilePhoto, role: u.role }
}
