// Shared types + display constants for the campaigns admin
// surfaces (/admin/campaigns + /admin/campaigns/[id]). Previously
// each page redefined the Campaign interface and the STATUS_PILL
// map inline, which made the two pages drift over time.

export interface AdminCampaign {
  id:          string
  slug:        string
  name:        string
  emoji:       string | null
  tagline:     string | null
  description: string | null
  coverImage:  string | null
  status:      string
  routeSlug:   string
  hasFixtures: boolean
  startsAt:    string | null
  endsAt:      string | null
  createdAt?:  string
  updatedAt?:  string
  _count?: {
    sponsors:          number
    prizes:            number
    donations:         number
    // Pending = status='pending' subset of donations. Merged into
    // the collection GET via a parallel groupBy (Prisma doesn't
    // accept a where filter on individual _count fields). Detail
    // GET omits this — the page computes it from the donations
    // list it already loads.
    pendingDonations?: number
  }
}

// Tailwind classes for each status badge. Single source so the list
// and detail pages agree at a glance, and adding a new status only
// requires a one-line change here.
export const CAMPAIGN_STATUS_PILL: Record<string, string> = {
  draft:    'bg-zinc-700 text-zinc-400',
  active:   'bg-emerald-500/10 text-emerald-400',
  wrapped:  'bg-amber-500/10 text-amber-400',
  archived: 'bg-zinc-800 text-zinc-500',
}

// Full list for status transition UI. Order matters for the lifecycle
// reading: draft → active → wrapped → archived.
export const CAMPAIGN_STATUSES = ['draft', 'active', 'wrapped', 'archived'] as const
export type   CampaignStatus     = (typeof CAMPAIGN_STATUSES)[number]
