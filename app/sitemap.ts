import { MetadataRoute } from 'next'
import { statSync } from 'fs'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { getDefaultCityId } from '@/lib/city'
import { NEIGHBORHOOD_META, neighborhoodToSlug } from '@/lib/neighborhoods'

export const dynamic = 'force-dynamic'

const BASE = 'https://smileyscommunity.com/app'

// Real mtime of a content file under data/ (these are admin-edited at runtime
// via /admin/*, and rsync-excluded from deploys, so the mtime on the server is
// a genuine last-edited date — not a build artifact).
function fileMtime(...segments: string[]): Date | undefined {
  try { return statSync(join(process.cwd(), 'data', ...segments)).mtime } catch { return undefined }
}

function newest(dates: Array<Date | null | undefined>): Date | undefined {
  const valid = dates.filter((d): d is Date => d instanceof Date)
  return valid.length ? new Date(Math.max(...valid.map(d => d.getTime()))) : undefined
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Public SEO surface = the default city until per-city pages ship.
  const cityId = await getDefaultCityId()
  const [events, clubs, posts, listings, businesses, movingSales] = await Promise.all([
    prisma.event.findMany({
      where: { status: 'published', cityId },
      select: { id: true, updatedAt: true },
      orderBy: { date: 'desc' },
      take: 200,
    }),
    prisma.club.findMany({
      where: { isActive: true, cityId },
      select: { slug: true, createdAt: true },
    }),
    prisma.post.findMany({
      where: { status: 'published' },
      select: { slug: true, publishedAt: true, kind: true },
      take: 200,
    }),
    // Marketplace listings are public — let Google crawl them so search hits
    // like "flats in Moda" can land on the listing.
    prisma.listing.findMany({
      where:   { status: 'active', cityId },
      select:  { id: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
      take:    500,
    }),
    // Approved + active directory entries — each gets a per-business
    // landing page with JSON-LD LocalBusiness markup at
    // /directory/[id]. Surfacing them here lets search hits like
    // "expat-owned Indian restaurant Kadıköy" land on the right
    // dedicated page.
    prisma.business.findMany({
      where:   { isApproved: true, isActive: true, cityId },
      select:  { id: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take:    500,
    }),
    // Moving sales are public, one-per-departure — each gets a shareable
    // detail page at /moving-sales/[id] so a link sent off-platform still
    // lands somewhere real instead of a 404.
    prisma.movingSale.findMany({
      where:   { status: 'active', cityId },
      select:  { id: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take:    200,
    }),
  ])

  // Per-neighborhood guides are admin-edited JSON files; their mtime is the
  // real "this page changed" date for /neighborhoods/<slug>.
  const neighborhoodMtimes = new Map(
    Object.keys(NEIGHBORHOOD_META).map(name => {
      const slug = neighborhoodToSlug(name)
      return [slug, fileMtime('neighborhoods', `${slug}.json`)] as const
    }),
  )

  // Index pages change when the content they list changes — derive from the
  // rows already fetched above rather than stamping the response time (a
  // generation-time lastmod is exactly what trains Google to ignore the field).
  const newestEvent    = newest(events.map(e => e.updatedAt))
  const newestClub     = newest(clubs.map(c => c.createdAt))
  const newestPost     = newest(posts.map(p => p.publishedAt))
  const newestListing  = newest(listings.map(l => l.updatedAt))
  const newestBusiness = newest(businesses.map(b => b.updatedAt))
  const newestMovingSale = newest(movingSales.map(s => s.createdAt))

  // Pages with no honest signal (pure code-driven marketing copy) deliberately
  // omit lastModified — an invented date is worse than none.
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE,                    priority: 1.0, changeFrequency: 'daily',   lastModified: newest([newestEvent, newestPost, newestClub]) },
    { url: `${BASE}/events`,        priority: 0.9, changeFrequency: 'daily',   lastModified: newestEvent },
    { url: `${BASE}/board`,         priority: 0.8, changeFrequency: 'daily',   lastModified: newest([newestListing, newestMovingSale]) },
    { url: `${BASE}/visiting`,      priority: 0.8, changeFrequency: 'daily'   },
    { url: `${BASE}/guide`,         priority: 0.8, changeFrequency: 'weekly',  lastModified: fileMtime('guide-experiences.json') },
    { url: `${BASE}/clubs`,         priority: 0.8, changeFrequency: 'weekly',  lastModified: newestClub },
    { url: `${BASE}/apply`,         priority: 0.8, changeFrequency: 'monthly' },
    { url: `${BASE}/about`,         priority: 0.7, changeFrequency: 'monthly' },
    { url: `${BASE}/why`,           priority: 0.7, changeFrequency: 'monthly', lastModified: fileMtime('why-content.json') },
    { url: `${BASE}/faq`,           priority: 0.6, changeFrequency: 'monthly', lastModified: fileMtime('content.json') },
    { url: `${BASE}/contact`,       priority: 0.5, changeFrequency: 'monthly' },
    { url: `${BASE}/neighborhoods`, priority: 0.6, changeFrequency: 'monthly', lastModified: newest([...neighborhoodMtimes.values()]) },
    { url: `${BASE}/directory`,     priority: 0.8, changeFrequency: 'weekly',  lastModified: newestBusiness },
    { url: `${BASE}/cup`,           priority: 0.7, changeFrequency: 'daily'   },
    { url: `${BASE}/guidelines`,    priority: 0.4, changeFrequency: 'monthly' },
  ]

  const eventRoutes: MetadataRoute.Sitemap = events.map(e => ({
    url:          `${BASE}/events/${e.id}`,
    lastModified: e.updatedAt,
    priority:     0.7,
    changeFrequency: 'weekly',
  }))

  const clubRoutes: MetadataRoute.Sitemap = clubs.map(c => ({
    url:          `${BASE}/clubs/${c.slug}`,
    lastModified: c.createdAt,
    priority:     0.7,
    changeFrequency: 'weekly',
  }))

  // Handbook articles live at /handbook/[slug]; other posts at /posts/[slug].
  // Mapping every post to /posts/... (the old behaviour) pointed the handbook
  // URLs at a 404. Handbook is public, evergreen, and a top-of-funnel SEO
  // asset, so it gets a higher priority and weekly recrawl.
  const postRoutes: MetadataRoute.Sitemap = posts.map(p => {
    const isHandbook = p.kind === 'handbook'
    return {
      url:          `${BASE}/${isHandbook ? 'handbook' : 'posts'}/${p.slug}`,
      lastModified: p.publishedAt ?? undefined,
      priority:     isHandbook ? 0.8 : 0.6,
      changeFrequency: isHandbook ? 'weekly' as const : 'monthly' as const,
    }
  })

  const listingRoutes: MetadataRoute.Sitemap = listings.map(l => ({
    url:          `${BASE}/board/${l.id}`,
    lastModified: l.updatedAt,
    priority:     0.6,
    changeFrequency: 'weekly',
  }))

  const movingSaleRoutes: MetadataRoute.Sitemap = movingSales.map(s => ({
    url:          `${BASE}/moving-sales/${s.id}`,
    lastModified: s.createdAt,
    priority:     0.5,
    changeFrequency: 'weekly',
  }))

  const businessRoutes: MetadataRoute.Sitemap = businesses.map(b => ({
    url:          `${BASE}/directory/${b.id}`,
    lastModified: b.updatedAt,
    priority:     0.7,
    changeFrequency: 'weekly',
  }))

  const neighborhoodRoutes: MetadataRoute.Sitemap = Object.keys(NEIGHBORHOOD_META).map(name => {
    const slug = neighborhoodToSlug(name)
    return {
      url:             `${BASE}/neighborhoods/${slug}`,
      lastModified:    neighborhoodMtimes.get(slug),
      priority:        0.7,
      changeFrequency: 'weekly' as const,
    }
  })

  return [
    ...staticRoutes,
    ...neighborhoodRoutes,
    ...eventRoutes,
    ...clubRoutes,
    ...postRoutes,
    ...listingRoutes,
    ...movingSaleRoutes,
    ...businessRoutes,
  ]
}
