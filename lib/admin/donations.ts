// Shared types + helpers for the donation review UI used by
// /admin/cup and /admin/campaigns/[id]. Both surfaces hit different
// PATCH endpoints but render the exact same row markup, so the
// types and small helpers live here once.

export interface AdminDonation {
  id:                string
  donorName:         string
  donorEmail:        string
  donorOrganization: string | null
  donorPhone:        string | null
  prizeTitle:        string
  prizeDescription:  string
  estimatedValue:    number | null
  notes:             string | null
  status:            'pending' | 'approved' | 'declined' | string
  reviewedAt:        string | null
  reviewNote:        string | null
  reviewedBy:        { id: string; name: string } | null
  linkedSponsorId:   string | null
  linkedPrizeId:     string | null
  createdAt:         string
}

// Sponsor-slug suggestion derived from the donor name or org. Same
// rules the server enforces in lib/cup-prize-conversion.ts so the
// preview matches the canonical slug at write time.
export function slugifyDonor(input: string): string {
  return input.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// Light URL sanity for the publish form. Empty string is allowed
// (treated as "no link given"); non-empty must parse and be
// http(s). Catches typos like "smileys.com" (no protocol) before
// they end up on the public prize page.
export function isMaybeValidUrl(s: string): boolean {
  if (!s.trim()) return true
  try {
    const u = new URL(s.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
