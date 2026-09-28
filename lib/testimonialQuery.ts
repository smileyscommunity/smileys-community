// Which member quotes may be shown on a public page, and which fields leave
// the server. A quote typed by an admin has no author row; a self-submitted
// one does, and it goes when its author can no longer be listed — banned,
// suspended or admin-hidden (account deletion already blanks the row). The
// photo of a self-submitted quote is the member's own profile file, so a
// member who has since made their profile connections-only keeps their quote
// but not their face.
export function testimonialAuthorOk() {
  return {
    OR: [
      { userId: null },
      { user: { status: 'approved', hiddenFromMembers: false, OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }] } },
    ],
  }
}

export const TESTIMONIAL_SELECT = {
  id: true, quote: true, memberName: true, role: true, photo: true, cityId: true,
  user: { select: { profileVisibility: true } },
} as const

export function publicTestimonial<T extends { photo: string | null; user: { profileVisibility: string | null } | null }>(t: T) {
  const { user, ...rest } = t
  return { ...rest, photo: user?.profileVisibility === 'connections' ? null : t.photo }
}
