import Link from 'next/link'
import Image from 'next/image'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { neighborhoodToSlug, getNeighborhoodMeta, NEIGHBORHOOD_META } from '@/lib/neighborhoods'
import { formatShortDate, formatTime, BLUR_PLACEHOLDER, resolveImageUrl, avatarUrl } from '@/lib/data'
import { SITE_URL, APP_URL } from '@/lib/env'
import NeighborhoodWall from '@/components/NeighborhoodWall'
import AvatarImg from '@/components/AvatarImg'

// Absolute URL for JSON-LD `image` — schema.org wants a full URL, but
// resolveImageUrl only returns app-relative paths (fine for <img src>,
// not for structured data consumed off-page by crawlers).
function absoluteImageUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined
  const resolved = resolveImageUrl(path)
  if (!resolved) return undefined
  return resolved.startsWith('http') ? resolved : `${SITE_URL}${resolved}`
}

// Same script-tag escaping used by every other JSON-LD block in the app
// (handbook article / event detail / FAQ / neighborhood Place) — JSON.stringify
// doesn't escape `<`, so a literal `</script>` in interpolated text would
// break out of the tag.
function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

interface PlaceItem {
  name: string; description: string; address?: string; tip?: string; badge?: string
}
interface PlaceCategory { category: string; emoji: string; items: PlaceItem[] }
interface NeighborhoodGuide {
  headline?: string; tagline?: string; image?: string; imagePosition?: number
  season?: string; transport?: string[]; languages?: string[]; groupLink?: string; groupLabel?: string
  spotlight?: { quote: string; name: string; since?: string }
  places?: PlaceCategory[]; tips?: string[]
}

interface Props {
  name:    string
  slug:    string
  meta:    ReturnType<typeof getNeighborhoodMeta>
  guide:   NeighborhoodGuide | null
  myId:    string | null
  isStaff: boolean
  hasNoNeighborhood: boolean
  sideLabel: Record<string, string>
}

