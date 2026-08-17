import Link from 'next/link'
import Image from 'next/image'
import { readFileSync } from 'fs'
import { join } from 'path'
import { unstable_cache } from 'next/cache'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { neighborhoodToSlug } from '@/lib/neighborhoods'
import { APP_URL } from '@/lib/env'
import { getSession } from '@/lib/session'
import { resolveCityId, getCityConfig, DEFAULT_CITY_SLUG } from '@/lib/city'
import { getNeighborhoodViews } from '@/lib/neighborhoodsDb'
import { restrictedSetFor } from '@/lib/memberPrivacy'
import SayHiButton from '@/components/SayHiButton'
import LocalFavorites, { type LocalPick } from '@/components/LocalFavorites'

// Same script-tag escaping as the neighborhood detail page's JSON-LD
// (handbook article / event detail / FAQ / neighborhood Place all match).
function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

// Fixed-size cover (1200×800) served from public/ under the /app basePath.
const NEIGHBORHOODS_OG_IMAGE = `${APP_URL}/images/neighborhoods-cover.jpg`

// Names the city the viewer is actually looking at. The default city keeps the
// hand-written, keyword-carrying description that's been indexed for months —
// listing İzmir's districts in Istanbul's snippet would be a real SEO loss —
// and every other city gets the generated form.
export async function generateMetadata() {
  const city = await getCityConfig(await resolveCityId(await getSession()))
  const isDefault = city.slug === DEFAULT_CITY_SLUG
  const title = `${isDefault ? 'Explore ' : ''}${city.name} Neighborhoods — Smileys Community`
  const desc  = isDefault
    ? 'Find Smileys events happening near you. From Kadıköy to Beşiktaş, Cihangir to Ataşehir — discover social events across Istanbul by neighborhood.'
    : `Find Smileys events happening near you — discover social events across ${city.name} by neighborhood.`
  const ogDesc = `Discover curated social events happening across ${city.name}, organised by neighborhood.`

  return {
    alternates: { canonical: `${APP_URL}/neighborhoods` },
    title,
    description: desc,
    openGraph: {
      title: `${city.name} Neighborhoods — Smileys Community`,
      description: ogDesc,
      // Include the /app basePath — the bare /neighborhoods path 301-redirects,
      // which some crawlers won't follow for the canonical.
      url: `${APP_URL}/neighborhoods`,
      siteName: 'Smileys Community',
      type: 'website',
      images: [{ url: NEIGHBORHOODS_OG_IMAGE, secureUrl: NEIGHBORHOODS_OG_IMAGE, width: 1200, height: 800, alt: `${city.name} Neighborhoods — Smileys Community` }],
    },
    twitter: {
      card: 'summary_large_image' as const,
      title: `${city.name} Neighborhoods — Smileys Community`,
      description: ogDesc,
      images: [NEIGHBORHOODS_OG_IMAGE],
    },
  }
}
import { resolveImageUrl, avatarUrl } from '@/lib/data'
import AvatarImg from '@/components/AvatarImg'
import NeighborhoodGrid, { type Group } from '@/components/NeighborhoodGrid'
import { loadContent } from '@/lib/content'

export const dynamic = 'force-dynamic'

// cityId is part of the cache key so two cities never share a stats entry;
// every count below is scoped to it, because a neighborhood name is only
// unique within its city.
const getNeighborhoodStats = unstable_cache(
  async (today: string, cityId: string) => Promise.all([
    prisma.event.groupBy({
      by: ['neighborhood'],
      where: { cityId, date: { gte: today } },
      _count: { _all: true },
    }),
    prisma.user.groupBy({
      by: ['neighborhood'],
      where: { cityId, neighborhood: { not: null }, status: 'approved' },
      _count: { _all: true },
    }),
    prisma.event.findMany({
      where: { cityId, date: { gte: today }, status: 'published' },
      select: { neighborhood: true, title: true, date: true, emoji: true },
      orderBy: { date: 'asc' },
      take: 300,
    }),
    // "Local picks" per neighborhood — approved, active directory listings.
    prisma.business.groupBy({
      by: ['neighborhood'],
      where: { cityId, neighborhood: { not: null }, isApproved: true, isActive: true },
      _count: { _all: true },
    }),
  ]),
  ['neighborhood-stats'],
  { revalidate: 300, tags: ['neighborhoods'] },
)

