import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { todayInTz } from '@/lib/cityTime'
import { getEvents, getClubs } from '@/lib/db'
import { queryDirectory } from '@/lib/directory'
import { getNeighborhoodViews } from '@/lib/neighborhoodsDb'
import { getPublicCity, DEFAULT_CITY_SLUG } from '@/lib/cities'
import { CITY_STATUS } from '@/lib/cityStatus'
import { APP_URL } from '@/lib/env'
import { absoluteOgImage } from '@/lib/og'
import { isSoldOut } from '@/lib/soldOut'
import type { Event } from '@/lib/data'

// Everything the city shopfront reads, in one place, with the one boundary
// that matters drawn explicitly:
//
//   getCityPageData   — shared across every visitor, cached per city
//   the rest          — per request (the session decides what is shown)
//
// A session-dependent read must never end up inside the cached loader, or
// one member's view would be served to everyone. Sections receive what
// these return and own nothing but markup.

export type PublicCity   = NonNullable<Awaited<ReturnType<typeof getPublicCity>>>
export type CityPageData = Awaited<ReturnType<typeof getCityPageData>>

export function cityMetadata(city: PublicCity): Metadata {
  const ogImage = absoluteOgImage(city.heroImage)

  // A pre-launch page must not promise joinable clubs and events in the
  // search snippet — say what it actually is.
  const title = city.status === CITY_STATUS.Live
    ? `Smileys ${city.name} — meet people, join clubs, discover events`
    : `Smileys ${city.name} — coming soon`
  const description = city.description
    ?? city.tagline
    ?? `Your international social life in ${city.name}. Events, clubs and community for people building a life abroad.`

  return {
    title,
    description,
    alternates: { canonical: `${APP_URL}/${city.slug}` },
    // The city's own photo is the share image. A link to /athens that previews
    // the generic Smileys card tells nobody which city it is.
    openGraph: {
      title, description,
      url: `${APP_URL}/${city.slug}`,
      ...(ogImage ? { images: [{ url: ogImage, width: 1200, height: 630, alt: city.name }] } : {}),
    },
    ...(ogImage ? { twitter: { card: 'summary_large_image' as const, images: [ogImage] } } : {}),
  }
}

export const getCityPageData = unstable_cache(
  // `tz` is the city's own zone, passed in rather than defaulted: it is part of
  // the cache key (unstable_cache hashes the args), so two cities in different
  // zones can't share a "today".
  async (cityId: string, tz: string) => {
    const today        = todayInTz(tz)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const [{ events }, clubs, neighborhoodCounts, testimonials, newMembersThisWeek, guideEntries, rawStories] = await Promise.all([
      getEvents({ limit: 24, upcoming: true, cityId }),
      getClubs(cityId),
      prisma.event.groupBy({
        by: ['neighborhood'],
        // published only — a duplicated draft must not inflate a public
        // count, and the hero stat above filters the same way.
        where: { date: { gte: today }, cityId, status: 'published' },
        _count: { _all: true },
        orderBy: { _count: { neighborhood: 'desc' } },
        take: 6,
      }),
      // This city's members, plus quotes marked across-Smileys. Not every
      // quote: these used to be Istanbul's words on every city's page.
      prisma.testimonial.findMany({
        where:   { active: true, OR: [{ cityId }, { cityId: null }] },
        orderBy: [{ order: 'asc' }],
        take:    3,
      }),
      // A number is all the page renders — never fetch names for a count
      // (the shape invites the next edit to display them), and admin-hidden
      // accounts stay out of every public figure. Uncapped: 'take' was
      // silently flooring busy weeks at 6.
      prisma.user.count({
        where: { status: 'approved', role: 'member', joinedAt: { gte: sevenDaysAgo }, cityId, hiddenFromMembers: false },
      }),
      // Does this city have a guide worth linking to? Published entries only —
      // a city whose guide is still all drafts has nothing to read yet.
      prisma.guideEntry.count({ where: { cityId, status: 'published' } }),
      // Latest city-relevant community writing — same null-means-global rule
      // as /posts and the Guide's strip, so İzmir's page surfaces "Smileys is
      // coming to İzmir" without borrowing another city's stories. Over-fetch
      // so the city's OWN pieces can be ranked ahead of global ones below.
      prisma.post.findMany({
        where:   { kind: 'community', status: 'published', OR: [{ cityId }, { cityId: null }] },
        orderBy: { publishedAt: 'desc' },
        take:    6,
        select:  { id: true, slug: true, title: true, excerpt: true, coverImage: true, cityId: true },
      }),
    ])

    // The city's own voice leads: city-tagged stories first, global fill the
    // rest. sort() is stable, so each group keeps its newest-first order.
    const latestStories = rawStories
      .sort((a, b) => Number(b.cityId === cityId) - Number(a.cityId === cityId))
      .slice(0, 3)

    return { events, clubs, neighborhoodCounts, testimonials, newMembersThisWeek, guideEntries, latestStories }
  },
  ['city-page-data'],
  { revalidate: 60, tags: ['home'] },
)

