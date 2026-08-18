// Which city owns a piece of content, by slug.
//
// Server-only: the root layout uses it to give the footer the city of the page
// it is wrapping, for pages whose URL carries no city (a guide experience, a
// guide route, a neighborhood). See contentCitySlugPath for which paths qualify
// and why feeds deliberately don't.
//
// Cached for 60s per (kind, slug) in module memory — this runs on every request
// to those pages, and a slug's owning city changes about as often as the row is
// created.

import { prisma } from './prisma'

type Ref = { kind: 'guide' | 'route' | 'neighborhood'; slug: string }

const TTL_MS = 60_000
const cache = new Map<string, { cityId: string | null; expires: number }>()

export async function cityIdForContent(ref: Ref): Promise<string | null> {
  const key = `${ref.kind}:${ref.slug}`
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.cityId

  let cityId: string | null = null
  try {
    if (ref.kind === 'neighborhood') {
      const row = await prisma.neighborhood.findFirst({
        where:  { slug: ref.slug, active: true },
        select: { cityId: true },
      })
      cityId = row?.cityId ?? null
    } else {
      // Only PUBLISHED entries: a draft is invisible to the reader, so its city
      // must not dress the page around it either.
      const row = await prisma.guideEntry.findFirst({
        where:  { slug: ref.slug, kind: ref.kind === 'route' ? 'route' : 'experience', status: 'published' },
        select: { cityId: true },
      })
      cityId = row?.cityId ?? null
    }
  } catch {
    // A layout must render. An unknown city here just means the footer falls
    // back to the reader's own, which is what it did before this existed.
    cityId = null
  }

  cache.set(key, { cityId, expires: Date.now() + TTL_MS })
  return cityId
}
