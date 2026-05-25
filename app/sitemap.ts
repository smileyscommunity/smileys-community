import { MetadataRoute } from 'next'
import { prisma } from '@/lib/prisma'
import { NEIGHBORHOOD_META, neighborhoodToSlug } from '@/lib/neighborhoods'

export const dynamic = 'force-dynamic'

const BASE = 'https://smileyscommunity.com/app'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [events, clubs, posts, listings] = await Promise.all([
    prisma.event.findMany({
      where: { status: 'published' },
      select: { id: true, updatedAt: true },
      orderBy: { date: 'desc' },
      take: 200,
    }),
    prisma.club.findMany({
      where: { isActive: true },
      select: { slug: true, createdAt: true },
    }),
    prisma.post.findMany({
      where: { status: 'published' },
      select: { slug: true, publishedAt: true },
      take: 100,
    }),
    // Marketplace listings are public — let Google crawl them so search hits
    // like "flats in Moda" can land on the listing.
    prisma.listing.findMany({
      where:   { status: 'active' },
      select:  { id: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
      take:    500,
    }),
  ])

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE}/`,              priority: 1.0, changeFrequency: 'daily'   },
    { url: `${BASE}/events`,        priority: 0.9, changeFrequency: 'daily'   },
    { url: `${BASE}/listings`,      priority: 0.8, changeFrequency: 'daily'   },
    { url: `${BASE}/guide`,         priority: 0.8, changeFrequency: 'weekly'  },
    { url: `${BASE}/clubs`,         priority: 0.8, changeFrequency: 'weekly'  },
    { url: `${BASE}/apply`,         priority: 0.8, changeFrequency: 'monthly' },
    { url: `${BASE}/about`,         priority: 0.7, changeFrequency: 'monthly' },
    { url: `${BASE}/why`,           priority: 0.7, changeFrequency: 'monthly' },
    { url: `${BASE}/faq`,           priority: 0.6, changeFrequency: 'monthly' },
    { url: `${BASE}/contact`,       priority: 0.5, changeFrequency: 'monthly' },
    { url: `${BASE}/neighborhoods`, priority: 0.6, changeFrequency: 'monthly' },
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

  const postRoutes: MetadataRoute.Sitemap = posts.map(p => ({
    url:          `${BASE}/posts/${p.slug}`,
    lastModified: p.publishedAt ?? undefined,
    priority:     0.6,
    changeFrequency: 'monthly',
  }))

  const listingRoutes: MetadataRoute.Sitemap = listings.map(l => ({
    url:          `${BASE}/listings/${l.id}`,
    lastModified: l.updatedAt,
    priority:     0.6,
    changeFrequency: 'weekly',
  }))

  const neighborhoodRoutes: MetadataRoute.Sitemap = Object.keys(NEIGHBORHOOD_META).map(name => ({
    url:             `${BASE}/neighborhoods/${neighborhoodToSlug(name)}`,
    priority:        0.7,
    changeFrequency: 'weekly' as const,
  }))

  return [...staticRoutes, ...neighborhoodRoutes, ...eventRoutes, ...clubRoutes, ...postRoutes, ...listingRoutes]
}
