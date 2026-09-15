// Which pending club join requests only staff can answer. Shared by the staff
// queue (/api/admin/clubs/requests), its Mod Home count (lib/clubRequests) and
// the admin clubs page pill — which used to disagree about inactive clubs: the
// count included them, the pill didn't, and an inactive club that still had a
// host was hidden from the default queue although that host can't act on it.
//
// Rule: a request needs staff when its club is inactive (hosting an inactive
// club decides nobody's request — PATCH /api/clubs/[slug]/members), or when the
// club has no approved host. Pure, so client pages can import it.

export type ClubStaffReason = 'club_inactive' | 'no_host'

export function clubRequestStaffReason(club: { isActive: boolean; hasHost: boolean }): ClubStaffReason | null {
  if (!club.isActive) return 'club_inactive'
  if (!club.hasHost)  return 'no_host'
  return null
}

// The club-level form, for the admin clubs list. An inactive club takes no new
// requests (the membership route 404s), so it belongs in the queue only while
// requests are still pending; an active hostless club is flagged even at zero,
// since every future request would strand. hostCount undefined (older API)
// never flags.
export function clubStaffQueueReason(club: { isActive: boolean; hostCount?: number; pendingCount?: number }): ClubStaffReason | null {
  if (club.hostCount === undefined) return null
  const reason = clubRequestStaffReason({ isActive: club.isActive, hasHost: club.hostCount > 0 })
  if (reason === 'club_inactive' && (club.pendingCount ?? 0) === 0) return null
  return reason
}
