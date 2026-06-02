import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { getEventById } from '@/lib/db'
import { formatDate, formatTime, vibeConfig, resolveImageUrl, avatarUrl } from '@/lib/data'
import { countryFlag } from '@/lib/countries'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { SITE_URL, APP_URL } from '@/lib/env'
import RSVPButton from '@/components/RSVPButton'
import EventMessages from '@/components/EventMessages'
import EventReviews from '@/components/EventReviews'
import EventPhotos from '@/components/EventPhotos'
import SimilarEvents from '@/components/SimilarEvents'
import ReportButton from '@/components/ReportButton'
import ShareButton from '@/components/ShareButton'
import SocialShare from '@/components/SocialShare'
import EventInviteButton from '@/components/EventInviteButton'
import AddToCalendar from '@/components/AddToCalendar'
import EventLocationMap from '@/components/EventLocationMap'
import { sanitize } from '@/lib/sanitize'

export const dynamic = 'force-dynamic'

function absoluteImageUrl(coverImage: string | null | undefined): string {
  if (!coverImage) return `${APP_URL}/api/og`
  const resolved = resolveImageUrl(coverImage)
  if (resolved.startsWith('http')) return resolved
  return `${SITE_URL}${resolved}`
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const event = await getEventById(id)
  if (!event) return {}

  const title       = `${event.title} — Smileys Community`
  const plainDesc   = event.description
    ? event.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 155)
    : `${formatDate(event.date)} · ${event.location || event.neighborhood} · Join us at Smileys Community Istanbul`
  const description = plainDesc
  const imageUrl    = absoluteImageUrl(event.coverImage)
  const pageUrl     = `${APP_URL}/events/${id}`

  return {
    title,
    description,
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
  const event = await getEventById(id)
  if (!event) notFound()

  const today  = new Date().toISOString().split('T')[0]
  const isPast = event.date < today

  const session = await getSession()

  if (!session) {
    const coverUrl = event.coverImage ? absoluteImageUrl(event.coverImage) : null
    return (
      <div className="min-h-screen bg-warm flex flex-col">
        {coverUrl && (
          <div className="relative w-full h-52 sm:h-72 shrink-0">
            <Image src={resolveImageUrl(event.coverImage!)} alt={event.title} fill className="object-cover" sizes="100vw" priority
              style={{ objectPosition: `center ${event.coverImagePosition ?? 50}%` }} />
            <div className="absolute inset-0 bg-gradient-to-b from-black/20 to-black/60" />
          </div>
        )}
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center max-w-md mx-auto w-full">
          <div className={`text-6xl mb-4 ${!coverUrl ? 'mt-12' : ''}`}>{event.emoji}</div>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-2">{event.title}</h1>
          <p className="text-sm text-gray-500 mb-6">
            {formatDate(event.date)} · {event.neighborhood}
          </p>
          <div className="bg-white rounded-2xl shadow-card p-6 w-full space-y-4">
            <p className="text-sm font-semibold text-gray-700">🔒 Members only</p>
            <p className="text-sm text-gray-500">You need to be an approved Smileys member to view event details.</p>
            <Link href="/login"
              className="block w-full py-3 rounded-xl bg-amber-400 hover:bg-amber-500 text-white font-bold text-sm transition-colors text-center">
              Log in
            </Link>
            <Link href="/apply"
              className="block w-full py-3 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold text-sm transition-colors text-center">
              Apply to join
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

  const [attendees, totalAttendeeCount, waitlisted, club, myAttendance, eventPhotos] = await Promise.all([
    prisma.eventAttendee.findMany({
      where: { eventId: id, status: 'approved', stealth: false, userId: { notIn: [event.hostId, ...cohostIds] } },
      orderBy: { joinedAt: 'asc' },
      select: { user: { select: { id: true, name: true, color: true, profilePhoto: true, gender: true, nationality: true } } },
    }),
    prisma.eventAttendee.count({
      where: { eventId: id, status: 'approved', userId: { notIn: [event.hostId, ...cohostIds] } },
    }),
    prisma.waitlistEntry.findMany({
      where: { eventId: id },
      take: 12,
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    }).then(async entries => {
      if (!entries.length) return []
      return prisma.user.findMany({
        where: { id: { in: entries.map(e => e.userId) } },
        select: { id: true, name: true, color: true, profilePhoto: true, nationality: true },
      })
    }),
    event.clubId
      ? prisma.club.findFirst({ where: { id: event.clubId } })
      : null,
    session && !isAdmin && !isHost
      ? prisma.eventAttendee.findUnique({
          where: { userId_eventId: { userId: session.id, eventId: id } },
        })
      : null,
    prisma.eventPhoto.findMany({
      where: { eventId: id },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
    }),
  ])
  const cohosts = cohostRecords

  const hasCoords    = event.lat != null && event.lng != null
  const mapsHref      = event.meetingUrl
    ?? (event.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address + ', Istanbul')}`
      : hasCoords
      ? `https://www.google.com/maps/search/?api=1&query=${event.lat},${event.lng}`
      : undefined)

  const fillPercent = event.totalSpots > 0 ? (totalAttendeeCount / event.totalSpots) * 100 : 0
  const canSeeLocation = true
  const femaleCount = attendees.filter(a => a.user.gender === 'female').length
  const maleCount   = attendees.filter(a => a.user.gender === 'male').length
  const maleQuota          = event.maleQuota ?? Math.floor(event.totalSpots / 2)
  const turkishMaleCount   = event.turkishMaleQuota
    ? attendees.filter(a => (a.user as any).nationality === 'Turkey' && a.user.gender === 'male').length
    : 0

  // Build JSON-LD Event schema
  const eventUrl   = `${APP_URL}/events/${id}`
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    description: event.description
      ? event.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
      : `${event.emoji} ${event.title} in ${event.neighborhood}, Istanbul`,
    startDate: `${event.date}T${event.time ?? '00:00'}:00+03:00`,
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
          name:    event.location || event.neighborhood || 'Istanbul',
          address: {
            '@type':           'PostalAddress',
            streetAddress:     event.address ?? event.location ?? '',
            addressLocality:   'Istanbul',
            addressCountry:    'TR',
          },
        },
    image:     absoluteImageUrl(event.coverImage) || undefined,
    url:       eventUrl,
    offers: {
      '@type':       'Offer',
      price:         String(event.price ?? 0),
      priceCurrency: event.currency ?? 'TRY',
      availability:  event.spotsLeft === 0
        ? 'https://schema.org/SoldOut'
        : 'https://schema.org/InStock',
      url: eventUrl,
    },
    organizer: {
      '@type': 'Organization',
      name:    'Smileys Community',
      url:     SITE_URL,
    },
  }

  return (
    <div className="min-h-screen bg-warm pb-36 md:pb-28 lg:pb-10">
      <script
        type="application/ld+json"
        // JSON.stringify does NOT escape `<` so a host putting
        // `</script><script>alert(1)` in event.title (or any other
        // user-controlled field that lands in jsonLd above) would
        // break out of this script tag — stored XSS. Escape `<`
        // and the unicode line separators U+2028 / U+2029 (which
        // terminate JS string literals).
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd)
            .replace(/</g, '\\u003c')
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029'),
        }}
      />
      {/* Back */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/events" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
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
              location={event.location ?? event.neighborhood ?? ''}
              description={event.description ? event.description.replace(/<[^>]+>/g, '') : ''}
              url={`${APP_URL}/events/${event.id}`}
              compact
            />
            <ShareButton
              title={event.title}
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
          {/* Title + Meta */}
          <div>
            <div className="flex flex-wrap gap-2 mb-3">
              {event.membersOnly && (
                <span className="group/tip relative inline-flex">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full cursor-default">
                    🔒 Members only
                  </span>
                  <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 invisible opacity-0 group-hover/tip:visible group-hover/tip:opacity-100 transition-opacity duration-150">
                    <span className="block bg-gray-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">Exclusive to approved Smileys members</span>
                    <span className="block w-2 h-2 bg-gray-900 rotate-45 mx-auto -mt-1" />
                  </span>
                </span>
              )}
              {event.isPremium && !event.membersOnly && (
                <span className="group/tip relative inline-flex">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full cursor-default">
                    ♛ Premium
                  </span>
                  <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 invisible opacity-0 group-hover/tip:visible group-hover/tip:opacity-100 transition-opacity duration-150">
                    <span className="block bg-gray-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">Curated premium experience for vetted members</span>
                    <span className="block w-2 h-2 bg-gray-900 rotate-45 mx-auto -mt-1" />
                  </span>
                </span>
              )}
              {event.genderBalance && (
                <span className="group/tip relative inline-flex">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-pink-700 bg-pink-50 border border-pink-200 px-2 py-0.5 rounded-full cursor-default">
                    ⚖️ Gender balanced
                  </span>
                  <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 invisible opacity-0 group-hover/tip:visible group-hover/tip:opacity-100 transition-opacity duration-150">
                    <span className="block bg-gray-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">Spots split equally between men & women for a balanced mix</span>
                    <span className="block w-2 h-2 bg-gray-900 rotate-45 mx-auto -mt-1" />
                  </span>
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight mb-4">
              {event.title}
            </h1>

            <div className="space-y-2.5">
              <div className="flex items-center gap-2.5 text-sm text-gray-600">
                <span className="text-base">📅</span>
                <span className="font-medium">{formatDate(event.date)} · {formatTime(event.time)}</span>
              </div>
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
              {event.spotsLeft === 0 && event.limitedSpots && (
                <span className="text-xs font-semibold text-red-500">Full</span>
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
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Gender balance</p>
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>♀ Female</span>
                    <span className="font-semibold text-pink-600">{femaleCount} going</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-pink-400 rounded-full transition-all"
                      style={{ width: `${Math.min(100, event.totalSpots > 0 ? (femaleCount / event.totalSpots) * 100 : 0)}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>♂ Male</span>
                    <span className={`font-semibold ${maleCount >= maleQuota ? 'text-red-500' : 'text-blue-600'}`}>
                      {maleCount} / {maleQuota} max
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-400 rounded-full transition-all"
                      style={{ width: `${Math.min(100, maleQuota > 0 ? (maleCount / maleQuota) * 100 : 0)}%` }} />
                  </div>
                  {maleCount >= maleQuota && (
                    <p className="text-xs text-red-500 mt-1">Male spots full — waitlist only</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* WhatsApp — mobile only, inline */}
          {event.whatsappUrl && canSeeLocation && (
            <div className="lg:hidden">
              <a
                href={event.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl bg-[#25D366] hover:bg-[#1ebe5d] text-white text-sm font-semibold transition-colors"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Join WhatsApp Group
              </a>
            </div>
          )}

          <hr className="border-gray-100" />

          {/* About */}
          <div>
            <h2 className="text-base font-bold text-gray-900 mb-3">About this event</h2>
            <div className="rich-content text-sm text-gray-600 leading-relaxed" dangerouslySetInnerHTML={{ __html: sanitize(event.description ?? '') }} />

            {hasCoords && canSeeLocation && (
              <div className="mt-6 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-gray-900">Location</h2>
                  {mapsHref && (
                    <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-600 font-bold hover:underline">
                      View on Google Maps →
                    </a>
                  )}
                </div>
                <EventLocationMap lat={event.lat!} lng={event.lng!} href={mapsHref} />
              </div>
            )}

            {(event.isPremium || event.membersOnly) && event.memberPrice !== undefined && (
              <div className="mt-4 flex items-center justify-between p-4 rounded-xl bg-violet-50 border border-violet-200">
                <div>
                  <p className="text-xs font-semibold text-violet-600">Member price</p>
                  <p className="text-xl font-extrabold text-violet-700">{event.memberPrice === 0 ? 'Free' : `₺${event.memberPrice}`}</p>
                </div>
                {!event.membersOnly && (
                  <div className="text-right">
                    <p className="text-xs text-gray-400">Guest price</p>
                    <p className="text-sm text-gray-400 line-through">₺{event.price}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <hr className="border-gray-100" />

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
                  <p className="text-sm text-gray-500"><span className="font-semibold text-gray-700">{totalAttendeeCount} people</span> are going. RSVP to see who.</p>
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
                        {countryFlag((a.user as any).nationality) && (
                          <span className="text-xs">{countryFlag((a.user as any).nationality)}</span>
                        )}
                      </span>
                    </Link>
                  )
                })}
                {totalAttendeeCount > attendees.length && (
                  <div className="flex flex-col items-center gap-1.5 p-2">
                    <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-500 border-2 border-white shadow-sm">
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
          {waitlisted.length > 0 && (
            <div>
              <h2 className="text-base font-bold text-gray-900 mb-3">
                Waitlist <span className="text-gray-400 font-normal">({waitlisted.length})</span>
              </h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {waitlisted.map(u => {
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
                      <span className="text-xs text-gray-400 group-hover:text-amber-600 transition-colors text-center truncate w-full leading-tight flex items-center justify-center gap-0.5">
                        {u.name.split(' ')[0]}
                        {flag && <span className="text-xs">{flag}</span>}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}

          {waitlisted.length > 0 && <hr className="border-gray-100" />}

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

          {/* Similar events */}
          <SimilarEvents eventId={event.id} vibes={event.vibes ?? []} neighborhood={event.neighborhood} date={event.date} />

          {/* Discussion */}
          <EventMessages eventId={event.id} />

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
              <RSVPButton
                eventId={event.id}
                hostId={event.hostId}
                spotsLeft={event.spotsLeft}
                price={event.price}
                memberPrice={event.memberPrice}
                membersOnly={event.membersOnly}
                currency={event.currency}
              />
              {event.whatsappUrl && canSeeLocation && (
                <a href={event.whatsappUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 mt-2 rounded-xl bg-[#25D366] hover:bg-[#1ebe5d] text-white text-sm font-semibold transition-colors">
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  Join WhatsApp Group
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
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Gender balance</p>
                <div>
                  <div className="flex justify-between text-xs mb-1"><span>♀ Female</span><span className="font-semibold text-pink-600">{femaleCount} going</span></div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-pink-400 rounded-full" style={{ width: `${Math.min(100, event.totalSpots > 0 ? (femaleCount / event.totalSpots) * 100 : 0)}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1"><span>♂ Male</span><span className={`font-semibold ${maleCount >= maleQuota ? 'text-red-500' : 'text-blue-600'}`}>{maleCount} / {maleQuota} max</span></div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min(100, maleQuota > 0 ? (maleCount / maleQuota) * 100 : 0)}%` }} />
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
          />
        </div>
      )}
    </div>
  )
}
