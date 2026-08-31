import { MetadataRoute } from 'next'
import { statSync } from 'fs'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { loadExperiences, loadRoutes } from '@/lib/guideContent'
import { getDefaultCityId, getPublicCities, CITY_STATUS } from '@/lib/cities'
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
  // The public SEO surface used to be the default city alone — a note from when
  // Istanbul was the only one. Bodrum then launched with its own guide, clubs,
  // events and fifteen neighborhood pages, none of which any crawler could
  // find: /app/bodrum was listed, and nothing underneath it was.
  const cities   = await getPublicCities()
  const liveIds  = cities.filter(c => c.status === CITY_STATUS.Live).map(c => c.id)
  // Fall back to the default city if no city is live (a fresh clone), so this
  // never silently produces a sitemap with no content in it.
  const cityIds  = liveIds.length ? liveIds : [await getDefaultCityId()]

  const [events, clubs, posts, listings, businesses, movingSales, hoods, guideEntries] = await Promise.all([
    prisma.event.findMany({
      where: { status: 'published', cityId: { in: cityIds } },
      select: { id: true, updatedAt: true },
      orderBy: { date: 'desc' },
      take: 200,
    }),
    prisma.club.findMany({
      where: { isActive: true, cityId: { in: cityIds } },
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
      where:   { status: 'active', cityId: { in: cityIds } },
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
      where:   { isApproved: true, isActive: true, cityId: { in: cityIds } },
      select:  { id: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take:    500,
    }),
    // Moving sales are public, one-per-departure — each gets a shareable
    // detail page at /moving-sales/[id] so a link sent off-platform still
    // lands somewhere real instead of a 404.
    prisma.movingSale.findMany({
      where:   { status: 'active', cityId: { in: cityIds } },
      select:  { id: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take:    200,
    }),
    // Neighborhood pages come from the per-city registry now. They were built
    // from NEIGHBORHOOD_META — Istanbul's hardcoded constant — so a second
    // city's areas could never appear however many it had.
    prisma.neighborhood.findMany({
      where:   { cityId: { in: cityIds }, active: true },
      select:  { slug: true, updatedAt: true },
      orderBy: { sortOrder: 'asc' },
    }),
    // Guide experiences and routes were in the sitemap not at all: 27 pages,
    // each with its own title, its own Take and its own share card, invisible.
    prisma.guideEntry.findMany({
      where:   { status: 'published', cityId: { in: cityIds } },
      select:  { slug: true, kind: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
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
  // One entry per public city page. Live cities rank just under the global
  // landing page; pre-launch ones are real pages (a holding page with a
  // sign-up) but carry a lower priority and no lastModified, since nothing on
  // them changes until they launch.
  const cityRoutes: MetadataRoute.Sitemap = cities.map(c => (
    c.status === CITY_STATUS.Live
      ? { url: `${BASE}/${c.slug}`, priority: 0.95, changeFrequency: 'daily' as const, lastModified: newest([newestEvent, newestClub]) }
      : { url: `${BASE}/${c.slug}`, priority: 0.4,  changeFrequency: 'monthly' as const }
  ))

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
    // Cup 2026 wrapped Jul 19 — the page stays up as an archive of the
    // final standings, so keep it crawlable but stop advertising it.
    { url: `${BASE}/cup`,           priority: 0.1, changeFrequency: 'yearly'  },
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

  // Slugs are unique per city but a URL is a URL — dedupe so two cities sharing
  // a name (a "Merkez" apiece) can't emit the same <loc> twice.
  const neighborhoodRoutes: MetadataRoute.Sitemap = [...new Map(hoods.map(n => [n.slug, n])).values()]
    .map(n => ({
      url:             `${BASE}/neighborhoods/${n.slug}`,
      // The editorial JSON's mtime where one exists (Istanbul's), else the
      // row's own timestamp — an honest date either way.
      lastModified:    neighborhoodMtimes.get(n.slug) ?? n.updatedAt,
      priority:        0.7,
      changeFrequency: 'weekly' as const,
    }))

  // Asked of the LOADERS, not the table: loadExperiences falls back to the
  // shipped JSON for the default city when guide_entries is empty (a fresh
  // clone, or a DB hiccup), and those pages do serve. Querying the table
  // directly meant the sitemap silently dropped every one of them in exactly
  // that window — a second source of truth, disagreeing with the pages.
  //
  // Timestamps still come from the table where a row exists; a JSON-served
  // entry has no row, so it takes the JSON file's mtime, which is the real
  // "this content changed" date for it.
  const guideByCity = await Promise.all(cityIds.map(async id => ({
    experiences: await loadExperiences(id),
    routes:      await loadRoutes(id),
  })))
  const stamp = new Map(guideEntries.map(g => [`${g.kind}:${g.slug}`, g.updatedAt]))
  const jsonStamp = fileMtime('guide-experiences.json')

  // Flat list first, then dedupe by key — the template-literal types make an
  // inline Map of mixed tuples more trouble than it is worth.
  const guidePages: { key: string; url: string }[] = guideByCity.flatMap(({ experiences, routes }) => [
    ...experiences.map(e => ({ key: `experience:${e.slug}`, url: `${BASE}/guide/${e.slug}` })),
    ...routes.map(r      => ({ key: `route:${r.slug}`,      url: `${BASE}/guide/routes/${r.slug}` })),
  ])

  const guideRoutes: MetadataRoute.Sitemap = [...new Map(guidePages.map(g => [g.key, g])).values()]
    .map(({ url, key }) => ({
    url,
    lastModified:    stamp.get(key) ?? jsonStamp,
    priority:        0.7,
    changeFrequency: 'monthly' as const,
  }))

  return [
    ...staticRoutes,
    ...cityRoutes,
    ...neighborhoodRoutes,
    ...guideRoutes,
    ...eventRoutes,
    ...clubRoutes,
    ...postRoutes,
    ...listingRoutes,
    ...movingSaleRoutes,
    ...businessRoutes,
  ]
}