function fmtEventDate(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day))
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .toUpperCase()
}

function getActivitySignal(eventCount: number, memberCount: number) {
  const score = eventCount * 3 + Math.round(memberCount / 6)
  if (score >= 9) return { label: 'Hot right now',  icon: '🔥', cls: 'bg-orange-50 text-orange-500' }
  if (score >= 5) return { label: 'Active',          icon: '⚡', cls: 'bg-blue-50 text-blue-500'    }
  if (score >= 2) return { label: 'Growing',         icon: '🌱', cls: 'bg-green-50 text-green-600'  }
  return               { label: 'Quiet this month', icon: '😴', cls: 'bg-gray-50 text-gray-400'    }
}

export default async function NeighborhoodsPage() {
  const c = loadContent()
  const nh = c.neighborhoods ?? {}
  const today = new Date().toISOString().split('T')[0]

  // The stats are city-scoped now, so the city has to resolve first — the
  // session and the city id are both cheap (JWT decode + module-memory cache).
  const session = await getSession()
  const cityId  = await resolveCityId(session)
  const city    = await getCityConfig(cityId)

  const [eventCounts, memberCounts, nextEventsRaw, pickCounts] = await getNeighborhoodStats(today, cityId)

  // First upcoming event per neighborhood
  const nextEventMap: Record<string, { title: string; date: string; emoji: string }> = {}
  for (const e of nextEventsRaw) {
    if (e.neighborhood && !nextEventMap[e.neighborhood]) {
      nextEventMap[e.neighborhood] = { title: e.title, date: e.date, emoji: e.emoji }
    }
  }

  const userNeighborhood = session?.neighborhood ?? null

  let adBanner: { active: boolean; type: string; headline: string; subtitle: string; emoji: string; link: string; cta: string } | null = null
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'banners.json'), 'utf-8'))
    const b = raw?.neighborhoods
    if (b?.active && b?.headline) adBanner = b
  } catch { /* no banner */ }

  // The list comes from the viewer's city, not the hard-coded Istanbul constant.
  // A member in Izmir was being shown Kadıköy, Moda and Cihangir under a nav
  // heading that said "In Izmir". getNeighborhoodViews applies the editorial
  // layer (emoji, vibe, cost) only for the default city — see its comment on
  // why a second city must never inherit it by name.
  const cityViews = await getNeighborhoodViews(cityId)
  // "Is this a real neighborhood?" now means "of THIS city" — it used to mean
  // "in Istanbul's constant", which is why an İzmir member's own neighborhood
  // failed the check and their banner never rendered.
  const viewByName = new Map(cityViews.map(v => [v.name, v]))
  const neighborhoods = cityViews.map(view => {
    const name = view.name
    const meta = { emoji: view.emoji, vibe: view.vibe, side: view.area, cost: view.cost, lat: view.lat, lon: view.lon }
    const eventCount  = eventCounts.find(e => e.neighborhood === name)?._count._all  ?? 0
    const memberCount = memberCounts.find(m => m.neighborhood === name)?._count._all ?? 0
    const pickCount   = pickCounts.find(p => p.neighborhood === name)?._count._all   ?? 0
    const activityScore = eventCount * 3 + Math.round(memberCount / 6)
    return {
      name,
      slug: view.slug,
      meta,
      eventCount,
      memberCount,
      pickCount,
      activityScore,
      isYours:   name === userNeighborhood,
      signal:    getActivitySignal(eventCount, memberCount),
      nextEvent: nextEventMap[name] ?? null,
    }
  })

  const sortGroup = (items: typeof neighborhoods) =>
    [...items].sort((a, b) => {
      if (a.isYours && !b.isYours) return -1
      if (b.isYours && !a.isYours) return 1
      const scoreA = a.eventCount * 3 + Math.round(a.memberCount / 6)
      const scoreB = b.eventCount * 3 + Math.round(b.memberCount / 6)
      return scoreB - scoreA
    })

  // Istanbul's six areas have curated labels, icons and colours, and this is
  // the order they read in. Any OTHER area a city defines still gets a section
  // — named after itself, in a neutral palette, after the curated ones. That
  // fallback is the whole point: these six used to be the only sections, so a
  // city grouping by "Konak" or "Alsancak" rendered a completely empty page.
  const CURATED: { side: string; label: string; icon: string; color: string }[] = [
    { side: 'Central',  label: 'Central Hubs',  icon: '🌟',  color: 'bg-amber-100 text-amber-700'  },
    { side: 'European', label: 'European Side', icon: '🇹🇷', color: 'bg-blue-100 text-blue-700'    },
    { side: 'Asian',    label: 'Asian Side',    icon: '🌏',  color: 'bg-green-100 text-green-700'  },
    { side: 'Coastal',  label: 'Coastal',       icon: '🌊',  color: 'bg-sky-100 text-sky-700'      },
    { side: 'Islands',  label: 'Islands',       icon: '🏝️', color: 'bg-purple-100 text-purple-700' },
    { side: 'Emerging', label: 'Emerging',      icon: '🚀',  color: 'bg-slate-100 text-slate-700'  },
  ]
  const curatedSides = new Set(CURATED.map(c => c.side))

  // "Cross the Bosphorus" (§9) is Istanbul's geography, not a universal one.
  // The two cards already dropped out for a city with no Asian/European areas,
  // but the heading above them didn't — so Bodrum, whose areas are neither,
  // got an Istanbul headline over an empty grid. Build the cards up here and
  // let the section render only when the city actually has that split.
  const sideCards = ([
    { side: 'Asian',    label: 'Explore the Asian Side',    gradient: 'from-emerald-500 to-teal-600', emoji: '🌏', photo: '/app/images/side-asian.jpg' },
    { side: 'European', label: 'Explore the European Side', gradient: 'from-blue-500 to-indigo-600',  emoji: '🇹🇷', photo: '/app/images/side-european.jpg' },
  ])
    .map(card => ({
      ...card,
      names: neighborhoods
        .filter(n => n.meta.side === card.side)
        .sort((a, b) => b.memberCount - a.memberCount)
        .slice(0, 5)
        .map(n => n.name),
    }))
    .filter(card => card.names.length > 0)

  // Areas this city uses that aren't curated, in first-seen (sortOrder) order.
  // '' means the city hasn't grouped its neighborhoods at all — those land in
  // one unlabelled section rather than a section headed "".
  const extraSides = [...new Set(neighborhoods.map(n => n.meta.side).filter(s => s && !curatedSides.has(s)))]
  const ungrouped  = neighborhoods.filter(n => !n.meta.side)

  const groups: Group[] = [
    ...CURATED.map(c => ({ ...c, items: sortGroup(neighborhoods.filter(n => n.meta.side === c.side)) })),
    ...extraSides.map(side => ({
      label: side, side, icon: '📍', color: 'bg-gray-100 text-gray-700',
      items: sortGroup(neighborhoods.filter(n => n.meta.side === side)),
    })),
    ...(ungrouped.length > 0
      ? [{ label: `In ${city.name}`, side: '', icon: '🏘️', color: 'bg-gray-100 text-gray-700', items: sortGroup(ungrouped) }]
      : []),
  ].filter(g => g.items.length > 0)

  let yourNeighborhoodMembers: { id: string; name: string; color: string; profilePhoto: string | null }[] = []
  if (userNeighborhood) {
    yourNeighborhoodMembers = await prisma.user.findMany({
      where:   { neighborhood: userNeighborhood, cityId, status: 'approved' },
      select:  { id: true, name: true, color: true, profilePhoto: true },
      take:    5,
      orderBy: { joinedAt: 'desc' },
    })
  }

  // "Near you" needs somewhere to point. With no neighborhood set — every
  // logged-out visitor, and members who haven't picked one — these sections
  // would otherwise be blank, so they fall back to the busiest neighborhood
  // and say so in the heading rather than implying it's the viewer's own.
  const busiest = [...memberCounts]
    .filter(m => m.neighborhood && viewByName.has(m.neighborhood))
    .sort((a, b) => b._count._all - a._count._all)[0]?.neighborhood ?? null
  const focusNeighborhood = userNeighborhood ?? busiest
  const focusIsYours      = !!userNeighborhood

  let nearbyEvents: {
    id: string; title: string; emoji: string; date: string; location: string
    _count: { attendees: number }
  }[] = []
  let peopleNearby: {
    id: string; name: string; color: string; profilePhoto: string | null
    nationality: string | null; interests: string[]
  }[] = []

  if (focusNeighborhood) {
    nearbyEvents = await prisma.event.findMany({
      where:   { status: 'published', cityId, date: { gte: today }, neighborhood: focusNeighborhood },
      select:  {
        id: true, title: true, emoji: true, date: true, location: true,
        _count: { select: { attendees: { where: { status: 'approved' } } } },
      },
      orderBy: { date: 'asc' },
      take:    4,
    })

    // neighborhoodVisible is the member's own opt-out for exactly this
    // section. profileVisibility is then applied on top: a 'connections'
    // member is hidden from guests outright, and from signed-in viewers
    // unless they're actually connected (restrictedSetFor).
    const candidates = await prisma.user.findMany({
      where: {
        neighborhood: focusNeighborhood,
        cityId,
        status: 'approved',
        neighborhoodVisible: true,
        ...(session ? { id: { not: session.id } } : { profileVisibility: { not: 'connections' } }),
      },
      select: {
        id: true, name: true, color: true, profilePhoto: true,
        nationality: true, interests: true, profileVisibility: true,
      },
      orderBy: { goodHangouts: 'desc' },
      take:    12,
    })
    const restricted = session ? await restrictedSetFor(session, candidates) : new Set<string>()
    peopleNearby = candidates.filter(m => !restricted.has(m.id)).slice(0, 8)
  }

  // §13 — visitors heading for the focus neighborhood. Renders only when
  // there are real ones; an empty "coming to your neighborhood" block is
  // worse than no block. Contact details are never selected here.
  const visitorsNearby = focusNeighborhood
    ? await prisma.visitorAnnouncement.findMany({
        where:  {
          status: 'active',
          cityId,
          neighborhood: focusNeighborhood,
          endsOn: { gte: today },
          ...(session ? {} : { visibility: 'public' }),
        },
        select: {
          id: true, name: true, fromCity: true, startsOn: true,
          user: { select: { id: true, name: true, color: true, profilePhoto: true } },
        },
        orderBy: { startsOn: 'asc' },
        take: 4,
      })
    : []

  // §8 — local picks. Every approved+active listing has a cover image, but
  // only a handful have review text, so the member quote is opportunistic
  // rather than assumed.
  const localPicks = await prisma.business.findMany({
    // cityId, or an İzmir member browsing their own neighborhoods page is
    // recommended cafés in Kadıköy.
    where:  { isApproved: true, isActive: true, cityId, coverImage: { not: null } },
    select: {
      id: true, name: true, category: true, neighborhood: true, coverImage: true,
      reviews: {
        where:  { comment: { not: null } },
        select: { comment: true, author: { select: { name: true } } },
        take:   1,
        orderBy: { createdAt: 'desc' },
      },
      _count: { select: { reviews: true } },
    },
    // Ordered by recommendation count: "Recommended by 18 Smileys" carries
    // community consensus, "by 1 Smiley" doesn't, and unordered results let
    // the weakest signal lead the section.
    orderBy: { reviews: { _count: 'desc' } },
    take: 24,
  })

  const serialisedPicks: LocalPick[] = localPicks.map(b => ({
    id:           b.id,
    name:         b.name,
    category:     b.category,
    neighborhood: b.neighborhood,
    coverImage:   b.coverImage,
    reviewCount:  b._count.reviews,
    quote:        b.reviews[0]?.comment ?? null,
    quoteBy:      b.reviews[0]?.author?.name ?? null,
  }))

  // Read the per-request CSP nonce set by middleware so the JSON-LD <script>
  // isn't blocked under 'strict-dynamic' (same pattern as the neighborhood
  // detail page / handbook article / event detail / FAQ JSON-LD).
  const nonce = (await headers()).get('x-nonce') ?? undefined

  // ItemList of Place — deterministic, non-personalized (built from the
  // static NEIGHBORHOOD_META set, not the viewer's session), so it's safe to
  // mirror in structured data regardless of who/what is crawling. Mirrors
  // the neighborhood cards actually rendered on the page.
  const neighborhoodsJsonLd = {
    '@context': 'https://schema.org',
    '@type':    'ItemList',
    itemListElement: neighborhoods.map((n, i) => ({
      '@type':  'ListItem',
      position: i + 1,
      item: {
        '@type': 'Place',
        name:    `${n.name}, ${city.name}`,
        url:     `${APP_URL}/neighborhoods/${n.slug}`,
        containedInPlace: {
          '@type': 'City',
          name:    city.name,
          containedInPlace: { '@type': 'Country', name: 'Turkey' },
        },
      },
    })),
  }

  return (
    <main>
      <script type="application/ld+json" nonce={nonce}
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(neighborhoodsJsonLd) }} />
      {/* Hero — full-bleed photo with the copy overlaid. Same gradient
          reasoning as /visiting: the image is a bright sunset waterfront, so
          without the overlay the headline sits on blown-out sky and drops
          below AA. Content overrides (nh.*) are preserved so the copy stays
          editable without a deploy. */}
      <section className="relative h-[450px] sm:h-[500px] lg:h-[550px] w-full overflow-hidden">
        {/* The city's own photo where it has one. This was hardcoded to
            Istanbul's Galata waterfront, so Bodrum's neighborhoods page opened
            on another city's skyline — and the alt text described it. Cities
            without a hero keep the shared shot rather than a grey box, matching
            CityHeroImage on /[city]. */}
        <Image
          src={city.heroImage ? resolveImageUrl(city.heroImage) : '/app/images/neighborhoods-hero.jpg'}
          alt={city.heroImage
            ? `${city.name} at sunset`
            : 'People walking along an Istanbul waterfront promenade at sunset, café awnings on one side and the Galata skyline across the water'}
          fill
          priority
          fetchPriority="high"
          sizes="100vw"
          className="object-cover object-center"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/30" />
        <div className="absolute inset-0 flex items-center">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
            <div className="max-w-2xl">
              <p className="text-xs font-bold tracking-[0.2em] uppercase text-amber-300 mb-4">
                {nh.badge ?? `${city.name} Neighborhoods`}
              </p>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.1]">
                {nh.headline ?? `Find your ${city.name}.`}
              </h1>
              <p className="text-base sm:text-lg text-white/90 mt-5 leading-relaxed max-w-xl">
                {nh.subtitle ?? 'Discover the people, events and local favorites around where you live, work or hang out.'}
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                {/* Where this points depends on what the viewer can actually
                    do next: jump to their own neighborhood, go set one, or
                    join first. A single fixed target would be a dead end for
                    two of the three. */}
                <Link href={userNeighborhood ? '#your-neighborhood' : session ? '/settings' : '/apply'}
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-amber-500 hover:bg-amber-600 text-white text-base font-bold rounded-xl transition-colors shadow-lg">
                  <span aria-hidden="true">📍</span> Find My Neighborhood
                </Link>
                <a href="#explore"
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 border border-white/50 hover:bg-white/10 text-white text-base font-semibold rounded-xl transition-colors backdrop-blur-sm">
                  Explore Neighborhoods
                </a>
              </div>
              <p className="text-xs sm:text-sm text-white/70 mt-5">
                Local people <span aria-hidden="true">•</span> Local plans <span aria-hidden="true">•</span> Your part of the city
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Your neighborhood banner */}
      {userNeighborhood && viewByName.has(userNeighborhood) && (
        <div id="your-neighborhood" className="scroll-mt-20 bg-amber-50 border-b border-amber-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="text-2xl">{viewByName.get(userNeighborhood)!.emoji}</span>
              <div>
                <div className="text-xs font-bold text-amber-600 uppercase tracking-wide">Your neighborhood</div>
                <div className="font-bold text-gray-900">{userNeighborhood}</div>
              </div>
              {yourNeighborhoodMembers.length > 0 && (
                <div className="flex items-center gap-2 ml-2">
                  <div className="flex -space-x-1.5">
                    {yourNeighborhoodMembers.slice(0, 4).map(m => (
                      <AvatarImg key={m.id} src={avatarUrl(m.profilePhoto, 64)} name={m.name} color={m.color}
                        size="w-7 h-7" textSize="text-[9px]" className="border-2 border-white" />
                    ))}
                  </div>
                  <span className="text-xs text-gray-600">
                    {memberCounts.find(m => m.neighborhood === userNeighborhood)?._count._all ?? 0} locals
                  </span>
                </div>
              )}
            </div>
            <Link href={`/neighborhoods/${neighborhoodToSlug(userNeighborhood)}`}
              className="px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors shrink-0">
              See your area →
            </Link>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-16">
        {adBanner && (
          <div className={`mb-6 ${adBanner.link ? '' : ''}`}>
            {adBanner.link ? (
              <a href={adBanner.link} target="_blank" rel="noopener noreferrer" className="block group">
                {adBanner.type === 'strip' ? (
                  <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                    <span aria-hidden="true" className="text-lg shrink-0">{adBanner.emoji}</span>
                    <p className="flex-1 text-sm font-semibold text-amber-900 truncate">{adBanner.headline}</p>
                    {adBanner.cta && <span className="text-xs font-bold text-amber-600 shrink-0">{adBanner.cta} →</span>}
                  </div>
                ) : adBanner.type === 'promo' ? (
                  <div className="flex items-center gap-3 bg-gradient-to-r from-amber-500 to-orange-400 rounded-2xl px-4 py-3 relative overflow-hidden">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-amber-100 uppercase tracking-widest mb-0.5">From Smileys</p>
                      <p className="text-sm font-bold text-white truncate">{adBanner.headline}</p>
                      {adBanner.subtitle && <p className="text-xs text-amber-100 truncate">{adBanner.subtitle}</p>}
                    </div>
                    <div aria-hidden="true" className="shrink-0 w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-2xl">{adBanner.emoji}</div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 bg-gradient-to-r from-gray-900 to-gray-700 rounded-2xl px-4 py-3 overflow-hidden relative group">
                    <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_80%_50%,#f59e0b_0%,transparent_60%)]" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-0.5">Sponsored</p>
                      <p className="text-sm font-bold text-white truncate group-hover:text-amber-300 transition-colors">{adBanner.headline}</p>
                      {adBanner.subtitle && <p className="text-xs text-gray-400 truncate">{adBanner.subtitle}</p>}
                    </div>
                    <div aria-hidden="true" className="shrink-0 w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-2xl">{adBanner.emoji}</div>
                  </div>
                )}
              </a>
            ) : adBanner.type === 'strip' ? (
              <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                <span aria-hidden="true" className="text-lg shrink-0">{adBanner.emoji}</span>
                <p className="flex-1 text-sm font-semibold text-amber-900 truncate">{adBanner.headline}</p>
                {adBanner.cta && <span className="text-xs font-bold text-amber-600 shrink-0">{adBanner.cta} →</span>}
              </div>
            ) : adBanner.type === 'promo' ? (
              <div className="flex items-center gap-3 bg-gradient-to-r from-amber-500 to-orange-400 rounded-2xl px-4 py-3 relative overflow-hidden">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-amber-100 uppercase tracking-widest mb-0.5">From Smileys</p>
                  <p className="text-sm font-bold text-white truncate">{adBanner.headline}</p>
                  {adBanner.subtitle && <p className="text-xs text-amber-100 truncate">{adBanner.subtitle}</p>}
                </div>
                <div aria-hidden="true" className="shrink-0 w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-2xl">{adBanner.emoji}</div>
              </div>
            ) : (
              <div className="flex items-center gap-3 bg-gradient-to-r from-gray-900 to-gray-700 rounded-2xl px-4 py-3 overflow-hidden relative">
                <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_80%_50%,#f59e0b_0%,transparent_60%)]" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-0.5">Sponsored</p>
                  <p className="text-sm font-bold text-white truncate">{adBanner.headline}</p>
                  {adBanner.subtitle && <p className="text-xs text-gray-400 truncate">{adBanner.subtitle}</p>}
                </div>
                <div aria-hidden="true" className="shrink-0 w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-2xl">{adBanner.emoji}</div>
              </div>
            )}
          </div>
        )}
        {/* ── Where's your Istanbul? ──
            Signed-in members with no neighborhood set see the fallback
            sections below labelled with Kadıköy's name — which reads as
            "this page isn't about me". This prompt names the fix. Guests
            don't get it: their path is /apply, already all over the page. */}
        {session && !userNeighborhood && (
          <section className="mb-10 bg-amber-50 border border-amber-100 rounded-2xl p-6 sm:p-8">
            <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-gray-900">
              Where&apos;s your {city.name}?
            </h2>
            <p className="text-gray-700 mt-1.5 mb-5 max-w-xl">
              Choose the neighborhood where you live or spend most of your time, and this
              page starts showing your people, your events, and your part of the city.
            </p>
            <Link href="/profile"
              className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
              <span aria-hidden="true">📍</span> Choose my neighborhood
            </Link>
          </section>
        )}

        {/* ── Happening near you ── */}
        {focusNeighborhood && (
          <section className="mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">
              {focusIsYours ? 'Happening near you' : `Happening in ${focusNeighborhood}`}
            </h2>
            <p className="text-gray-600 mt-1.5 mb-6">
              {focusIsYours
                ? `Events and plans around your side of ${city.name}.`
                : `${city.name}'s most active Smileys neighborhood right now.`}
            </p>
            {nearbyEvents.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {nearbyEvents.map(e => (
                  <Link key={e.id} href={`/events/${e.id}`}
                    className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-amber-200 transition-all group">
                    <p className="text-xs font-bold tracking-wide text-amber-600">{fmtEventDate(e.date)}</p>
                    <h3 className="font-bold text-gray-900 mt-1.5 leading-snug">
                      <span aria-hidden="true">{e.emoji} </span>{e.title}
                    </h3>
                    <p className="text-xs text-gray-500 mt-2"><span aria-hidden="true">📍 </span>{e.location}</p>
                    <p className="text-xs text-gray-500 mt-0.5"><span aria-hidden="true">👥 </span>{e._count.attendees} going</p>
                    <span className="inline-block text-xs font-bold text-gray-700 mt-3 group-hover:text-amber-600 transition-colors">
                      View event →
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6">
                <p className="font-bold text-gray-900">Nothing happening nearby yet?</p>
                <p className="text-sm text-gray-600 mt-1 mb-4">
                  Neighborhoods come alive when someone starts something.
                </p>
                <Link href={`/hangouts?new=1${focusNeighborhood ? `&neighborhood=${encodeURIComponent(focusNeighborhood)}` : ''}`}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
                  Create a meetup →
                </Link>
              </div>
            )}
          </section>
        )}

        {/* ── People around you ──
            Neighborhood only — never a distance, never coordinates. The
            member's own neighborhoodVisible opt-out plus profileVisibility
            are both applied in the query above. */}
        {peopleNearby.length > 0 && (
          <section className="mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">
              {focusIsYours ? 'People around you' : `People in ${focusNeighborhood}`}
            </h2>
            <p className="text-gray-600 mt-1.5 mb-6">
              Meet Smileys members who call {focusIsYours ? `your part of ${city.name}` : focusNeighborhood} home.
            </p>
            {/* Horizontal scroll on mobile per the brief; a plain grid once
                there's room for it. */}
            <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-2 lg:grid-cols-4 sm:overflow-visible scrollbar-hide">
              {peopleNearby.map(m => (
                <div key={m.id}
                  className="shrink-0 w-64 sm:w-auto bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                  <Link href={`/members/${m.id}`} className="block">
                    {/* AvatarImg handles the initials fallback itself, including
                        a photo that 403s behind the applications gate. */}
                    <AvatarImg src={avatarUrl(m.profilePhoto, 128)} name={m.name} color={m.color}
                      size="w-16 h-16" textSize="text-xl" className="mb-3" />
                    <p className="font-bold text-gray-900 leading-snug hover:text-amber-600 transition-colors">{m.name}</p>
                  </Link>
                  <p className="text-xs text-gray-500 mt-1">
                    <span aria-hidden="true">📍 </span>{focusNeighborhood}
                    {m.nationality && <span> · {m.nationality}</span>}
                  </p>
                  {m.interests.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {m.interests.slice(0, 3).map(i => (
                        <span key={i} className="text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-full">
                          {i}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-4">
                    {session && <SayHiButton targetId={m.id} targetName={m.name} />}
                    <Link href={`/members/${m.id}`}
                      className="text-xs font-semibold text-gray-500 hover:text-amber-600 transition-colors whitespace-nowrap">
                      View profile →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
            <Link href={`/neighborhoods/${neighborhoodToSlug(focusNeighborhood!)}`}
              className="inline-block mt-6 text-sm font-bold text-amber-600 hover:underline">
              See everyone in {focusNeighborhood} →
            </Link>
          </section>
        )}

        <section id="explore" className="scroll-mt-20">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">Explore {city.name}</h2>
          <p className="text-gray-600 mt-1.5 mb-6">Every neighborhood has its own rhythm. Find yours.</p>
          <NeighborhoodGrid groups={groups} userNeighborhood={userNeighborhood} />
        </section>

        {/* ── Local favorites (§8) ── */}
        <LocalFavorites picks={serialisedPicks} />

        {/* ── Coming to your neighborhood (§13) ──
            Rendered only when real visitors exist; an empty "coming to your
            neighborhood" block reads worse than no block at all. */}
        {visitorsNearby.length > 0 && (
          <section className="mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">
              Coming to {focusIsYours ? 'your neighborhood' : focusNeighborhood}
            </h2>
            <p className="text-gray-600 mt-1.5 mb-6">
              {visitorsNearby.length} Smiley{visitorsNearby.length !== 1 ? 's are' : ' is'} visiting {focusNeighborhood} soon.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {visitorsNearby.map(v => (
                <div key={v.id} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                  <AvatarImg src={avatarUrl(v.user?.profilePhoto ?? null, 128)} name={v.name}
                    color={v.user?.color ?? '#f59e0b'} size="w-12 h-12" textSize="text-base" className="mb-3" />
                  <p className="font-bold text-gray-900">{v.name}</p>
                  {v.fromCity && <p className="text-xs text-gray-500 mt-0.5">{v.fromCity}</p>}
                  <p className="text-xs font-semibold text-amber-700 mt-1">Arriving {fmtEventDate(v.startsOn)}</p>
                  {session && v.user && (
                    <div className="mt-3">
                      <SayHiButton targetId={v.user.id} targetName={v.user.name} />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <Link href="/visiting" className="inline-block mt-6 text-sm font-bold text-amber-600 hover:underline">
              See who&apos;s visiting →
            </Link>
          </section>
        )}

        {/* ── Cross the Bosphorus (§9) — Istanbul only; see sideCards ── */}
        {sideCards.length > 0 && (
          <section className="mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">Cross the Bosphorus.</h2>
            <p className="text-gray-600 mt-1.5 mb-6">Your next favorite neighborhood might be on the other side.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Photo backgrounds land per side as the shots arrive; a side
                  without one keeps its gradient rather than an empty slot. */}
              {sideCards.map(s2 => (
                // ?side= pre-selects the matching filter in the grid — a bare
                // #explore scrolled to the directory but left it unfiltered,
                // which made the card a broken promise.
                <a key={s2.side} href={`?side=${s2.side}#explore`}
                  className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${s2.gradient} p-6 min-h-[160px] flex flex-col justify-between shadow-md hover:shadow-xl transition-all`}>
                  {s2.photo && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s2.photo} alt="" aria-hidden="true" loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/40 to-black/20" />
                    </>
                  )}
                  <div aria-hidden="true" className="absolute right-4 bottom-2 text-7xl opacity-20 select-none leading-none">{s2.emoji}</div>
                  <p className="relative text-lg font-extrabold text-white">{s2.label} →</p>
                  <p className="relative text-xs text-white/80 mt-3 leading-relaxed">{s2.names.join(' · ')}</p>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* ── Final CTA (§14) ── */}
        <section className="rounded-2xl bg-gray-900 px-6 py-14 sm:py-16 text-center mb-4">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-white leading-tight">
            {city.name} is huge.<br />Your community doesn&apos;t have to be.
          </h2>
          <p className="text-gray-300 mt-4 max-w-xl mx-auto leading-relaxed">
            Choose your neighborhood and discover who&apos;s around you.
          </p>
          <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href={session ? '/settings' : '/apply'}
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-amber-500 hover:bg-amber-600 text-white text-base font-bold rounded-xl transition-colors">
              <span aria-hidden="true">📍</span> {session ? 'Set my neighborhood' : 'Join Smileys'}
            </Link>
            <a href="#explore"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 border border-white/40 hover:bg-white/10 text-white text-base font-semibold rounded-xl transition-colors">
              Explore {city.name}
            </a>
          </div>
        </section>
      </div>
    </main>
  )
}
