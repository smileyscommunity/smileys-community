import Link from 'next/link'
import { guestView, visitorName } from '@/lib/visitorPolicy'
import { jsonLdHtml } from '@/lib/jsonLd'
import Image from 'next/image'
import { readFileSync } from 'fs'
import { join } from 'path'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { ACTIVATED_MEMBER_WHERE } from '@/lib/memberCount'
import { neighborhoodToSlug } from '@/lib/neighborhoods'
import { APP_URL } from '@/lib/env'
import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { resolveCityId, getCityConfig, DEFAULT_CITY_SLUG } from '@/lib/city'
import { resolveCityForPage, type CitySearch } from '@/lib/cityPageParam'
import { shareCover } from '@/lib/shareCover'
import { getNeighborhoodViews } from '@/lib/neighborhoodsDb'
import { restrictedSetFor, blockedIdsFor } from '@/lib/memberPrivacy'
import SayHiButton from '@/components/SayHiButton'
import LocalFavorites, { type LocalPick } from '@/components/LocalFavorites'
import ExploreMore from '@/components/ExploreMore'

// Same script-tag escaping as the neighborhood detail page's JSON-LD
// (handbook article / event detail / FAQ / neighborhood Place all match).

// Names the city the viewer is actually looking at. The default city keeps the
// hand-written, keyword-carrying description that's been indexed for months —
// listing İzmir's districts in Istanbul's snippet would be a real SEO loss —
// and every other city gets the generated form.
export async function generateMetadata({ searchParams }: { searchParams?: Promise<CitySearch> }) {
  const { city } = await resolveCityForPage(searchParams)
  const isDefault = city.slug === DEFAULT_CITY_SLUG
  const canonicalUrl = isDefault
    ? `${APP_URL}/neighborhoods`
    : `${APP_URL}/neighborhoods?city=${city.slug}`
  const title = `${isDefault ? 'Explore ' : ''}${city.name} Neighborhoods — Smileys Community`
  const desc  = isDefault
    ? 'Find Smileys events happening near you. From Kadıköy to Beşiktaş, Cihangir to Ataşehir — discover social events across Istanbul by neighborhood.'
    : `Find Smileys events happening near you — discover social events across ${city.name} by neighborhood.`
  const ogDesc = `Discover curated social events happening across ${city.name}, organised by neighborhood.`
  // Share Bodrum's page and the preview once showed Istanbul: the cover was
  // an Istanbul collage hardcoded for every city. Now the shared rule
  // (lib/shareCover): the city's own cover file — the collage is Istanbul's —
  // else its hero photo, else the brand card.
  const ogImage = shareCover('neighborhoods', city, `${city.name} Neighborhoods — Smileys Community`)

  return {
    // Each city's variant is its own canonical; a shared bare URL would
    // otherwise point every city's page at Istanbul's.
    alternates: { canonical: canonicalUrl },
    title,
    description: desc,
    openGraph: {
      title: `${city.name} Neighborhoods — Smileys Community`,
      description: ogDesc,
      // Include the /app basePath — the bare /neighborhoods path 301-redirects,
      // which some crawlers won't follow for the canonical.
      url: canonicalUrl,
      siteName: 'Smileys Community',
      type: 'website',
      images: [ogImage],
    },
    twitter: {
      card: ogImage.twitterCard,
      title: `${city.name} Neighborhoods — Smileys Community`,
      description: ogDesc,
      images: [ogImage.url],
    },
  }
}
import { resolveImageUrl, avatarUrl, firstNameOf } from '@/lib/data'
import AvatarImg from '@/components/AvatarImg'
import NeighborhoodGrid, { type Group } from '@/components/NeighborhoodGrid'
import { loadContent } from '@/lib/content'
import { countryName } from '@/lib/country'

export const dynamic = 'force-dynamic'

