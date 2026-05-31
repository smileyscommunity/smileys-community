// Shared types for the campaigns Board panel — sponsors + prizes.
// Both surfaces edit through the existing global CRUD endpoints
// (/api/admin/cup/sponsors, /api/admin/cup/prizes) and list through
// the campaign-scoped GETs (/api/admin/campaigns/[id]/sponsors,
// /api/admin/campaigns/[id]/prizes).

export interface AdminSponsor {
  id:           string
  slug:         string
  name:         string
  blurb:        string | null
  logoUrl:      string | null
  websiteUrl:   string | null
  instagramUrl: string | null
  status:       string
  createdAt:    string
  updatedAt:    string
  addedBy:      { id: string; name: string } | null
  _count?:      { prizes: number }
}

export interface AdminPrize {
  id:          string
  title:       string
  description: string | null
  imageUrl:    string | null
  rank:        number | null   // 1 / 2 / 3 / null (spot prize)
  status:      string          // 'draft' | 'active' | 'awarded' | 'archived'
  sponsorId:   string | null
  sponsor:     { id: string; name: string; logoUrl: string | null } | null
  awardedTo:   { id: string; name: string } | null
  awardedAt:   string | null
  createdAt:   string
  updatedAt:   string
}

export const PRIZE_STATUSES   = ['draft', 'active', 'awarded', 'archived'] as const
export const SPONSOR_STATUSES = ['active', 'archived'] as const

// Same Tailwind pill colours we use on the Campaign status row so
// the visual vocabulary stays consistent across the admin panel.
export const STATUS_PILL: Record<string, string> = {
  draft:    'bg-zinc-700 text-zinc-400',
  active:   'bg-emerald-500/10 text-emerald-400',
  awarded:  'bg-amber-500/10 text-amber-400',
  archived: 'bg-zinc-800 text-zinc-500',
}
