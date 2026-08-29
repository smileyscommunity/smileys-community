// ── Admin guide-file plumbing (server only) ─────────────────────────────────
// Shared by the admin neighborhood routes (list / edit / image). Two jobs:
//
// 1. guideFileFor — the on-disk layout for guide JSON, mirroring the public
//    loader (app/neighborhoods/[slug]/page.tsx) exactly: the default city
//    keeps its ~103 files at the flat legacy path (data/neighborhoods/
//    moda.json); every other city is namespaced under its slug
//    (data/neighborhoods/izmir/alsancak.json), because guide slugs are only
//    unique WITHIN a city.
//
// 2. resolveAdminCity — the ?city= query param those routes accept. Absent/
//    empty means the default city, so pre-multi-city bookmarks and clients
//    that never send the param behave byte-identically.

import { join } from 'path'
import { prisma } from './prisma'
import { DEFAULT_CITY_SLUG } from './city'

export function guideFileFor(citySlug: string, isDefault: boolean, slug: string): string {
  return isDefault
    ? join(process.cwd(), 'data', 'neighborhoods', `${slug}.json`)
    : join(process.cwd(), 'data', 'neighborhoods', citySlug, `${slug}.json`)
}

export interface AdminGuideCity {
  id: string
  slug: string
  name: string
  isDefault: boolean
}

export async function resolveAdminCity(cityParam: string | null): Promise<AdminGuideCity | null> {
  const slug = cityParam?.trim() || DEFAULT_CITY_SLUG
  const city = await prisma.city.findUnique({
    where:  { slug },
    select: { id: true, slug: true, name: true },
  })
  if (!city) return null
  return { ...city, isDefault: city.slug === DEFAULT_CITY_SLUG }
}