// cityId is part of the cache key so two cities never share a stats entry;
// every count below is scoped to it, because a neighborhood name is only
// unique within its city.
const getNeighborhoodStats = unstable_cache(
  async (today: string, cityId: string) => Promise.all([
    prisma.event.groupBy({
      by: ['neighborhood'],
      // "N upcoming" — published only, like the next-event lookup below;
      // drafts, pending and cancelled events aren't upcoming.
      where: { cityId, date: { gte: today }, status: 'published' },
      _count: { _all: true },
    }),
    // "N locals" — activated members only (lib/memberCount), minus the two
    // opt-outs every other count of the same people already applies (see
    // NeighborhoodSections and HeroStats). A card that said "3 locals" over a
    // neighborhood page reading "Local members (1)" wasn't just inconsistent:
    // in a thin neighbourhood the delta is a disclosure that somebody hidden
    // lives there.
    prisma.user.groupBy({
      by: ['neighborhood'],
      where: {
        ...ACTIVATED_MEMBER_WHERE, cityId, neighborhood: { not: null },
        neighborhoodVisible: true, hiddenFromMembers: false,
      },
      _count: { _all: true },
    }),
    // The next event per neighborhood — one row each, decided by Postgres.
    //
    // This used to read the earliest 300 upcoming events and keep the first
    // one seen per name, which is the right answer only while the city has
    // fewer than 300 on the calendar: past that, a quiet neighborhood's event
    // three weeks out falls off the end and its card silently loses the one
    // thing that would fill it. Prisma's own `distinct` is no fix — it is
    // applied in the client, not pushed into SQL, so dropping the cap would
    // have pulled every upcoming row into Node to throw nearly all of them
    // away. DISTINCT ON does it in the database and returns one row per
    // neighborhood, however long the calendar gets.
    //
    // Raw SQL: camelCase columns are double-quoted, and `date` is text
    // ('YYYY-MM-DD'), so `>=` is a string comparison.
    prisma.$queryRaw<{ neighborhood: string; title: string; date: string; emoji: string }[]>`
      SELECT DISTINCT ON ("neighborhood") "neighborhood", "title", "date", "emoji"
      FROM "events"
      WHERE "cityId" = ${cityId} AND "date" >= ${today} AND "status" = 'published'
      ORDER BY "neighborhood", "date" ASC
    `,
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

// "Hot right now" and "Active" are claims about things happening, so they now
// need something on the calendar to say them. Headcount alone crossed both
// thresholds: four neighbourhoods with zero upcoming events were advertising
// themselves as hot off 54 members apiece, which is exactly the vanity-metric
// promise this community doesn't make. A populated neighbourhood with nothing
// booked is "Growing". The bottom label used to say "this month" while the
// count behind it is every future event — it says what it measures now.
function getActivitySignal(eventCount: number, memberCount: number) {
  const score = eventCount * 3 + Math.round(memberCount / 6)
  if (eventCount > 0 && score >= 9) return { label: 'Hot right now', icon: '🔥', cls: 'bg-orange-50 text-orange-500' }
  if (eventCount > 0 && score >= 5) return { label: 'Active',        icon: '⚡', cls: 'bg-blue-50 text-blue-500'    }
  if (score >= 2)                   return { label: 'Growing',       icon: '🌱', cls: 'bg-green-50 text-green-600'  }
  return                                   { label: 'Nothing on yet', icon: '😴', cls: 'bg-gray-50 text-gray-400'   }
}

export default async function NeighborhoodsPage({ searchParams }: { searchParams?: Promise<CitySearch> }) {
  const c = loadContent()
  const nh = c.neighborhoods ?? {}
  const today = new Date().toISOString().split('T')[0]

  // The stats are city-scoped now, so the city has to resolve first — the
  // session and the city id are both cheap (JWT decode + module-memory cache).
  const session = await getSession()
  const { city, cityId, pinned } = await resolveCityForPage(searchParams)
  // Put the city in the URL for anyone not on the default city, so the address
  // bar they copy is a link that survives being shared. Guarded on `pinned` so
  // this can't loop, and skipped for the default city to leave its established
  // bare URL (and its search ranking) alone.
  if (!pinned && city.slug !== DEFAULT_CITY_SLUG) redirect(`/neighborhoods?city=${city.slug}`)

  const [eventCounts, memberCounts, nextEventsRaw, pickCounts] = await getNeighborhoodStats(today, cityId)

  // First upcoming event per neighborhood
  const nextEventMap: Record<string, { title: string; date: string; emoji: string }> = {}
  for (const e of nextEventsRaw) {
    if (e.neighborhood && !nextEventMap[e.neighborhood]) {
      nextEventMap[e.neighborhood] = { title: e.title, date: e.date, emoji: e.emoji }
    }
  }

  // Only "yours" when this is your own city's page. A member whose home city
  // is Istanbul, browsing Ankara with ?city=ankara, was shown Ankara's Ulus
  // as "your neighborhood" — with Ankara residents presented as their
  // neighbours — because the match was on the name alone, and the four shared
  // names are exactly where it bites.
  const userNeighborhood = session?.cityId === cityId ? session?.neighborhood ?? null : null

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

  // Everyone this viewer has a block with, either direction — read once and
  // reused by every section below that names a member.
  const blockedIds = session ? [...await blockedIdsFor(session.id)] : []

  let yourNeighborhoodMembers: { id: string; name: string; color: string; profilePhoto: string | null }[] = []
  if (session && userNeighborhood) {
    yourNeighborhoodMembers = await prisma.user.findMany({
      // Only ever rendered to a signed-in member with a neighborhood set, so
      // these are full names by design — but the member's own opt-out still
      // has to hold. This query had none of it: a member who switched
      // neighborhoodVisible off, an admin-hidden account and a blocked pair
      // all turned up in the strip (and in the avatar alt text with them).
      // Same rules as NeighborhoodSections' local strip and HeroStats' count.
      where:   {
        neighborhood: userNeighborhood, cityId, status: 'approved',
        neighborhoodVisible: true, hiddenFromMembers: false,
        id: { notIn: [session.id, ...blockedIds] },
      },
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
  // Already projected for this viewer — see the query below. `id` is null for
  // a guest, which is what makes the card unlinkable: a logged-out visitor
  // never receives a member id at all, so `key` carries the React key instead.
  let peopleNearby: {
    key: string; id: string | null; name: string; color: string
    profilePhoto: string | null; nationality: string | null; interests: string[]
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
        hiddenFromMembers: false,
        ...(session
          ? { id: { notIn: [session.id, ...blockedIds] } }
          : { profileVisibility: { not: 'connections' } }),
      },
      select: {
        id: true, name: true, color: true, profilePhoto: true,
        nationality: true, interests: true, profileVisibility: true,
      },
      orderBy: { goodHangouts: 'desc' },
      take:    12,
    })
    // The query decides who is a candidate; this decides how much of them
    // this viewer is shown. "Visible to members" was being rendered as visible
    // to the public: a member with default visibility had their full name,
    // photo, nationality, interests and profile link served to anonymous
    // visitors. The section stays — it's the proof the community is alive —
    // but a guest now gets the same shape every other public surface hands
    // out (lib/authorProjection): a first name, initials, nothing else.
    const restricted = session ? await restrictedSetFor(session, candidates) : new Set<string>()
    peopleNearby = candidates.slice(0, 8).map((m, i) => {
      // Locked = a guest (everyone), or a connections-only member this viewer
      // isn't connected to. Restricted members are shown as a first name
      // rather than dropped, so the neighbourhood doesn't read as emptier
      // than it is — the same trade the board and guide authors make.
      const locked = !session || restricted.has(m.id)
      return {
        key:          session ? m.id : `p${i}`,
        id:           session ? m.id : null,
        name:         locked ? (firstNameOf(m.name) || 'Smileys member') : m.name,
        color:        m.color,
        profilePhoto: locked ? null : m.profilePhoto,
        // The attributes a locked member card withholds go with the photo.
        nationality:  locked ? null : m.nationality,
        interests:    locked ? []   : m.interests,
      }
    })
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
          AND: [
            { OR: [{ userId: null }, { user: { status: 'approved', hiddenFromMembers: false } }] },
            ...(blockedIds.length ? [{ OR: [{ userId: null }, { userId: { notIn: blockedIds } }] }] : []),
          ],
        },
        select: {
          id: true, name: true, fromCity: true, startsOn: true, endsOn: true,
          user: { select: { id: true, name: true, color: true, profilePhoto: true } },
        },
        orderBy: { startsOn: 'asc' },
        take: 4,
      // A guest gets a first name and the month, no author (lib/visitorPolicy).
      }).then(rows => session ? rows.map(r => ({ ...r, name: visitorName(r.name), approximate: false })) : rows.map(r => ({ ...r, ...guestView(r), user: null })))
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
    // First name only, and cut HERE rather than at render. LocalFavorites
    // already displayed firstNameOf(quoteBy), but the full name was serialised
    // into its props and streamed to the browser in the RSC payload, so eight
    // members' full names were in view-source on a logged-out page — the
    // client gate hid the surname from the screen, not from the wire.
    quoteBy:      firstNameOf(b.reviews[0]?.author?.name ?? '') || null,
  }))

  // ItemList of Place — deterministic, non-personalized (built from the
  // static NEIGHBORHOOD_META set, not the viewer's session), so it's safe to
  // mirror in structured data regardless of who/what is crawling. Mirrors
  // the neighborhood cards actually rendered on the page.
  // Four slugs are shared with another city, so a bare URL is the default
  // city's page — qualify every link and every <loc> the way the detail
  // page's canonical does.
  const cityQuery = city.slug === DEFAULT_CITY_SLUG ? '' : `?city=${city.slug}`
  const neighborhoodsJsonLd = {
    '@context': 'https://schema.org',
    '@type':    'ItemList',
    itemListElement: neighborhoods.map((n, i) => ({
      '@type':  'ListItem',
      position: i + 1,
      item: {
        '@type': 'Place',
        name:    `${n.name}, ${city.name}`,
        url:     `${APP_URL}/neighborhoods/${n.slug}${cityQuery}`,
        containedInPlace: {
          '@type': 'City',
          name:    city.name,
          containedInPlace: { '@type': 'Country', name: countryName(city.country) },
        },
      },
    })),
  }

  return (
    <main>
      <script type="application/ld+json"
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
            <Link href={`/neighborhoods/${neighborhoodToSlug(userNeighborhood)}${cityQuery}`}
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
            are both applied in the query above, and every card below renders
            the already-projected row: a guest's card carries a first name and
            initials and nothing that identifies the person behind them. */}
        {peopleNearby.length > 0 && (
          <section className="mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">
              {focusIsYours ? 'People around you' : `People in ${focusNeighborhood}`}
            </h2>
            <p className="text-gray-600 mt-1.5 mb-6">
              Meet Smileys members who call {focusIsYours ? `your part of ${city.name}` : focusNeighborhood} home.
            </p>
            {/* A grid at every width — the horizontal scroller this once was is
                gone, and the card widths went with it. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pb-2">
              {peopleNearby.map(m => (
                <div key={m.key}
                  className="w-full bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                  {/* AvatarImg handles the initials fallback itself, including
                      a photo that 403s behind the applications gate — and a
                      guest's null photo, which is why the same component can
                      render both. The name it's given is the projected one:
                      AvatarImg puts it in the img alt, so a full name here
                      would ship in the HTML and the RSC payload however the
                      label beside it reads. */}
                  {m.id ? (
                    <Link href={`/members/${m.id}`} className="block">
                      <AvatarImg src={avatarUrl(m.profilePhoto, 128)} name={m.name} color={m.color}
                        size="w-16 h-16" textSize="text-xl" className="mb-3" />
                      <p className="font-bold text-gray-900 leading-snug hover:text-amber-600 transition-colors">{m.name}</p>
                    </Link>
                  ) : (
                    <div>
                      <AvatarImg src={avatarUrl(m.profilePhoto, 128)} name={m.name} color={m.color}
                        size="w-16 h-16" textSize="text-xl" className="mb-3" />
                      <p className="font-bold text-gray-900 leading-snug">{m.name}</p>
                    </div>
                  )}
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
                  {/* Both affordances need a member id, which only a member's
                      projection carries. */}
                  {m.id && (
                    <div className="flex items-center gap-2 mt-4">
                      <SayHiButton targetId={m.id} targetName={m.name} />
                      <Link href={`/members/${m.id}`}
                        className="text-xs font-semibold text-gray-500 hover:text-amber-600 transition-colors whitespace-nowrap">
                        View profile →
                      </Link>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <Link href={`/neighborhoods/${neighborhoodToSlug(focusNeighborhood!)}${cityQuery}`}
              className="inline-block mt-6 text-sm font-bold text-amber-600 hover:underline">
              See everyone in {focusNeighborhood} →
            </Link>
          </section>
        )}

        <section id="explore" className="scroll-mt-20">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">Explore {city.name}</h2>
          <p className="text-gray-600 mt-1.5 mb-6">Every neighborhood has its own rhythm. Find yours.</p>
          <NeighborhoodGrid groups={groups} userNeighborhood={userNeighborhood}
            citySlug={city.slug === DEFAULT_CITY_SLUG ? null : city.slug}
            mapCenter={city.lat != null && city.lng != null ? [city.lat, city.lng] : null} />
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
                  <p className="text-xs font-semibold text-amber-700 mt-1">
                    {v.approximate ? `Visiting in ${new Date(v.startsOn + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })}` : `Arriving ${fmtEventDate(v.startsOn)}`}
                  </p>
                  {session && v.user && (
                    <div className="mt-3">
                      <SayHiButton targetId={v.user.id} targetName={v.user.name} />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <Link href={city.slug === DEFAULT_CITY_SLUG ? '/visiting' : `/visiting?city=${city.slug}`} className="inline-block mt-6 text-sm font-bold text-amber-600 hover:underline">
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
                // which made the card a broken promise. A relative query
                // replaces the whole query string, so ?city= has to be carried
                // across or the click lands the viewer back in Istanbul.
                <a key={s2.side} href={`?${cityQuery ? `city=${city.slug}&` : ''}side=${encodeURIComponent(s2.side)}#explore`}
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

        {/* Cross-links — the shared surface grid (components/ExploreMore). */}
        <div className="mt-12">
          <ExploreMore current="neighborhoods" cityId={cityId} cityName={city.name} />
        </div>
      </div>
    </main>
  )
}