// ── Per-request reads ───────────────────────────────────────────────────────

// Visitors (phase 4: the cross-city loop's read side). Per-request like the
// guest redaction in the page: members see members-only visits, guests only
// the public ones — a session-dependent set must never enter the shared
// cache. Contact and email are never selected at all, so the guest tier is
// safe by construction, not by stripping.
// This city's clock, not Istanbul's — a visit whose last day is "today" here
// must not drop out (or linger) because Istanbul already rolled over.
export async function getVisitors(city: PublicCity, signedIn: boolean) {
  const visitorsToday = todayInTz(city.timezone)
  const visitorWhere = {
    cityId: city.id, status: 'active', endsOn: { gte: visitorsToday },
    ...(signedIn ? {} : { visibility: 'public' }),
  }
  const [visitors, visitorTotal] = await Promise.all([
    prisma.visitorAnnouncement.findMany({
      where:   visitorWhere,
      orderBy: { startsOn: 'asc' },
      take:    4,
      select:  { id: true, name: true, fromCity: true, startsOn: true, endsOn: true },
    }),
    prisma.visitorAnnouncement.count({ where: visitorWhere }),
  ])
  return { visitors, visitorTotal }
}

export type Visitors = Awaited<ReturnType<typeof getVisitors>>

export interface NeighborhoodTile { name: string; slug: string; emoji: string; eventCount: number; vibe: string | null }

// Emoji and slug come from THIS city's registry, not Istanbul's constant —
// an İzmir district would otherwise render Istanbul's pin and link to a slug
// that resolves to nothing. A count for a neighborhood that's since been
// deactivated has no row to render, so it drops out.
export async function getTopNeighborhoods(cityId: string, neighborhoodCounts: CityPageData['neighborhoodCounts']) {
  const registry = await getNeighborhoodViews(cityId)
  const byEvents: NeighborhoodTile[] = neighborhoodCounts.flatMap(c => {
    const row = registry.find(n => n.name === c.neighborhood)
    return row ? [{ name: row.name, slug: row.slug, emoji: row.emoji, eventCount: c._count._all, vibe: row.vibe }] : []
  })
  // A young city has neighborhoods before it has events, and deriving this
  // section purely from event counts hid it entirely: Bodrum launched with 8
  // neighborhoods, 0 upcoming events, and therefore no way to browse them from
  // its own page. Fall back to the city's registry so the areas are still
  // discoverable — the cards drop the count rather than advertise "0 events".
  const topNeighborhoods: NeighborhoodTile[] = byEvents.length > 0
    ? byEvents
    : registry.slice(0, 6).map(n => ({ name: n.name, slug: n.slug, emoji: n.emoji, eventCount: 0, vibe: n.vibe }))
  return { topNeighborhoods, neighborhoodsHaveEvents: byEvents.length > 0 }
}

// ── Pure arrangement ────────────────────────────────────────────────────────

// Prospect-facing surface: cancelled events break trust in a showcase slot,
// and sold-out ones sink below the joinable ones.
export function arrangeEvents(events: Event[]): Event[] {
  const liveEvents = events.filter(e => e.status !== 'cancelled')
  return [
    ...liveEvents.filter(e => !isSoldOut(e)),
    ...liveEvents.filter(isSoldOut),
  ]
}

// Clubs with something scheduled first — alphabetical order would fill the
// page with dormant clubs.
export function featureClubs(clubs: CityPageData['clubs']) {
  return [
    ...clubs.filter(c => c.nextEvent).sort((a, b) => a.nextEvent!.date.localeCompare(b.nextEvent!.date)),
    ...clubs.filter(c => !c.nextEvent).sort((a, b) => b.memberCount - a.memberCount),
  ].slice(0, 4)
}

export type EnterTarget = 'events' | 'clubs' | 'directory' | 'board' | 'neighborhoods' | 'guide' | 'handbook'
export type EnterLink   = (to: EnterTarget, n?: string) => string

// Feed links route through /api/city/enter, which sets the view-city cookie
// before landing — so "See what's on" from /izmir shows İzmir's events, not
// the default city's. Plain <a> targets (route handler, not a page), hence
// the explicit /app basePath.
export function enterLinkFor(slug: string): EnterLink {
  return (to, n) => `/app/api/city/enter?city=${slug}&to=${to}${n ? `&n=${encodeURIComponent(n)}` : ''}`
}

