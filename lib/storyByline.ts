import { authorProjector } from '@/lib/authorProjection'
import type { SessionUser } from '@/lib/session'

// Who a story is "by", as this viewer may see it.
//
// The Stories pages rendered every author in full — name, photo — to anyone,
// logged in or not, with no look at the member's own settings. Every other
// byline on the site (board, reviews, tips, moving sales) goes through
// authorProjector: a guest gets a first name and no photo, a member gets the
// author in full unless that author is connections-only. Stories now follow
// the same rule, plus one of their own: a writer who is no longer a member
// in good standing — suspended, removed, or hidden from the member pages —
// keeps their story up (it is public writing) but not their name on it.
export interface StoryAuthorRow {
  id:                string
  name:              string
  color:             string | null
  profilePhoto:      string | null
  profileVisibility: string | null
  status:            string
  hiddenFromMembers: boolean
}

export interface StoryByline {
  name:         string
  color:        string
  profilePhoto: string | null
}

const ANONYMOUS = 'Smileys member'

export async function storyBylines(
  session: SessionUser | null,
  authors: StoryAuthorRow[],
): Promise<(a: StoryAuthorRow) => StoryByline> {
  const show = await authorProjector(session, authors.map(a => ({ ...a, color: a.color ?? '#f59e0b' })))
  return a => {
    const color = a.color ?? '#f59e0b'
    if (a.status !== 'approved' || a.hiddenFromMembers) return { name: ANONYMOUS, color, profilePhoto: null }
    const shown = show({ ...a, color })
    return { name: shown.name || ANONYMOUS, color, profilePhoto: shown.profilePhoto }
  }
}
