// Pin placement for the /directory map, kept out of components/DirectoryMap.tsx
// so it stays a pure, client-safe module the tests can import (vitest here has
// no JSX transform for the .tsx).
//
// Pins land on:
//   1. The business's own (lat, lon) when set, otherwise
//   2. For default-city businesses only, the centroid of its neighborhood
//      (from NEIGHBORHOOD_META) offset by a deterministic per-id jitter so
//      multiple businesses in the same neighborhood don't stack on one pixel.

import { NEIGHBORHOOD_META } from '@/lib/neighborhoods'

export interface PositionedBusiness {
  id: string
  neighborhood: string | null
  latitude:  number | null
  longitude: number | null
  // Slug of the city the business itself is listed in, as the directory API
  // returns it per row. Gates the neighborhood fallback below; absent means
  // "unknown", which gets no fallback pin.
  citySlug?: string | null
}

// Mirrors DEFAULT_CITY_SLUG in lib/city — not imported because that module
// pulls in prisma, which can't ship in the client bundle.
export const DEFAULT_CITY_SLUG = 'istanbul'

// Deterministic per-id jitter in roughly ±300m at the default city's latitude.
// Same id always produces the same offset, so re-renders don't make pins jump.
export function jitterFromId(id: string): [number, number] {
  let a = 0, b = 0
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i)
    a = (a * 131 + c)  & 0xffff
    b = (b * 257 + c) & 0xffff
  }
  // ~0.003 lat/lon ≈ 300m
  return [
    ((a / 0xffff) - 0.5) * 0.006,
    ((b / 0xffff) - 0.5) * 0.006,
  ]
}

export function resolvePosition(b: PositionedBusiness): [number, number] | null {
  if (b.latitude != null && b.longitude != null) return [b.latitude, b.longitude]
  // NEIGHBORHOOD_META is Istanbul-only and keyed by bare name, and other
  // cities reuse those names (Ankara's Bahçelievler/Ulus, İzmir's Göztepe) —
  // the fallback pinned them in Istanbul and fitBounds spanned both cities.
  // Only the default city's businesses may use it; unknown city → no pin.
  if (b.neighborhood && b.citySlug === DEFAULT_CITY_SLUG) {
    const meta = NEIGHBORHOOD_META[b.neighborhood]
    // Coordinates are nullable now — a neighbourhood nobody has placed yet
    // gives no pin rather than one at 0,0.
    if (meta && meta.lat != null && meta.lon != null) {
      const [dLat, dLon] = jitterFromId(b.id)
      return [meta.lat + dLat, meta.lon + dLon]
    }
  }
  return null
}
