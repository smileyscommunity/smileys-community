// ── City status vocabulary (pure, client-safe) ──────────────────────────────
// Deliberately free of any database import: this module is used by CLIENT
// components (the admin Cities page) as well as server code. Importing
// `prisma` here would drag the Postgres driver into the client bundle and the
// build would fail resolving `fs`/`tls`. Queries live in lib/cities.ts.
//
// Statuses, in the order a city moves through them:
//
//   coming_soon  Announced, nothing to join yet. Public, but shows no stats and
//                no event discovery — an empty city must never look operational.
//   preparing    Seeding clubs and hosts, accepting early applications.
//   live         Fully operational: stats, events, clubs, the lot.
//   paused       Hidden from the public site entirely (wound down, or a mistake).
//
// Only `live` cities get community statistics. That rule is enforced here, in
// getPublicCities, rather than left to each caller to remember — a card that
// renders "0 members" for a city we haven't launched does more damage than
// showing no number at all.

export const CITY_STATUS = {
  ComingSoon: 'coming_soon',
  Preparing:  'preparing',
  Live:       'live',
  Paused:     'paused',
} as const

export type CityStatus = typeof CITY_STATUS[keyof typeof CITY_STATUS]

export const CITY_STATUS_VALUES: CityStatus[] = [
  CITY_STATUS.ComingSoon,
  CITY_STATUS.Preparing,
  CITY_STATUS.Live,
  CITY_STATUS.Paused,
]

export function isCityStatus(v: unknown): v is CityStatus {
  return typeof v === 'string' && (CITY_STATUS_VALUES as string[]).includes(v)
}

// Public-facing label + tone for each status. `paused` has a label only so
// admin surfaces can render it; it never reaches a public page.
export const CITY_STATUS_META: Record<CityStatus, { label: string; tone: 'live' | 'soon' | 'muted' }> = {
  [CITY_STATUS.Live]:       { label: 'Live',        tone: 'live'  },
  [CITY_STATUS.Preparing]:  { label: 'Preparing',   tone: 'soon'  },
  [CITY_STATUS.ComingSoon]: { label: 'Coming soon', tone: 'soon'  },
  [CITY_STATUS.Paused]:     { label: 'Paused',      tone: 'muted' },
}

export interface CityStats {
  members: number
  clubs:   number
  events:  number   // upcoming, not lifetime — "what can I join?" beats "what have you done?"
}

export interface PublicCity {
  id:          string
  slug:        string
  name:        string
  country:     string
  status:      CityStatus
  tagline:     string | null
  description: string | null
  heroImage:   string | null
  // Null for anything not live. See the note at the top: a pre-launch city
  // showing zeros reads as a dead community rather than a future one.
  stats:       CityStats | null
}
