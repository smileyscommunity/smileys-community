import { notFound } from 'next/navigation'
import { jsonLdHtml } from '@/lib/jsonLd'
import { headers } from 'next/headers'
import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { getEventById } from '@/lib/db'
import { getCityConfig } from '@/lib/city'
import { DEFAULT_TZ, todayInTz, fromWallClockInTz } from '@/lib/cityTime'
import { formatDate, formatTime, formatPrice, vibeConfig, resolveImageUrl, avatarUrl, getInitials, type Event } from '@/lib/data'
import { countryFlag } from '@/lib/countries'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { loadViewerFacts, sharedContextFor } from '@/lib/sharedContext'
import EventConnections from './EventConnections'
import { restrictedSetFor } from '@/lib/memberPrivacy'
import { SITE_URL, APP_URL } from '@/lib/env'
import RSVPButton from '@/components/RSVPButton'
import EventMessages from '@/components/EventMessages'
import EventReviews from '@/components/EventReviews'
import EventPhotos from '@/components/EventPhotos'
import SimilarEvents from '@/components/SimilarEvents'
import ReportButton from '@/components/ReportButton'
import ShareButton from '@/components/ShareButton'
import SocialShare from '@/components/SocialShare'
import EventSaveButton from '@/components/EventSaveButton'
import EventInviteButton from '@/components/EventInviteButton'
import AddToCalendar from '@/components/AddToCalendar'
import EventLocationMap from '@/components/EventLocationMap'
import EventBadges from '@/components/EventBadges'
import { sanitize } from '@/lib/sanitize'
import { isSoldOut, isManuallySoldOut } from '@/lib/soldOut'
import { DEFAULT_CURRENCY } from '@/lib/data'

export const dynamic = 'force-dynamic'

function absoluteImageUrl(coverImage: string | null | undefined, title?: string): string {
  if (!coverImage) {
    // No cover → the /api/og title card (event name) instead of the generic
    // brand image, so a cover-less event still shares with a tailored preview.
    if (title) return `${APP_URL}/api/og?${new URLSearchParams({ title, eyebrow: 'Smileys Community · Event' })}`
    return `${APP_URL}/api/og`
  }
  const resolved = resolveImageUrl(coverImage)
  if (resolved.startsWith('http')) return resolved
  // ?w=1200 hits the file route's PREVIEW resize: aspect-preserved
  // JPEG q75 ~250 KB. Keeps WhatsApp / iMessage / X under their
  // ~600 KB OG-image cap and shrinks the in-page hero load too.
  return `${SITE_URL}${resolved}?w=1200`
}

// Shared by both the guest and member branches below — this used to be two
// separately hand-maintained JSON-LD objects, and the guest one (the only
// one Google ever actually sees, since Googlebot never carries a session)
// had drifted behind: no `offers` at all, eventStatus hardcoded to always
// "Scheduled" regardless of cancellation, and never switched to
// VirtualLocation for online events. None of that is guest-sensitive data —
// price/status/address are exactly what Event rich results need, and the
// visible page UI already handles what actually should stay member-only
// (RSVP, messages, attendee list).
function buildEventJsonLd(event: Event, eventUrl: string, tz: string, cityName: string, countryCode: string) {
  return {
    '@context': 'https://schema.org',
    '@type':    'Event',
    name:        event.title,
    description: event.description
      ? event.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
      : `${event.emoji} ${event.title} in ${event.neighborhood}, ${cityName}`,
    startDate: fromWallClockInTz(`${event.date}T${event.time ?? '00:00'}`, tz).toISOString(),
    eventStatus: event.status === 'cancelled'
      ? 'https://schema.org/EventCancelled'
      : 'https://schema.org/EventScheduled',
    eventAttendanceMode: event.meetingUrl
      ? 'https://schema.org/OnlineEventAttendanceMode'
      : 'https://schema.org/OfflineEventAttendanceMode',
    location: event.meetingUrl
      ? { '@type': 'VirtualLocation', url: event.meetingUrl }
      : {
          '@type': 'Place',
          name:    event.location || event.neighborhood || cityName,
          address: {
            '@type':         'PostalAddress',
            streetAddress:   event.address ?? event.location ?? '',
            addressLocality: cityName,
            addressCountry:  countryCode,
          },
        },
    image: absoluteImageUrl(event.coverImage, event.title) || undefined,
    url:   eventUrl,
    offers: {
      '@type':       'Offer',
      price:         String(event.price ?? 0),
      priceCurrency: event.currency ?? DEFAULT_CURRENCY,
      availability:  isSoldOut(event)
        ? 'https://schema.org/SoldOut'
        : 'https://schema.org/InStock',
      url: eventUrl,
    },
    organizer: { '@type': 'Organization', name: 'Smileys Community', url: SITE_URL },
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const event = await getEventById(id)
  if (!event) return {}

  // Share previews must always carry the date. It leads the description
  // (platforms truncate from the end) and sits in the title too, for
  // platforms that render only title + image. Previously the date only
  // appeared in the no-description fallback, so most shared events showed
  // no date at all.
  const shareDate   = new Date(event.date + 'T00:00:00')
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const title       = `${event.title} · ${shareDate} — Smileys Community`
  const when        = `📅 ${formatDate(event.date)} · ${formatTime(event.time)}${event.neighborhood ? ` · ${event.neighborhood}` : ''}`
  const plainDesc   = event.description
    ? event.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    // City-fetch only on the fallback path — described events (the vast
    // majority) never pay for it.
    : `Join us at Smileys Community ${event.cityId ? (await getCityConfig(event.cityId)).name : 'Istanbul'}`
  const description = `${when} — ${plainDesc}`.slice(0, 155)
  const imageUrl    = absoluteImageUrl(event.coverImage, event.title)
  const pageUrl     = `${APP_URL}/events/${id}`

  return {
    title,
    description,
    alternates: { canonical: pageUrl },
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: 'Smileys Community',
      images: [{ url: imageUrl, secureUrl: imageUrl, width: 1200, height: 630, alt: event.title }],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [imageUrl],
    },
  }
}