export default async function NeighborhoodSections({
  name, slug, meta, guide, myId, isStaff, hasNoNeighborhood, sideLabel,
}: Props) {
  const today = new Date().toISOString().split('T')[0]

  const now = new Date()

  const [
    upcomingRaw, pastCount, locals, hostCounts,
    totalLocals, allEventCounts, communityPhotos, wallPostCount,
    activeListings, upcomingVisitors, activeHangouts, businesses, activePulses,
    boardPosts,
  ] = await Promise.all([
    prisma.event.findMany({
      where:   { neighborhood: name, date: { gte: today }, status: 'published' },
      orderBy: [{ attendees: { _count: 'desc' } }, { date: 'asc' }],
      take: 3,
      include: {
        _count:    { select: { attendees: { where: { status: 'approved', user: { status: 'approved' } } } } },
        attendees: {
          where:   { status: 'approved', user: { status: 'approved' } },
          take:    3,
          orderBy: { joinedAt: 'desc' },
          select:  { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
        },
      },
    }),
    prisma.event.count({ where: { neighborhood: name, date: { lt: today } } }),
    prisma.user.findMany({
      where:   { neighborhood: name, status: 'approved' },
      select:  { id: true, name: true, color: true, profilePhoto: true },
      take:    12,
      orderBy: { joinedAt: 'desc' },
    }),
    prisma.event.groupBy({
      by:      ['hostId'],
      where:   { neighborhood: name },
      _count:  { _all: true },
      orderBy: { _count: { hostId: 'desc' } },
      take:    4,
    }),
    prisma.user.count({ where: { neighborhood: name, status: 'approved' } }),
    prisma.event.groupBy({
      by:    ['neighborhood'],
      where: { date: { gte: today } },
      _count: { _all: true },
    }),
    prisma.eventPhoto.findMany({
      where:   { event: { neighborhood: name } },
      take:    9,
      orderBy: { createdAt: 'desc' },
      select:  { id: true, url: true, caption: true, event: { select: { id: true, title: true } } },
    }),
    myId ? prisma.neighborhoodPost.count({ where: { neighborhood: name } }) : Promise.resolve(null),
    // Active marketplace listings tagged to this neighborhood — lets housing
    // posts surface where people look for them ("flats in Moda" arrives on the
    // Moda page and sees them, no extra step).
    prisma.listing.findMany({
      where:   { neighborhood: name, status: 'active', user: { status: 'approved' } },
      orderBy: { createdAt: 'desc' },
      take:    6,
      select:  {
        id: true, category: true, title: true, price: true, photo: true,
        createdAt: true,
        user: { select: { id: true, name: true, color: true, profilePhoto: true } },
      },
    }),
    // Visitors with active trips ending today or later, tagged to this
    // neighborhood. Local members get the "someone's coming to your area"
    // signal alongside events + listings.
    prisma.visitorAnnouncement.findMany({
      where:   { neighborhood: name, status: 'active', endsOn: { gte: today } },
      orderBy: { startsOn: 'asc' },
      take:    3,
      select:  {
        id: true, name: true, fromCity: true, startsOn: true, endsOn: true, intro: true,
      },
    }),
    // Active hangouts in this neighborhood — sweeper flips them to 'expired'
    // when endsAt passes, but we also filter by endsAt >= now so a missed
    // sweeper run can't show stale ones. Same shape the /hangouts feed uses
    // so users can recognize the cards.
    prisma.hangout.findMany({
      where:   { neighborhood: name, status: 'active', endsAt: { gte: now }, user: { status: 'approved' } },
      orderBy: { startsAt: 'asc' },
      take:    3,
      select:  {
        id: true, title: true, location: true, startsAt: true, endsAt: true,
        user: { select: { id: true, name: true, color: true, profilePhoto: true, goodHangouts: true } },
        _count: { select: { joins: true } },
      },
    }),
    // Approved + active directory entries tagged to this neighborhood.
    // Up to 6 cards then "See all →" deep-links into /directory with the
    // neighborhood pre-filtered. Silent when empty (matches every other
    // section here — quiet areas don't read as "no businesses").
    prisma.business.findMany({
      where:   { neighborhood: name, isApproved: true, isActive: true },
      orderBy: { createdAt: 'desc' },
      take:    6,
      select:  {
        id: true, name: true, category: true, description: true,
        logo: true, coverImage: true, website: true, instagram: true,
        isExpatOwned: true, isExpatFriendly: true,
      },
    }),
    // Members who've pulsed that they're free to meet up in this neighborhood
    // right now (non-expired). Pulses are member-only content (the /hangouts
    // feed gates on session), so only fetch when the viewer is logged in.
    myId
      ? prisma.availabilityPulse.findMany({
          where:   { neighborhood: name, until: { gte: now }, user: { status: 'approved' } },
          orderBy: { createdAt: 'desc' },
          take:    6,
          select:  {
            id: true, note: true, until: true, createdAt: true,
            user: { select: { id: true, name: true, color: true, profilePhoto: true } },
          },
        })
      : Promise.resolve([]),
    // Board conversations tagged to this neighborhood — same records as the
    // /board Community feed, filtered. This page is the reason board posts
    // carry a neighborhood at all.
    prisma.boardPost.findMany({
      where: {
        neighborhood: name, status: 'active',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 4,
      select: {
        id: true, type: true, title: true, whenLabel: true, createdAt: true,
        user: { select: { id: true, name: true, color: true, profilePhoto: true } },
        _count: { select: { replies: true, interests: true } },
      },
    }),
  ])

  const hosts = hostCounts.length > 0
    ? await prisma.user.findMany({
        where:  { id: { in: hostCounts.map(h => h.hostId) }, status: 'approved' },
        select: { id: true, name: true, color: true, profilePhoto: true },
      })
    : []

  const rankedHosts = hostCounts
    .map(h => ({ ...hosts.find(u => u.id === h.hostId)!, eventCount: h._count._all }))
    .filter(h => h.id)

  const nearby = Object.entries(NEIGHBORHOOD_META)
    .filter(([n, m]) => m.side === meta.side && n !== name)
    .map(([n, m]) => {
      const eventCount = allEventCounts.find(e => e.neighborhood === n)?._count._all ?? 0
      return { name: n, slug: neighborhoodToSlug(n), meta: m, eventCount }
    })
    .sort((a, b) => b.eventCount - a.eventCount)
    .slice(0, 3)

  const similar = Object.entries(NEIGHBORHOOD_META)
    .filter(([n, m]) => Math.abs(m.cost - meta.cost) <= 1 && n !== name && m.side !== meta.side)
    .map(([n, m]) => {
      const eventCount = allEventCounts.find(e => e.neighborhood === n)?._count._all ?? 0
      return { name: n, slug: neighborhoodToSlug(n), meta: m, eventCount }
    })
    .sort((a, b) => b.eventCount - a.eventCount)
    .slice(0, 3)

  // Read the per-request CSP nonce set by middleware — this component streams
  // in under a <Suspense> boundary but still renders within the same request,
  // so headers() resolves the same nonce page.tsx used for its own JSON-LD.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  // Mirrors the visible event cards below: only real, published, upcoming
  // events actually rendered on the page, so the markup never claims content
  // a crawler wouldn't also see in the DOM.
  const eventsJsonLd = upcomingRaw.length > 0 ? {
    '@context': 'https://schema.org',
    '@type':    'ItemList',
    itemListElement: upcomingRaw.slice(0, 3).map((e, i) => ({
      '@type':   'ListItem',
      position:  i + 1,
      item: {
        '@type':      'Event',
        name:         e.title,
        description:  e.description
          ? e.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
          : `${e.emoji} ${e.title} in ${name}, Istanbul`,
        startDate:    `${e.date}T${e.time ?? '00:00'}:00+03:00`,
        eventStatus:  'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: {
          '@type': 'Place',
          name:    e.location || name || 'Istanbul',
          address: { '@type': 'PostalAddress', addressLocality: 'Istanbul', addressCountry: 'TR' },
        },
        image:     absoluteImageUrl(e.coverImage),
        url:       `${APP_URL}/events/${e.id}`,
        organizer: { '@type': 'Organization', name: 'Smileys Community', url: SITE_URL },
      },
    })),
  } : null

  // Mirrors the visible business cards below (same query, same 6-item cap).
  const businessJsonLd = businesses.length > 0 ? {
    '@context': 'https://schema.org',
    '@type':    'ItemList',
    itemListElement: businesses.map((b, i) => ({
      '@type':   'ListItem',
      position:  i + 1,
      item: {
        '@type':      'LocalBusiness',
        name:         b.name,
        description:  b.description
          ? b.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
          : undefined,
        image:        absoluteImageUrl(b.logo || b.coverImage),
        url:          b.website || `${APP_URL}/directory?neighborhood=${encodeURIComponent(name)}`,
        address: {
          '@type':         'PostalAddress',
          addressLocality: name,
          addressRegion:   'Istanbul',
          addressCountry:  'TR',
        },
      },
    })),
  } : null

  return (
    <>
      {eventsJsonLd && (
        <script type="application/ld+json" nonce={nonce}
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(eventsJsonLd) }} />
      )}
      {businessJsonLd && (
        <script type="application/ld+json" nonce={nonce}
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(businessJsonLd) }} />
      )}
      {/* Members free to meet up right now in this neighborhood (availability
          pulses). Member-only signal (gated on myId), non-expired only.
          Leads the page — "free right now" is the most time-sensitive signal
          here, so it sits above events/hangouts rather than trailing them.
          Silent when empty. */}
      {myId && activePulses.length > 0 && (
        <div className="rounded-2xl border border-green-100 bg-green-50/40 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold text-green-700 uppercase tracking-widest"><span aria-hidden="true">🟢</span> Around right now in {name}</h2>
            <Link href={`/hangouts?neighborhood=${encodeURIComponent(name)}`}
              className="text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors">
              See all →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {activePulses.map(p => {
              const until    = new Date(p.until)
              const minsLeft = Math.max(0, Math.round((until.getTime() - now.getTime()) / 60_000))
              const window   = minsLeft >= 60
                ? `until ${until.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
                : `${minsLeft}m left`
              return (
                <Link key={p.id} href={`/members/${p.user.id}`} className="group block">
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:shadow-md hover:-translate-y-0.5 transition-all h-full">
                    <p className="text-xs font-bold text-green-700 uppercase tracking-wide mb-2">Free to meet · {window}</p>
                    {p.note && <p className="text-sm text-gray-800 mb-3 line-clamp-2">{p.note}</p>}
                    <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                      <AvatarImg src={avatarUrl(p.user.profilePhoto, 64)} name={p.user.name} color={p.user.color} size="w-6 h-6" textSize="text-[10px]" className="shrink-0" />
                      <span className="text-xs text-gray-600 truncate">{p.user.name}</span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Active hangouts in this neighborhood — lifted near the top (with the
          pulses) so the two "happening now" signals lead the page instead of
          trailing after the guide/businesses. Silent when empty. */}
      {activeHangouts.length > 0 && (
        <div className="pt-6 border-t border-gray-100">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest">Hangouts happening in {name}</h2>
            <Link href={`/hangouts?neighborhood=${encodeURIComponent(name)}`}
              className="text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors">
              See all →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {activeHangouts.map(h => {
              const s = new Date(h.startsAt)
              const minsToStart = Math.round((s.getTime() - now.getTime()) / 60_000)
              const window = minsToStart < 0  ? 'Happening now'
                           : minsToStart < 60 ? `Starts in ${minsToStart}m`
                           : minsToStart < 60 * 12
                             ? `Starts ${s.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
                             : s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
              const going  = h._count.joins + 1  // +1 = host
              return (
                <Link key={h.id} href={`/hangouts/${h.id}`} className="group block">
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:shadow-md hover:-translate-y-0.5 transition-all h-full">
                    <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-2"><span aria-hidden="true">☕</span> {window}</p>
                    <p className="text-sm font-bold text-gray-900 mb-1 line-clamp-2">{h.title}</p>
                    <p className="text-xs text-gray-600 mb-3 line-clamp-1"><span aria-hidden="true">📍</span> {h.location}</p>
                    <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                      <AvatarImg src={avatarUrl(h.user.profilePhoto, 64)} name={h.user.name} color={h.user.color} size="w-6 h-6" textSize="text-[10px]" className="shrink-0" />
                      <span className="text-xs text-gray-600 truncate">{h.user.name}</span>
                      {h.user.goodHangouts > 0 && (
                        <span className="text-[10px] font-semibold text-green-700 shrink-0"><span aria-hidden="true">✓</span> {h.user.goodHangouts}</span>
                      )}
                      <span className="text-xs text-gray-400 ml-auto shrink-0">{going} going</span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Local members */}
      {locals.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest">
              Local members ({totalLocals})
            </h2>
            <a href={`/members?neighborhood=${encodeURIComponent(name)}`}
              className="text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors">
              See all →
            </a>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
            <div className="flex flex-wrap gap-4">
              {locals.map(m => (
                <Link key={m.id} href={`/members/${m.id}`} className="flex flex-col items-center gap-1.5 group hover:opacity-80 transition-opacity">
                  <AvatarImg src={avatarUrl(m.profilePhoto, 128)} name={m.name} color={m.color} />
                  <span className="text-xs text-gray-600 max-w-[56px] text-center truncate group-hover:text-amber-600 transition-colors">
                    {m.name.split(' ')[0]}
                  </span>
                </Link>
              ))}
            </div>
            {totalLocals > 12 && (
              <p className="text-xs text-gray-400 mt-4">+ {totalLocals - 12} more Smileys members in {name}</p>
            )}
          </div>
        </div>
      )}

      {/* Spotlight quote */}
      {guide?.spotlight && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <span aria-hidden="true" className="text-3xl shrink-0 mt-0.5">💬</span>
            <div>
              <p className="text-gray-800 text-sm leading-relaxed italic mb-3">"{guide.spotlight.quote}"</p>
              <p className="text-xs font-semibold text-amber-700">
                — {guide.spotlight.name}
                {guide.spotlight.since && <span className="font-normal text-amber-600"> · {guide.spotlight.since}</span>}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Events */}
      {upcomingRaw.length === 0 ? (
        <div className="text-center py-20">
          <div aria-hidden="true" className="text-5xl mb-4">🔍</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">No upcoming events in {name}</h2>
          <p className="text-gray-600 text-sm mb-6">New events are added weekly — check back soon.</p>
          <Link href="/neighborhoods" className="px-5 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors">
            Explore other neighborhoods
          </Link>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest">Upcoming events</h2>
            <a href={`/members?neighborhood=${encodeURIComponent(name)}`}
              className="text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors">
              {totalLocals} local member{totalLocals !== 1 ? 's' : ''} →
            </a>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {upcomingRaw.slice(0, 3).map((event, idx) => {
              const spotsLeft  = Math.max(0, event.spotsLeft)
              const goingCount = event.totalSpots - spotsLeft
              const isHot      = idx === 0 && goingCount >= 3
              return (
                <Link key={event.id} href={`/events/${event.id}`} className="group block">
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all">
                    <div className="relative h-40 overflow-hidden">
                      {event.coverImage ? (
                        <Image src={resolveImageUrl(event.coverImage)} alt={event.title} fill
                          className="object-cover" sizes="(max-width: 640px) 100vw, 33vw"
                          placeholder="blur" blurDataURL={BLUR_PLACEHOLDER} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-amber-100 to-orange-100">
                          <span aria-hidden="true" className="text-5xl">{event.emoji}</span>
                        </div>
                      )}
                      {isHot && <span className="absolute top-3 left-3 text-xs font-bold bg-red-500 text-white px-2 py-0.5 rounded-full"><span aria-hidden="true">🔥</span> Popular</span>}
                      {!isHot && event.isPremium && <span className="absolute top-3 left-3 text-xs font-bold bg-gray-900 text-amber-400 px-2 py-0.5 rounded-full"><span aria-hidden="true">♛</span> Premium</span>}
                      {isHot && event.isPremium && <span className="absolute top-3 right-3 text-xs font-bold bg-gray-900 text-amber-400 px-2 py-0.5 rounded-full"><span aria-hidden="true">♛</span> Premium</span>}
                    </div>
                    <div className="p-4">
                      <div className="text-xs text-amber-600 font-semibold mb-1.5">
                        {formatShortDate(event.date)} · {formatTime(event.time)}
                      </div>
                      <h3 className="font-bold text-gray-900 text-sm leading-snug mb-3 group-hover:text-amber-600 transition-colors line-clamp-2">
                        {event.title}
                      </h3>
                      {goingCount > 0 && (
                        <div className="flex items-center gap-2 mb-3">
                          <div className="flex -space-x-1.5">
                            {event.attendees.slice(0, 3).map(a => (
                              <AvatarImg key={a.user.id} src={avatarUrl(a.user.profilePhoto, 64)} name={a.user.name} color={a.user.color}
                                size="w-6 h-6" textSize="text-[8px]" className="border-2 border-white" />
                            ))}
                          </div>
                          <span className="text-xs text-gray-400">{goingCount} going</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-gray-900">
                          {event.price === 0 ? <span className="text-green-600">Free</span> : `₺${event.price}`}
                        </span>
                        {event.limitedSpots && (
                          <span className={`text-xs font-semibold ${spotsLeft <= 3 ? 'text-red-500' : 'text-gray-400'}`}>
                            {spotsLeft === 0 ? 'Full' : `${spotsLeft} spots left`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
          <div className="mt-6 text-center">
            <Link href={`/events?neighborhood=${encodeURIComponent(name)}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 hover:border-amber-300 hover:text-amber-700 transition-colors">
              See all events in {name}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      )}

      {/* Local hosts */}
      {rankedHosts.length > 0 && (
        <div>
          <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-5">Local hosts</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {rankedHosts.map((h, i) => (
              <Link key={h.id} href={`/members/${h.id}`}
                className="group flex items-center gap-3 bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-amber-200 transition-all">
                <div className="relative shrink-0">
                  <AvatarImg src={avatarUrl(h.profilePhoto, 128)} name={h.name} color={h.color} />
                  {i === 0 && <span aria-hidden="true" className="absolute -top-1 -right-1 text-sm">🏆</span>}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 group-hover:text-amber-600 transition-colors truncate">{h.name}</div>
                  <div className="text-xs text-gray-400">{h.eventCount} event{h.eventCount !== 1 ? 's' : ''} hosted in {name}</div>
                </div>
                <svg className="w-4 h-4 text-gray-300 group-hover:text-amber-400 transition-colors ml-auto shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Visitors heading to this neighborhood — silent when empty so quiet
          areas don't broadcast "0 visitors". Three slots, link to /visiting
          for the full list. */}
      {upcomingVisitors.length > 0 && (
        <div className="pt-6 border-t border-gray-100">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest">Visitors heading to {name}</h2>
            <Link href={`/visiting?neighborhood=${encodeURIComponent(name)}`}
              className="text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors">
              See all →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {upcomingVisitors.map(v => {
              const s = new Date(v.startsOn + 'T00:00:00')
              const e = new Date(v.endsOn + 'T00:00:00')
              const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
              const fmtRange = sameMonth
                ? `${s.toLocaleDateString('en-GB', { day: 'numeric' })}–${e.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                : `${s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${e.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
              return (
                <Link key={v.id} href="/visiting" className="group block">
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:shadow-md hover:-translate-y-0.5 transition-all h-full">
                    <div className="flex items-center gap-2 mb-2">
                      <span aria-hidden="true" className="text-2xl">👋</span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-900 truncate">{v.name}</p>
                        {v.fromCity && <p className="text-xs text-gray-600 truncate">from {v.fromCity}</p>}
                      </div>
                    </div>
                    <p className="text-xs font-semibold text-amber-700 mb-2">{fmtRange}</p>
                    <p className="text-xs text-gray-600 line-clamp-3 leading-relaxed">{v.intro}</p>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}
      {/* Local businesses in this neighborhood — expat-owned / expat-friendly
          spots from the community directory. Silent when empty. "See all →"
          deep-links /directory with this neighborhood pre-selected so the
          context survives the click. */}
      {businesses.length > 0 && (
        <div className="pt-6 border-t border-gray-100">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest">Local businesses in {name}</h2>
            <Link href={`/directory?neighborhood=${encodeURIComponent(name)}`}
              className="text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors">
              See all →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {businesses.map(b => {
              const cover = resolveImageUrl(b.coverImage)
              const logo  = resolveImageUrl(b.logo)
              return (
                <Link key={b.id} href={`/directory?neighborhood=${encodeURIComponent(name)}`} className="group block">
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all h-full flex flex-col">
                    <div className="relative h-32 bg-gray-100">
                      {cover ? (
                        <img src={cover} alt={b.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                      ) : (
                        <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-4xl text-gray-300">🏢</div>
                      )}
                      {/* Expat badges — top-left so the logo (bottom-right) doesn't collide. */}
                      <div className="absolute top-2 left-2 flex flex-col gap-1">
                        {b.isExpatOwned    && <span className="bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-tight">Expat-owned</span>}
                        {b.isExpatFriendly && <span className="bg-teal-500  text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-tight">Expat-friendly</span>}
                      </div>
                      {logo && (
                        <div className="absolute bottom-2 right-2 w-9 h-9 rounded-xl overflow-hidden border-2 border-white shadow-sm bg-white">
                          <img src={logo} alt={b.name} className="w-full h-full object-cover" />
                        </div>
                      )}
                    </div>
                    <div className="p-3 flex flex-col gap-1">
                      <h3 className="font-semibold text-gray-900 text-sm leading-snug line-clamp-1 group-hover:text-amber-600 transition-colors">
                        {b.name}
                      </h3>
                      <p className="text-[11px] text-gray-400">{b.category}</p>
                      <p className="text-xs text-gray-600 line-clamp-2 mt-1">{b.description}</p>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Board conversations — plans and questions tagged here. Above the
          marketplace: a person asking "anyone around?" is the stronger
          social signal than a desk for sale. */}
      {boardPosts.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest">On the Board in {name}</h2>
            <div className="flex items-center gap-4">
              <Link href={`/board?compose=1&neighborhood=${encodeURIComponent(name)}`}
                className="text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors">
                Ask about {name} →
              </Link>
              <Link href={`/board?neighborhood=${encodeURIComponent(name)}`} className="text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors">
                See all →
              </Link>
            </div>
          </div>
          <div className="space-y-3">
            {boardPosts.map(bp => (
              <Link key={bp.id} href={`/board?post=${bp.id}`}
                className="flex items-center gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3.5 hover:border-amber-200 hover:shadow-md transition-all group">
                <AvatarImg src={avatarUrl(bp.user.profilePhoto, 64)} name={bp.user.name} color={bp.user.color}
                  size="w-9 h-9" textSize="text-xs" className="shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 leading-snug truncate group-hover:text-amber-700 transition-colors">
                    <span aria-hidden="true">{bp.type === 'plan' ? '☕' : bp.type === 'question' ? '❓' : bp.type === 'reco' ? '💡' : '📣'} </span>{bp.title}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {bp.user.name.split(' ')[0]}
                    {bp.whenLabel && <> · <span aria-hidden="true">🕐</span> {bp.whenLabel}</>}
                    {bp._count.replies > 0 && <> · <span aria-hidden="true">💬</span> {bp._count.replies}</>}
                    {bp._count.interests > 0 && <> · <span aria-hidden="true">👋</span> {bp._count.interests} interested</>}
                  </p>
                </div>
                <span className="shrink-0 text-gray-300 group-hover:text-amber-500 transition-colors">→</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Neighborhood Wall */}
      {myId && (
        <div id="wall">
          <div className="flex items-center gap-3 mb-5">
            <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest">
              Neighborhood Wall{wallPostCount !== null && wallPostCount > 0 ? ` (${wallPostCount})` : ''}
            </h2>
            <div className="flex-1 h-px bg-gray-100" />
            <span className="text-xs text-gray-400">Open to all members</span>
          </div>
          <NeighborhoodWall slug={slug} name={name} myId={myId} isStaff={isStaff} />
        </div>
      )}

      {/* Marketplace listings — right after members so housing/classifieds
          appear in context (not buried after photos and nearby areas). */}
      {activeListings.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest">Marketplace in {name}</h2>
            <Link href={`/board?neighborhood=${encodeURIComponent(name)}`}
              className="text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors">
              See all →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeListings.map(l => {
              const emoji =
                l.category === 'ROOMS'    ? '🏠' :
                l.category === 'JOBS'     ? '💼' :
                l.category === 'SERVICES' ? '🛠️' :
                l.category === 'BUY_SELL' ? '🛍️' :
                l.category === 'FREE'     ? '🎁' : '⭐'
              return (
                <Link key={l.id} href={`/board?l=${l.id}`} className="group block">
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all h-full">
                    {l.photo ? (
                      <div className="relative h-32 bg-gray-100">
                        <img src={resolveImageUrl(l.photo)} alt={l.title} className="absolute inset-0 w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="h-24 flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50">
                        <span aria-hidden="true" className="text-4xl opacity-70">{emoji}</span>
                      </div>
                    )}
                    <div className="p-3">
                      <h3 className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2 group-hover:text-amber-600 transition-colors">
                        {l.title}
                      </h3>
                      {l.price && <p className="text-xs font-bold text-gray-700 mt-1.5">{l.price}</p>}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Community photos */}
      {communityPhotos.length > 0 && (
        <div>
          <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-5">Community photos</h2>
          <div className="grid grid-cols-3 gap-2">
            {communityPhotos.map(photo => (
              <Link key={photo.id} href={`/events/${photo.event.id}`}
                className="group relative aspect-square rounded-xl overflow-hidden bg-gray-100">
                <img src={resolveImageUrl(photo.url)} alt={photo.caption ?? photo.event.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
              </Link>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3 text-center">Photos from Smileys events in {name}</p>
        </div>
      )}

      {/* Local Favorites Guide */}
      {guide?.places && guide.places.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">Local Favorites</h2>
            <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">Smileys Curated</span>
          </div>
          <div className="space-y-8">
            {guide.places.map(cat => (
              <div key={cat.category}>
                <h3 className="flex items-center gap-2 text-sm font-bold text-gray-700 uppercase tracking-wider mb-3">
                  <span aria-hidden="true">{cat.emoji}</span> {cat.category}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {cat.items.map(place => (
                    <div key={place.name} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-sm font-bold text-gray-900">{place.name}</span>
                        {place.badge && (
                          <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 uppercase tracking-wide">
                            {place.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed mb-2">{place.description}</p>
                      {place.address && (
                        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.address)}`}
                          target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-amber-600 transition-colors mb-2">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          </svg>
                          {place.address}
                        </a>
                      )}
                      {place.tip && (
                        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5 leading-relaxed"><span aria-hidden="true">💡</span> {place.tip}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {guide.tips && guide.tips.length > 0 && (
            <div className="mt-6 bg-gray-50 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-gray-700 mb-3"><span aria-hidden="true">📌</span> Local Tips</h3>
              <ul className="space-y-2">
                {guide.tips.map((tip, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                    <span className="text-amber-500 font-bold shrink-0 mt-0.5">·</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Nearby neighborhoods */}
      {nearby.length > 0 && (
        <div>
          <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-5">
            Also on the {meta.side === 'Central' ? 'centre' : meta.side === 'Islands' ? 'islands' : `${meta.side.toLowerCase()} side`}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {nearby.map(n => (
              <Link key={n.slug} href={`/neighborhoods/${n.slug}`}
                className="group flex items-center gap-3 bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                <div aria-hidden="true" className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-xl shrink-0 group-hover:bg-amber-100 transition-colors">
                  {n.meta.emoji}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-gray-900 group-hover:text-amber-600 transition-colors truncate">{n.name}</div>
                  <div className="text-xs text-gray-400 truncate">{n.meta.vibe}</div>
                  {n.eventCount > 0 && <div className="text-xs text-amber-600 font-semibold mt-0.5">{n.eventCount} upcoming</div>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* You might also like */}
      {similar.length > 0 && (
        <div>
          <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-5">You might also like</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {similar.map(n => (
              <Link key={n.slug} href={`/neighborhoods/${n.slug}`}
                className="group flex items-center gap-3 bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                <div aria-hidden="true" className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-xl shrink-0 group-hover:bg-amber-50 transition-colors">
                  {n.meta.emoji}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-gray-900 group-hover:text-amber-600 transition-colors truncate">{n.name}</div>
                  <div className="text-xs text-gray-400 truncate">{n.meta.vibe}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    <span aria-label={n.meta.cost === 1 ? 'Affordable' : n.meta.cost === 2 ? 'Mid-range' : 'Pricey'}>
                      <span aria-hidden="true">{n.meta.cost === 1 ? '💰' : n.meta.cost === 2 ? '💰💰' : '💰💰💰'}</span>
                    </span> · {sideLabel[n.meta.side]}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

    </>
  )
}