// ── Per-city hub pages (/[city]/events, /[city]/clubs) ──────────────────────
//
// The global /events and /clubs are the members' interactive views: client
// rendered, scoped by the view-city cookie. A crawler carries no cookie, so
// it only ever saw the default city's lists. These hubs are the crawlable
// listing layer for every other live city: server-rendered, city fixed by
// the URL, one canonical each.
//
// The default city keeps its already-indexed /events and /clubs as the
// canonical URLs (rewording a URL Google ranks costs something for nothing),
// so its hubs point back there; every other city's hub is canonical to itself.

export type HubKind = 'events' | 'clubs' | 'directory' | 'board'

export function isDefaultCitySlug(slug: string): boolean {
  return slug === DEFAULT_CITY_SLUG
}

/** The canonical URL for a city's hub — absolute, for <link rel=canonical>. */
export function hubCanonical(slug: string, kind: HubKind): string {
  return isDefaultCitySlug(slug) ? `${APP_URL}/${kind}` : `${APP_URL}/${slug}/${kind}`
}

/**
 * Where a GUEST on a city page goes for its events or clubs: the crawlable
 * hub (or the global list for the default city, which is the same page in
 * canonical terms). Members keep the cookie-setting entry link, which lands
 * them in the interactive view scoped to that city. Paths carry the /app
 * basePath because they are plain <a> targets, like the entry link.
 */
export function publicLinkFor(slug: string, enter: EnterLink): EnterLink {
  return (to, n) => {
    if (to === 'events' || to === 'clubs' || to === 'directory' || to === 'board') {
      return isDefaultCitySlug(slug) ? `/app/${to}` : `/app/${slug}/${to}`
    }
    return enter(to, n)
  }
}

// A hub is a crawlable page, not the whole catalogue: the founding city has
// 140+ clubs, and rendering every card put 1.3 MB of HTML on one page. The
// first HUB_LIMIT (scheduled/soonest first) plus an honest "and N more" link
// into the interactive list covers both the crawler and the reader.
export const HUB_LIMIT = 48

/** A city's soonest upcoming events for the hub, and how many there are. */
export const getCityEventsHub = unstable_cache(
  async (cityId: string) => {
    const { events, total } = await getEvents({ limit: HUB_LIMIT, upcoming: true, cityId })
    return { events, total }
  },
  ['city-events-hub'],
  { revalidate: 60, tags: ['home'] },
)

/** A city's clubs for the hub, scheduled ones first, and how many there are. */
export const getCityClubsHub = unstable_cache(
  async (cityId: string) => {
    const all = await getClubs(cityId)
    const clubs = [
      ...all.filter(c => c.nextEvent).sort((a, b) => a.nextEvent!.date.localeCompare(b.nextEvent!.date)),
      ...all.filter(c => !c.nextEvent).sort((a, b) => b.memberCount - a.memberCount),
    ].slice(0, HUB_LIMIT)
    return { clubs, total: all.length }
  },
  ['city-clubs-hub'],
  { revalidate: 60, tags: ['home'] },
)

/** A city's top-rated places for the directory hub, and how many there are. */
export const getCityDirectoryHub = unstable_cache(
  async (cityId: string) => {
    // No callerId: the hub is the same page for everyone, so the per-viewer
    // fields (isSaved, isMine, claim status) stay at their guest defaults.
    const page = await queryDirectory({ cityId, sort: 'toprated' })
    // Only what the hub renders. The full row carries per-viewer flags and
    // the recommending member's name; the cached value is streamed to the
    // browser, so it must hold nothing the page doesn't show.
    const items = page.items.slice(0, HUB_LIMIT).map(b => ({
      id: b.id, name: b.name, category: b.category, description: b.description,
      neighborhood: b.neighborhood, coverImage: b.coverImage, logo: b.logo,
      isExpatOwned: b.isExpatOwned, isExpatFriendly: b.isExpatFriendly,
      memberDiscount: b.memberDiscount, avgRating: b.avgRating, reviewCount: b.reviewCount,
    }))
    return { items, total: page.total }
  },
  ['city-directory-hub'],
  { revalidate: 60, tags: ['home'] },
)

/**
 * A city's newest live listings for the board hub, and how many there are.
 *
 * A strict public projection, on purpose: contact, contactEmail and the
 * gallery are member-only and are never selected here, so the cached value
 * — which Next streams to the browser as part of the page — can't carry
 * them whoever is looking. Safe by construction, not by stripping (the same
 * rule the visitors query on the city page follows). What still differs
 * for a guest — poster name, description length — the page handles per
 * request, outside this cache.
 */
export const getCityBoardHub = unstable_cache(
  async (cityId: string) => {
    const where = { status: 'active', cityId }
    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where, orderBy: { createdAt: 'desc' }, take: HUB_LIMIT,
        select: {
          id: true, category: true, title: true, description: true, price: true,
          neighborhood: true, createdAt: true,
          user: { select: { name: true } },
        },
      }),
      prisma.listing.count({ where }),
    ])
    return { listings, total }
  },
  ['city-board-hub'],
  { revalidate: 60, tags: ['home'] },
)