export default async function AppEventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Read the per-request CSP nonce set by middleware. Without this, the
  // JSON-LD <script> tag below would be blocked by the nonce-based CSP.
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const event = await getEventById(id)
  if (!event) notFound()

  // The event's own city decides its calendar "today", the timezone stamped
  // on calendar exports, and the locality named in the JSON-LD address.
  const eventCity    = event.cityId ? await getCityConfig(event.cityId) : null
  const eventTz      = eventCity?.timezone ?? DEFAULT_TZ
  const cityName     = eventCity?.name ?? 'Istanbul'
  const cityCountry  = eventCity?.country ?? 'TR'
  const today  = todayInTz(eventTz)
  const isPast = event.date < today
  // One rule for the banner, the capacity strip, the RSVP button and the
  // structured data — they contradicted each other the moment any of them
  // was computed separately.
  const soldOut     = isSoldOut(event)
  const saidSoldOut = isManuallySoldOut(event)

  const session = await getSession()

  if (!session) {
    // Public teaser. /events and individual event pages are public for SEO
    // (Google indexes "salsa night istanbul" → lands on a real page with
    // cover, description, date, time, neighborhood, host). RSVP, messages,
    // attendee list, and private address/links stay member-only — the page
    // pushes the user to /apply for the unlock.
    const eventUrl = `${APP_URL}/events/${id}`
    const guestJsonLd = buildEventJsonLd(event, eventUrl, eventTz, cityName, cityCountry)

    const goingCount = await prisma.eventAttendee.count({
      where: { eventId: id, status: 'approved' },
    })

    const vibes = event.vibes ?? []

    return (
      <div className="min-h-screen bg-warm pb-32">
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: jsonLdHtml(guestJsonLd),
          }}
        />

        {/* Back nav */}
        <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
            <Link href="/events" aria-label="Back" className="p-2.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <span className="font-semibold text-gray-900 text-sm truncate flex-1">{event.title}</span>
            <div className="flex items-center gap-1 shrink-0">
              <AddToCalendar
                title={event.title}
                date={event.date}
                time={event.time}
                timeZone={eventTz}
                endTime={event.endTime}
                location={event.location ?? event.neighborhood ?? ''}
                description={event.description ? event.description.replace(/<[^>]+>/g, '') : ''}
                url={eventUrl}
                compact
              />
              <ShareButton
                title={`${event.title} · ${formatDate(event.date)}`}
                url={eventUrl}
                cacheKey={event.coverImage ? event.coverImage.match(/\/(\d+)-/)?.[1]?.slice(-8) : undefined}
              />
            </div>
          </div>
        </div>

        <div className="max-w-2xl mx-auto">
          {/* Cover */}
          {event.coverImage ? (
            <div className="relative w-full h-48 sm:h-72">
              <Image src={resolveImageUrl(event.coverImage)} alt={event.title} fill className="object-cover" sizes="100vw" priority
                style={{ objectPosition: `center ${event.coverImagePosition ?? 50}%` }} />
            </div>
          ) : (
            <div className="w-full h-48 sm:h-72 bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center">
              <span className="text-8xl select-none">{event.emoji}</span>
            </div>
          )}

          <div className="px-4 sm:px-6 py-6 space-y-6">
            {/* Title + meta */}
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight mb-3">
                {event.title}
              </h1>
              <div className="space-y-2 text-sm text-gray-600">
                <div className="flex items-center gap-2.5">
                  <span className="text-base">📅</span>
                  <span className="font-medium">{formatDate(event.date)} · {formatTime(event.time)} · {cityName} time</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-base">📍</span>
                  <span>{event.neighborhood}</span>
                </div>
                {event.price > 0 && (
                  <div className="flex items-center gap-2.5">
                    <span className="text-base">💰</span>
                    <span>
                      {formatPrice(event.price, event.currency)}
                      <span className="text-gray-400"> · {event.payTo === 'smileys' ? 'pay in advance' : event.ticketUrl ? 'buy online' : 'pay at the venue'}</span>
                    </span>
                  </div>
                )}
                {goingCount > 0 && (
                  <div className="flex items-center gap-2.5">
                    <span className="text-base">👥</span>
                    <span><span className="font-semibold text-gray-800">{goingCount}</span> {goingCount === 1 ? 'person is' : 'people are'} going</span>
                  </div>
                )}
              </div>
            </div>

            {/* Description */}
            {event.description && (
              <div
                className="prose prose-sm max-w-none text-gray-700 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: sanitize(event.description) }}
              />
            )}

            {/* Vibes */}
            {vibes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {vibes.map(v => {
                  const cfg = vibeConfig[v as keyof typeof vibeConfig]
                  return (
                    <span key={v} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-100">
                      {cfg?.emoji && <span>{cfg.emoji}</span>}
                      {v}
                    </span>
                  )
                })}
              </div>
            )}

            {/* Host */}
            {event.hostName && (
              <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
                {event.hostPhoto ? (
                  <Image src={avatarUrl(event.hostPhoto, 96) ?? ''} alt={event.hostName} width={40} height={40} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
                    style={{ backgroundColor: event.hostColor ?? '#f59e0b' }}>
                    {getInitials(event.hostName)}
                  </div>
                )}
                <div>
                  <p className="text-xs text-gray-400">Hosted by</p>
                  <p className="font-semibold text-gray-900 text-sm">{event.hostName}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sticky CTA */}
        <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-gray-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] z-20">
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            <div className="flex-1 hidden sm:block">
              <p className="text-sm font-semibold text-gray-800">Want to join?</p>
              <p className="text-xs text-gray-500">Sign in to RSVP, or apply to Smileys</p>
            </div>
            <Link href={`/login?return=/events/${id}`}
              className="flex-1 sm:flex-none text-center px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold transition-colors">
              Sign in to RSVP
            </Link>
            <Link href="/apply"
              className="flex-1 sm:flex-none text-center px-5 py-3 rounded-xl bg-white border border-amber-200 text-amber-700 hover:bg-amber-50 text-sm font-bold transition-colors">
              Apply
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const isAdmin    = session.role === 'admin'
  const isHost     = session.id === event.hostId

  const cohostRecords = await prisma.eventCoHost.findMany({
    where: { eventId: id },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
    orderBy: { addedAt: 'asc' },
  })
  const cohostIds = cohostRecords.map(c => c.user.id)

  const [attendees, totalAttendeeCount, waitlisted, club, myAttendance, myClubMembership, eventPhotos] = await Promise.all([
    prisma.eventAttendee.findMany({
      where: { eventId: id, status: 'approved', stealth: false, user: { hiddenFromMembers: false }, userId: { notIn: [event.hostId, ...cohostIds] } },
      orderBy: { joinedAt: 'asc' },
      select: {
        checkedIn: true,
        user: { select: { id: true, name: true, color: true, profilePhoto: true, gender: true, nationality: true, profileVisibility: true } }
      },
    }),
    prisma.eventAttendee.count({
      where: { eventId: id, status: 'approved', userId: { notIn: [event.hostId, ...cohostIds] } },
    }),
    prisma.waitlistEntry.findMany({
      where: { eventId: id },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    }).then(async entries => {
      const total = entries.length
      if (!total) return { users: [] as { id: string; name: string; color: string; profilePhoto: string | null; nationality: string | null }[], total: 0 }
      // Show the whole waitlist (members expect to see everyone queued), but
      // keep a high safety cap so a pathological 500-person waitlist can't
      // balloon the DOM / user query. Real event waitlists sit well under this.
      const shownIds = entries.slice(0, 100).map(e => e.userId)
      const rows = await prisma.user.findMany({
        where: { id: { in: shownIds }, hiddenFromMembers: false },
        select: { id: true, name: true, color: true, profilePhoto: true, nationality: true },
      })
      // Preserve waitlist (createdAt) order — findMany by id doesn't guarantee it.
      const byId = new Map(rows.map(u => [u.id, u]))
      return { users: shownIds.map(uid => byId.get(uid)!).filter(Boolean), total }
    }),
    event.clubId
      ? prisma.club.findFirst({ where: { id: event.clubId } })
      : null,
    session && !isAdmin && !isHost
      ? prisma.eventAttendee.findUnique({
          where: { userId_eventId: { userId: session.id, eventId: id } },
        })
      : null,
    event.clubId
      ? prisma.clubMembership.findUnique({
          where: { userId_clubId: { userId: session.id, clubId: event.clubId } },
          select: { status: true },
        })
      : null,
    prisma.eventPhoto.findMany({
      where: { eventId: id },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
    }),
  ])
  const cohosts = cohostRecords
  const checkedInCount = attendees.filter(a => a.checkedIn).length

  // Private ('connections') attendees the viewer isn't connected to: keep them
  // in the grid (name + photo, like the directory), but hide the private
  // nationality attribute. Cheap — returns empty for privileged viewers or when
  // no attendee is 'connections'-visibility.
  const restrictedAttendees = await restrictedSetFor(
    session,
    attendees.map(a => ({ id: a.user.id, profileVisibility: a.user.profileVisibility })),
  )

  const hasCoords    = event.lat != null && event.lng != null
  // Directions link — always resolvable so every event gets one (the map still
  // needs coords, but a Maps search only needs text). Priority: online meeting
  // URL → street address → exact coords → a place search on location +
  // neighborhood (same fallback hangouts use).
  const mapsHref      = event.meetingUrl
    ?? (event.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address + ', ' + cityName)}`
      : hasCoords
      ? `https://www.google.com/maps/search/?api=1&query=${event.lat},${event.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([event.location, event.neighborhood, cityName].filter(Boolean).join(', '))}`)

  const fillPercent = event.totalSpots > 0 ? (totalAttendeeCount / event.totalSpots) * 100 : 0
  const canSeeLocation = true
  // Club chat fallback: when the event has no WhatsApp link of its own, offer
  // the club's group link — but only to viewers the club page would already
  // give it to (approved club members), or approved attendees of a public
  // club's event. The club page gates this link behind membership; showing it
  // to every member here would bypass private clubs' join approval.
  const isClubMember     = myClubMembership?.status === 'approved'
  // §26 — "you'll know some people": which attendees share a club,
  // neighborhood or connection with the viewer. The brief calls this the
  // anxiety-reducer, and it's the single strongest reason someone
  // hesitating on an RSVP decides to come. Reuses the Members
  // shared-context engine; never invents a relationship.
  const attendeeContext = session
    ? await (async () => {
        const others = attendees.map(a => a.user.id).filter(uid => uid !== session.id)
        if (others.length === 0) return []
        const viewer = await loadViewerFacts(session.id)
        const map = await sharedContextFor(viewer, others)
        return attendees
          .filter(a => a.user.id !== session.id)
          .map(a => ({ user: a.user, ctx: map.get(a.user.id) }))
          .filter(x => x.ctx && x.ctx.weight > 0)
          .sort((a, b) => (b.ctx!.weight - a.ctx!.weight))
      })()
    : []

  // §35 — is this already on the viewer's saved list?
  const savedByViewer = session
    ? !!(await prisma.eventSave.findUnique({
        where:  { userId_eventId: { userId: session.id, eventId: id } },
        select: { id: true },
      }))
    : false

  const isApprovedHere   = isAdmin || isHost || myAttendance?.status === 'approved'
  const clubWhatsappUrl  = !event.whatsappUrl && club?.whatsappUrl &&
    (isClubMember || (!club.isPrivate && isApprovedHere))
    ? club.whatsappUrl : null
  const whatsappLink     = event.whatsappUrl || clubWhatsappUrl
  // Gender counts must include stealth attendees — attendees[] is stealth-filtered
  // for the display grid, so we derive counts from totalAttendeeCount's sibling query.
  const allApprovedGenders = await prisma.eventAttendee.findMany({
    where: { eventId: id, status: 'approved', userId: { notIn: [event.hostId, ...cohostIds] } },
    select: { user: { select: { gender: true, nationality: true } } },
  })
  const femaleCount         = allApprovedGenders.filter(a => a.user.gender === 'female').length
  const maleCount           = allApprovedGenders.filter(a => a.user.gender === 'male').length
  const maleQuota           = event.maleQuota ?? null
  const effectiveMaleQuota  = event.genderBalance ? (maleQuota ?? Math.floor(event.totalSpots / 2)) : null
  const femaleCapacity      = effectiveMaleQuota !== null ? event.totalSpots - effectiveMaleQuota : event.totalSpots
  const maleIsFull          = effectiveMaleQuota !== null && maleCount >= effectiveMaleQuota
  const turkishMaleCount = event.turkishMaleQuota
    ? allApprovedGenders.filter(a => (a.user as any).nationality === 'Turkey' && a.user.gender === 'male').length
    : 0

  // Cross-link to the business directory when this venue has a listing
  // (matched by name — the venue-import script keeps directory names in
  // sync with event.location).
  const directoryBusiness = event.location
    ? await prisma.business.findFirst({
        where: {
          name: { equals: event.location.replace(/\s+/g, ' ').trim(), mode: 'insensitive' },
          isApproved: true, isActive: true,
        },
        select: { id: true },
      })
    : null

  // Build JSON-LD Event schema
  const eventUrl = `${APP_URL}/events/${id}`
  const jsonLd = buildEventJsonLd(event, eventUrl, eventTz, cityName, cityCountry)

  return (
    <div className="min-h-screen bg-warm pb-36 md:pb-28 lg:pb-10">
      <script
        type="application/ld+json"
        nonce={nonce}
        // JSON.stringify does NOT escape `<` so a host putting
        // `</script><script>alert(1)` in event.title (or any other
        // user-controlled field that lands in jsonLd above) would
        // break out of this script tag — stored XSS. Escape `<`
        // and the unicode line separators U+2028 / U+2029 (which
        // terminate JS string literals).
        dangerouslySetInnerHTML={{
          __html: jsonLdHtml(jsonLd),
        }}
      />
      {/* Back */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/events" aria-label="Back" className="p-2.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <span className="font-semibold text-gray-900 text-sm truncate flex-1">{event.title}</span>
          <div className="flex items-center gap-1 shrink-0">
            <AddToCalendar
              title={event.title}
              date={event.date}
              time={event.time}
              timeZone={eventTz}
                endTime={event.endTime}
              location={event.location ?? event.neighborhood ?? ''}
              description={event.description ? event.description.replace(/<[^>]+>/g, '') : ''}
              url={`${APP_URL}/events/${event.id}`}
              compact
            />
            <ShareButton
              title={`${event.title} · ${formatDate(event.date)}`}
              url={`${APP_URL}/events/${event.id}`}
              cacheKey={event.coverImage ? event.coverImage.match(/\/(\d+)-/)?.[1]?.slice(-8) : undefined}
            />
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto">
        {/* Cover Image */}
        {event.coverImage ? (
          <div className="relative w-full h-44 sm:h-72 lg:h-96">
            <Image src={resolveImageUrl(event.coverImage)} alt={event.title} fill className="object-cover" sizes="100vw" priority
              style={{ objectPosition: `center ${event.coverImagePosition ?? 50}%` }} />
          </div>
        ) : (
          <div className="w-full h-44 sm:h-72 lg:h-96 bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center">
            <span className="text-8xl select-none">{event.emoji}</span>
          </div>
        )}

        <div className="lg:grid lg:grid-cols-3 lg:gap-10 px-4 lg:px-8 pt-6">
        {/* LEFT — main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* A full-width banner rather than another pill in the badge row:
              this is the one fact that changes what you can do on the page, and
              the badges beside it are all things you can still act on. */}
          {soldOut && event.status !== 'cancelled' && (
            <div className="flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3">
              <span aria-hidden="true" className="text-xl leading-none">🎟</span>
              <div>
                <p className="text-sm font-extrabold text-violet-800 uppercase tracking-wide">Sold out</p>
                <p className="text-sm text-violet-700 leading-relaxed">
                  {saidSoldOut
                    ? 'The host has closed this one. Join the waitlist and you\'ll be told if a spot frees up.'
                    : 'Every spot is taken. Join the waitlist and you\'ll be told if a spot frees up.'}
                </p>
              </div>
            </div>
          )}

          {/* Title + Meta */}
          <div>
            <EventBadges event={event} variant="outline" layout="row" className="mb-3" />
            <div className="flex items-center gap-3 flex-wrap mb-4">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
                {event.title}
              </h1>
              {event.intent === 'professional' && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900 text-white rounded-lg shadow-sm border border-zinc-800">
                  <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span className="text-[10px] font-black uppercase tracking-wider">Networking</span>
                </div>
              )}
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center gap-2.5 text-sm text-gray-600">
                <span className="text-base">📅</span>
                <span className="font-medium">{formatDate(event.date)} · {formatTime(event.time)} · {cityName} time</span>
              </div>
              {event.price > 0 && (
                <div className="flex items-center gap-2.5 text-sm text-gray-600">
                  <span className="text-base">💰</span>
                  <span className="flex items-center gap-2 flex-wrap">
                    <span>
                      <span className="font-medium">{formatPrice(event.price, event.currency)}</span>
                      <span className="text-gray-400"> · {event.payTo === 'smileys' ? 'pay in advance' : event.ticketUrl ? 'buy online' : 'pay at the venue'}</span>
                    </span>
                    {/* Advance payment is arranged over WhatsApp — a direct
                        contact when the event has one, else the group link
                        already shown to members further down the page. */}
                    {event.payTo === 'smileys' && (event.paymentContact || event.whatsappUrl) && (
                      <a
                        href={event.paymentContact
                          ? `${event.paymentContact}?text=${encodeURIComponent(`Hi! I'd like to arrange payment for "${event.title}" (${formatDate(event.date)}) 😊`)}`
                          : event.whatsappUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 hover:bg-green-100 px-2 py-0.5 rounded-full transition-colors"
                      >
                        <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                        </svg>
                        Arrange payment
                      </a>
                    )}
                    {/* External ticketing — venue-paid events only, so it
                        never competes with the in-app payment ledger. */}
                    {event.payTo !== 'smileys' && event.ticketUrl && (
                      <a
                        href={event.ticketUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 px-2 py-0.5 rounded-full transition-colors"
                      >
                        <span aria-hidden="true">🎟</span> Buy tickets ↗
                      </a>
                    )}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2.5 text-sm text-gray-600">
                <span className="text-base">📍</span>
                {canSeeLocation ? (
                  <span className="flex items-center gap-2 flex-wrap">
                    <span>{event.location}, {event.neighborhood}</span>
                    {event.meetingUrl && (
                      <a
                        href={event.meetingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-semibold bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        View on map
                      </a>
                    )}
                    {directoryBusiness && (
                      <Link
                        href={`/directory/${directoryBusiness.id}`}
                        className="inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-semibold bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full transition-colors"
                      >
                        <span aria-hidden="true">🏪</span> View in directory
                      </Link>
                    )}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span className="text-gray-400">{event.neighborhood}</span>
                    <span className="text-xs text-amber-600 font-medium bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
                      🔒 Join to see exact location
                    </span>
                  </span>
                )}
              </div>
              {event.hostName && (
                <div className="flex items-center gap-2.5 text-sm text-gray-600">
                  <span className="text-base">👤</span>
                  <span>
                    Hosted by{' '}
                    {session ? (
                      <Link href={`/members/${event.hostId}`} className="font-semibold text-gray-900 hover:text-amber-600 transition-colors">
                        {event.hostName.split(' ')[0]}
                      </Link>
                    ) : (
                      <span className="font-semibold text-gray-900">{event.hostName.split(' ')[0]}</span>
                    )}
                    {cohosts.length > 0 && (
                      <span className="text-gray-400">
                        {' '}& {cohosts.map((c, i) => (
                          <span key={c.user.id}>
                            {i > 0 && ', '}
                            {session ? (
                              <Link href={`/members/${c.user.id}`} className="font-semibold text-gray-900 hover:text-amber-600 transition-colors">
                                {c.user.name.split(' ')[0]}
                              </Link>
                            ) : (
                              <span className="font-semibold text-gray-900">{c.user.name.split(' ')[0]}</span>
                            )}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </div>
              )}
              {event.vibes.length > 0 && (
                <div className="flex items-center gap-2.5">
                  <span className="text-base">🎯</span>
                  <div className="flex flex-wrap gap-1.5">
                    {event.vibes.map(vibe => {
                      const cfg = vibeConfig[vibe]
                      return cfg ? (
                        <span key={vibe} className="group/tip relative inline-flex">
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full cursor-default ${cfg.bg} ${cfg.text}`}>
                            {cfg.emoji} {vibe}
                          </span>
                          <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 invisible opacity-0 group-hover/tip:visible group-hover/tip:opacity-100 transition-opacity duration-150">
                            <span className="block bg-gray-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">{cfg.description}</span>
                            <span className="block w-2 h-2 bg-gray-900 rotate-45 mx-auto -mt-1" />
                          </span>
                        </span>
                      ) : null
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Capacity bar — mobile only */}
          <div className="lg:hidden bg-white rounded-2xl shadow-card p-4">
            <div className="flex items-center justify-between mb-2 text-sm">
              <span className="font-semibold text-gray-900">👥 {totalAttendeeCount} / {event.totalSpots} going</span>
              {event.limitedSpots && event.spotsLeft <= 5 && event.spotsLeft > 0 && (
                <span className="text-xs font-semibold text-red-500">⚡ {event.spotsLeft} spots left</span>
              )}
              {soldOut && (
                <span className="text-xs font-semibold text-violet-600">{saidSoldOut ? 'Sold out' : 'Full'}</span>
              )}
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${fillPercent}%`, backgroundColor: fillPercent >= 85 ? '#ef4444' : fillPercent >= 65 ? '#f97316' : '#f59e0b' }}
              />
            </div>
          </div>

          {/* Gender breakdown — mobile only */}
          {event.genderBalance && (
            <div className="lg:hidden bg-white rounded-2xl shadow-card p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Gender balance</p>
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>♀ Female</span>
                    <span className="font-semibold text-pink-600">{femaleCount} going</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-pink-400 rounded-full transition-all"
                      style={{ width: `${Math.min(100, femaleCapacity > 0 ? (femaleCount / femaleCapacity) * 100 : 0)}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>♂ Male</span>
                    <span className={`font-semibold ${maleIsFull ? 'text-red-500' : 'text-blue-600'}`}>
                      {maleCount}{effectiveMaleQuota ? ` / ${effectiveMaleQuota} max` : ' going'}
                    </span>
                  </div>
                  <div className="relative">
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all bg-blue-400`}
                        style={{ width: `${Math.min(100, effectiveMaleQuota ? (maleCount / effectiveMaleQuota) * 100 : 0)}%` }} />
                    </div>
                    {maleIsFull && (
                      <span className="absolute -top-0.5 right-0 text-[10px] font-bold text-white bg-red-500 px-1 py-0.5 rounded leading-none">FULL</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* WhatsApp — mobile only, inline */}
          {whatsappLink && canSeeLocation && (
            <div className="lg:hidden">
              <a
                href={whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl bg-[#25D366] hover:bg-[#1ebe5d] text-white text-sm font-semibold transition-colors"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                {clubWhatsappUrl ? 'Join Club WhatsApp Group' : 'Join WhatsApp Group'}
              </a>
            </div>
          )}

          <hr className="border-gray-100" />

          {/* Live Status — show from 2h before start through 4h after.
              Earlier shape was "anywhere on event day" which fired
              "Live Now" at 6am for an 8pm event. Start time is the event
              city's wall clock, resolved through its timezone. Cancelled
              events are gated out entirely — the status banner /
              strikethrough already tells the story. */}
          {(() => {
            if (event.status === 'cancelled') return null
            const eventStartMs = fromWallClockInTz(`${event.date}T${event.time}`, eventTz).getTime()
            const nowMs        = Date.now()
            const showLive     = Number.isFinite(eventStartMs)
              && nowMs >= eventStartMs - 2 * 60 * 60_000
              && nowMs <  eventStartMs + 4 * 60 * 60_000
            if (!showLive) return null
            return (
              <div className="bg-green-50 border border-green-100 rounded-2xl p-4 mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                  </span>
                  <span className="text-sm font-bold text-green-900 uppercase tracking-wider">Live Now</span>
                </div>
                <div className="text-sm font-semibold text-green-800">
                  {checkedInCount > 0 ? (
                    <span>✨ {checkedInCount} arrived</span>
                  ) : (
                    <span className="opacity-60 italic">Waiting for arrivals...</span>
                  )}
                </div>
              </div>
            )
          })()}

          {/* About */}
          <div>
            <h2 className="text-base font-bold text-gray-900 mb-3">About this event</h2>
            <div className="rich-content text-sm text-gray-600 leading-relaxed" dangerouslySetInnerHTML={{ __html: sanitize(event.description ?? '') }} />

            {canSeeLocation && mapsHref && (
              <div className="mt-6 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-gray-900">Location</h2>
                  <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-600 font-bold underline underline-offset-2">
                    {event.meetingUrl ? 'Join online →' : 'Get directions →'}
                  </a>
                </div>
                {/* Map only when we have coordinates; the directions link above
                    works for address/location-only events too. */}
                {hasCoords && <EventLocationMap lat={event.lat!} lng={event.lng!} href={mapsHref} />}
              </div>
            )}

            {(event.isPremium || event.membersOnly) && event.memberPrice !== undefined && (
              <div className="mt-4 flex items-center justify-between p-4 rounded-xl bg-violet-50 border border-violet-200">
                <div>
                  <p className="text-xs font-semibold text-violet-600">Member price</p>
                  <p className="text-xl font-extrabold text-violet-700">{event.memberPrice === 0 ? 'Free' : formatPrice(event.memberPrice, event.currency)}</p>
                </div>
                {!event.membersOnly && (
                  <div className="text-right">
                    <p className="text-xs text-gray-400">Guest price</p>
                    <p className="text-sm text-gray-400 line-through">{formatPrice(event.price, event.currency)}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <hr className="border-gray-100" />

          {/* §26 — shared context with the people already going. Shown to
              everyone signed in, including members who haven't RSVP'd:
              this is precisely the information that turns "maybe" into
              "I'm in". Only reveals overlap with what the viewer already
              knows about themselves. */}
          {attendeeContext.length > 0 && (
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
              <p className="text-sm font-extrabold text-amber-900 mb-2">
                You&apos;ll know some people 👋
              </p>
              <ul className="space-y-1.5">
                {attendeeContext.slice(0, 3).map(({ user, ctx }) => {
                  const bits: string[] = []
                  if (ctx!.clubs.length > 0) bits.push(ctx!.clubs.map(c => c.name).slice(0, 2).join(', '))
                  if (ctx!.neighborhood) bits.push(`also around ${ctx!.neighborhood}`)
                  if (bits.length === 0 && ctx!.interests.length > 0) bits.push(`also into ${ctx!.interests[0]}`)
                  return (
                    <li key={user.id} className="text-sm text-gray-800">
                      <Link href={`/members/${user.id}`} className="font-bold text-amber-800 hover:underline">
                        {user.name.split(' ')[0]}
                      </Link>
                      {bits.length > 0 && <span className="text-gray-600"> — {bits.join(' · ')}</span>}
                    </li>
                  )
                })}
              </ul>
              {attendeeContext.length > 3 && (
                <p className="text-xs text-amber-700 font-semibold mt-2">
                  +{attendeeContext.length - 3} more you have something in common with
                </p>
              )}
            </div>
          )}

          {/* §30/§31 — plans and conversation around this event, both
              canonical records elsewhere. Silent when there are none. */}
          <EventConnections eventId={id} />

          {/* Attendees — full list only for attendees/host/admin; count only for others */}
          {totalAttendeeCount > 0 && (
            <div>
              <h2 className="text-base font-bold text-gray-900 mb-3">
                Attendees <span className="text-gray-400 font-normal">({totalAttendeeCount})</span>
              </h2>
              {!isAdmin && !isHost && myAttendance?.status !== 'approved' ? (
                <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-2xl">
                  <div className="flex -space-x-2">
                    {attendees.slice(0, 5).map(a => {
                      // #7 perf: 64-wide thumb — image is blurred + 36px CSS,
                      // no benefit to larger sizes.
                      const photo = avatarUrl(a.user.profilePhoto, 64)
                      return photo ? (
                        <img key={a.user.id} src={photo} alt="" loading="lazy" decoding="async" className="w-9 h-9 rounded-full object-cover border-2 border-white blur-sm" />
                      ) : (
                        <div key={a.user.id} className="w-9 h-9 rounded-full border-2 border-white blur-sm" style={{ backgroundColor: a.user.color }} />
                      )
                    })}
                  </div>
                  <p className="text-sm text-gray-600"><span className="font-semibold text-gray-700">{totalAttendeeCount} people</span> are going. RSVP to see who.</p>
                </div>
              ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {attendees.map(a => {
                  // #7 perf: 128-wide thumb for the attendees grid
                  // (w-12 css = 48px, retina ~96px).
                  const photo = avatarUrl(a.user.profilePhoto, 128)
                  return (
                    <Link key={a.user.id} href={`/members/${a.user.id}`}
                      className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-gray-50 transition-colors group">
                      {photo ? (
                        <img src={photo} alt={a.user.name} loading="lazy" decoding="async"
                          className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-sm" />
                      ) : (
                        <div className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold text-white border-2 border-white shadow-sm"
                          style={{ backgroundColor: a.user.color }}>
                          {a.user.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <span className="text-xs text-gray-600 group-hover:text-amber-600 transition-colors text-center truncate w-full leading-tight flex items-center justify-center gap-0.5">
                        {a.user.name.split(' ')[0]}
                        {!restrictedAttendees.has(a.user.id) && countryFlag((a.user as any).nationality) && (
                          <span className="text-xs">{countryFlag((a.user as any).nationality)}</span>
                        )}
                      </span>
                    </Link>
                  )
                })}
                {totalAttendeeCount > attendees.length && (
                  <div className="flex flex-col items-center gap-1.5 p-2">
                    <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600 border-2 border-white shadow-sm">
                      +{totalAttendeeCount - attendees.length}
                    </div>
                    <span className="text-xs text-gray-400">more</span>
                  </div>
                )}
              </div>
              )}
            </div>
          )}

          {attendees.length > 0 && <hr className="border-gray-100" />}

          {/* Waitlist */}
          {waitlisted.total > 0 && (
            <div>
              <h2 className="text-base font-bold text-gray-900 mb-3">
                Waitlist <span className="text-gray-400 font-normal">({waitlisted.total})</span>
              </h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {waitlisted.users.map(u => {
                  const photo = avatarUrl(u.profilePhoto, 128)
                  const flag  = countryFlag(u.nationality)
                  return (
                    <Link key={u.id} href={`/members/${u.id}`}
                      className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-gray-50 transition-colors group">
                      {photo ? (
                        <img src={photo} alt={u.name} loading="lazy" decoding="async"
                          className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-sm opacity-60" />
                      ) : (
                        <div className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold text-white border-2 border-white shadow-sm opacity-60"
                          style={{ backgroundColor: u.color }}>
                          {u.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <span className="text-xs text-gray-600 group-hover:text-amber-600 transition-colors text-center truncate w-full leading-tight flex items-center justify-center gap-0.5">
                        {u.name.split(' ')[0]}
                        {flag && <span className="text-xs">{flag}</span>}
                      </span>
                    </Link>
                  )
                })}
              </div>
              {waitlisted.total > waitlisted.users.length && (
                <p className="text-xs text-gray-400 mt-2">
                  +{waitlisted.total - waitlisted.users.length} more
                </p>
              )}
            </div>
          )}

          {waitlisted.total > 0 && <hr className="border-gray-100" />}

          {/* Club — mobile only */}
          {club && (
            <div className="lg:hidden">
              <h2 className="text-base font-bold text-gray-900 mb-3">Club</h2>
              <Link
                href={`/clubs/${club.slug}`}
                className="flex items-center gap-3 p-4 bg-white rounded-2xl shadow-card hover:shadow-card-hover transition-shadow group"
              >
                <div className={`w-12 h-12 rounded-xl ${club.bgColor} flex items-center justify-center text-2xl shrink-0`}>
                  {club.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 group-hover:text-amber-600 transition-colors">{club.name}</p>
                  <p className="text-xs text-gray-400">{club.memberCount} members</p>
                </div>
                <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          )}

          {club && <hr className="border-gray-100 lg:hidden" />}

          {/* Photos */}
          <EventPhotos
            eventId={event.id}
            photos={eventPhotos}
            canUpload={isPast && !!(session && (isAdmin || isHost || (myAttendance?.status === 'approved')))}
            currentUserId={session?.id}
          />

          {/* Recap link — past events only */}
          {isPast && (
            <Link href={`/events/${event.id}/recap`}
              className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4 hover:bg-amber-100 transition-colors group">
              <span className="text-2xl">🎉</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-900">View event recap</p>
                <p className="text-xs text-amber-700">Photos, check-in stats, and who was there</p>
              </div>
              <svg className="w-4 h-4 text-amber-500 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}

          {/* Reviews (past events) */}
          <EventReviews eventId={event.id} isPast={isPast} />

          {/* Discussion */}
          <EventMessages eventId={event.id} eventDate={event.date} />

          {/* Similar events — placed after member-generated content
              so "you might also like…" doesn't interrupt the
              Reviews → Discussion flow. */}
          {event.cityId && <SimilarEvents eventId={event.id} vibes={event.vibes ?? []} neighborhood={event.neighborhood} date={event.date} cityId={event.cityId} />}

          {/* Report */}
          <div className="flex justify-center pt-2 pb-6">
            <ReportButton reportedId={event.hostId} reportedName={event.hostName || 'the host'} eventId={event.id} />
          </div>
        </div>

        {/* RIGHT — sticky sidebar (desktop only) */}
        <div className="hidden lg:block">
          <div className="sticky top-28 space-y-4">
            {/* Capacity */}
            <div className="bg-white rounded-2xl shadow-card p-5">
              <div className="flex items-center justify-between mb-2 text-sm">
                <span className="font-semibold text-gray-900">👥 {totalAttendeeCount} / {event.totalSpots} going</span>
                {event.limitedSpots && event.spotsLeft <= 5 && event.spotsLeft > 0 && (
                  <span className="text-xs font-semibold text-red-500">⚡ {event.spotsLeft} left</span>
                )}
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-4">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${fillPercent}%`, backgroundColor: fillPercent >= 85 ? '#ef4444' : fillPercent >= 65 ? '#f97316' : '#f59e0b' }} />
              </div>
              {/* Social proof — who's going */}
              {totalAttendeeCount > 0 && (
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="flex -space-x-2 shrink-0">
                    {attendees.slice(0, 4).map(a => {
                      const photo = avatarUrl(a.user.profilePhoto, 64)
                      return photo ? (
                        <img key={a.user.id} src={photo} alt={a.user.name} loading="lazy" decoding="async"
                          className={`w-8 h-8 rounded-full object-cover border-2 border-white ${!isAdmin && !isHost && myAttendance?.status !== 'approved' ? 'blur-sm' : ''}`} />
                      ) : (
                        <div key={a.user.id} className={`w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-white text-[10px] font-bold ${!isAdmin && !isHost && myAttendance?.status !== 'approved' ? 'blur-sm' : ''}`}
                          style={{ backgroundColor: a.user.color }}>
                          {!isAdmin && !isHost && myAttendance?.status !== 'approved' ? '' : getInitials(a.user.name)}
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-xs text-gray-600 leading-snug">
                    {isAdmin || isHost || myAttendance?.status === 'approved' ? (
                      <>
                        <span className="font-semibold text-gray-800">
                          {attendees.slice(0, 2).map(a => a.user.name.split(' ')[0]).join(', ')}
                        </span>
                        {totalAttendeeCount > 2 && ` and ${totalAttendeeCount - 2} others`} going
                      </>
                    ) : (
                      <><span className="font-semibold text-gray-800">{totalAttendeeCount} people</span> going — RSVP to see who</>
                    )}
                  </p>
                </div>
              )}
              <RSVPButton
                eventId={event.id}
                hostId={event.hostId}
                spotsLeft={event.spotsLeft}
                soldOut={soldOut}
                price={event.price}
                memberPrice={event.memberPrice}
                membersOnly={event.membersOnly}
                currency={event.currency}
                payTo={event.payTo}
              />
              {myAttendance?.status === 'approved' && !isPast && (
                <div className="mt-2">
                  <AddToCalendar
                    title={event.title}
                    date={event.date}
                    time={event.time}
                    timeZone={eventTz}
                endTime={event.endTime}
                    location={event.location ?? event.neighborhood ?? ''}
                    description={event.description ? event.description.replace(/<[^>]+>/g, '') : ''}
                    url={`${APP_URL}/events/${event.id}`}
                  />
                </div>
              )}
              {whatsappLink && canSeeLocation && (
                <a href={whatsappLink} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 mt-2 rounded-xl bg-[#25D366] hover:bg-[#1ebe5d] text-white text-sm font-semibold transition-colors">
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  {clubWhatsappUrl ? 'Join Club WhatsApp Group' : 'Join WhatsApp Group'}
                </a>
              )}
            </div>

            {/* Club */}
            {club && (
              <Link href={`/clubs/${club.slug}`}
                className="flex items-center gap-3 p-4 bg-white rounded-2xl shadow-card hover:shadow-card-hover transition-shadow group">
                <div className={`w-12 h-12 rounded-xl ${club.bgColor} flex items-center justify-center text-2xl shrink-0`}>
                  {club.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 group-hover:text-amber-600 transition-colors">{club.name}</p>
                  <p className="text-xs text-gray-400">{club.memberCount} members</p>
                </div>
                <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            )}

            {/* §35 — Save sits beside Share as the quiet "maybe later"
                action; it must never compete with the Join CTA. */}
            {!isPast && (
              <div className="flex justify-end">
                <EventSaveButton eventId={event.id} initialSaved={savedByViewer} />
              </div>
            )}

            <SocialShare
              title={event.title}
              url={`${APP_URL}/events/${event.id}`}
              cacheKey={event.coverImage ? event.coverImage.match(/\/(\d+)-/)?.[1]?.slice(-8) : undefined}
            />

            {/* Invite friends — shown to attendees and host */}
            {(isHost || (myAttendance?.status === 'approved')) && !isPast && (
              <EventInviteButton
                eventId={event.id}
                eventTitle={event.title}
                userId={session.id}
              />
            )}

            {/* Gender balance */}
            {event.genderBalance && (
              <div className="bg-white rounded-2xl shadow-card p-5 space-y-3">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Gender balance</p>
                <div>
                  <div className="flex justify-between text-xs mb-1"><span>♀ Female</span><span className="font-semibold text-pink-600">{femaleCount} going</span></div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-pink-400 rounded-full" style={{ width: `${Math.min(100, femaleCapacity > 0 ? (femaleCount / femaleCapacity) * 100 : 0)}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1"><span>♂ Male</span><span className={`font-semibold ${maleIsFull ? 'text-red-500' : 'text-blue-600'}`}>{maleCount}{effectiveMaleQuota ? ` / ${effectiveMaleQuota} max` : ' going'}</span></div>
                  <div className="relative">
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full bg-blue-400`} style={{ width: `${Math.min(100, effectiveMaleQuota ? (maleCount / effectiveMaleQuota) * 100 : 0)}%` }} />
                    </div>
                    {maleIsFull && (
                      <span className="absolute -top-0.5 right-0 text-[10px] font-bold text-white bg-red-500 px-1 py-0.5 rounded leading-none">FULL</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* Sticky RSVP bar — mobile/tablet only */}
      {!isPast && (
        <div className="fixed bottom-16 md:bottom-0 left-0 right-0 z-40 lg:hidden bg-white/95 backdrop-blur-sm border-t border-gray-100 px-4 pt-3 pb-3 safe-area-pb shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <RSVPButton
            eventId={event.id}
            hostId={event.hostId}
            spotsLeft={event.spotsLeft}
            price={event.price}
            memberPrice={event.memberPrice}
            membersOnly={event.membersOnly}
            currency={event.currency}
            payTo={event.payTo}
          />
        </div>
      )}
    </div>
  )
}
