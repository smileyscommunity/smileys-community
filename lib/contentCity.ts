// Which city owns a piece of content, by slug.
//
// Server-only: the root layout uses it to give the footer the city of the page
// it is wrapping, for pages whose URL carries no city (a guide experience, a
// guide route, a neighborhood, a handbook article). See contentCitySlugPath for
// which paths qualify and why feeds deliberately don't.
//
// Cached for 60s per (kind, slug) in module memory — this runs on every request
// to those pages, and a slug's owning city changes about as often as the row is
// created.

import { prisma } from './prisma'
import type { ContentCityRef as Ref } from './pathCitySlug'

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
    } else if (ref.kind === 'handbook') {
      // Same published-only rule as the guide. A global article has no cityId,
      // so it resolves to null here and the footer keeps the reader's city —
      // only a city-local article (Başkentkart, BursaKart) redresses the page.
      // The page itself 404s anything that isn't a published handbook post, so
      // the filter can't disagree with what the reader sees.
      const row = await prisma.post.findFirst({
        where:  { slug: ref.slug, kind: 'handbook', status: 'published' },
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
