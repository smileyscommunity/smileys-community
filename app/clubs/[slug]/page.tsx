import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { getClubBySlug, getEventsByClub } from '@/lib/db'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { SITE_URL, APP_URL } from '@/lib/env'
import { resolveImageUrl, avatarUrl } from '@/lib/data'
import { loadCommunitySettings, communityInstagramUrl, communityWhatsappUrl } from '@/lib/communitySettings'
import ClubJoinWidget from './ClubJoinWidget'
import ClubTabs from './ClubTabs'
import SocialShare from '@/components/SocialShare'
import ClubSpotlight from '@/components/ClubSpotlight'
import ClubRulesEditor from '@/components/ClubRulesEditor'
import ClubResources from '@/components/ClubResources'

export const dynamic = 'force-dynamic'

function absoluteImageUrl(coverImage: string | null | undefined): string {
  if (!coverImage) return `${APP_URL}/api/og`
  const resolved = resolveImageUrl(coverImage)
  if (resolved.startsWith('http')) return resolved
  return `${SITE_URL}${resolved}`
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const club = await getClubBySlug(slug)
  if (!club) return {}

  const title       = `${club.name} — Smileys Community`
  const description = club.description
    ? club.description.slice(0, 155)
    : `Join ${club.name} on Smileys Community. Istanbul's curated social life platform.`
  const imageUrl    = absoluteImageUrl(club.coverImage)
  const pageUrl     = `${APP_URL}/clubs/${slug}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: 'Smileys Community',
      images: [{ url: imageUrl, secureUrl: imageUrl, width: 1200, height: 630, alt: club.name }],
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

export default async function ClubDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const club = await getClubBySlug(slug)
  if (!club) notFound()

  const clubEvents = await getEventsByClub(club.id)

  const today = new Date().toISOString().split('T')[0]
  const [totalEventCount, lastEvent, reviewStats] = await Promise.all([
    prisma.event.count({ where: { clubId: club.id, status: { not: 'draft' } } }),
    prisma.event.findFirst({
      where: { clubId: club.id, date: { lt: today }, status: { in: ['published', 'archived', 'cancelled'] } },
      orderBy: { date: 'desc' },
      select: { date: true },
    }),
    // Aggregate reviews across all events in this club — mirrors the
    // same filter the /api/clubs/[slug]/reviews route uses, so the
    // count + avg in the tab badge match what the Reviews tab shows
    // once opened.
    prisma.review.aggregate({
      where: { event: { clubId: club.id } },
      _count: { _all: true },
      _avg:   { rating: true },
    }),
  ])

  const hosts = await prisma.clubMembership.findMany({
    where: { clubId: club.id, role: 'host', status: 'approved' },
    select: {
      user: { select: { id: true, name: true, color: true, profilePhoto: true, bio: true } },
    },
  })

  // Community-wide social channels — pulled from /admin/settings'
  // settings.json snapshot. Surfaced as a secondary "Follow Smileys"
  // block on every club page so members can find the parent community
  // channels even when the club itself hasn't set its own URLs.
  const communitySettings = loadCommunitySettings()
  const communityIg = communityInstagramUrl(communitySettings.instagram)
  const communityWa = communityWhatsappUrl(communitySettings.whatsapp)

  const session = await getSession()
  let membershipStatus: 'approved' | 'pending' | null = null
  let isClubHost = false
  if (session) {
    const m = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { status: true, role: true },
    })
    if (m?.status === 'approved' || m?.status === 'pending') {
      membershipStatus = m.status
    }
    isClubHost = m?.role === 'host' && m?.status === 'approved'
  }

  const isPrivileged = session?.role === 'admin' || session?.role === 'moderator'
  const canSeeMemberContent = membershipStatus === 'approved' || isPrivileged
  const canPost = membershipStatus === 'approved' || isPrivileged
  const canPin  = isClubHost || isPrivileged
  const canAnnounce = isClubHost || isPrivileged
  const canUpload = canPost

  const [resources, spotlightData, memberAttendeesByEvent] = await Promise.all([
    prisma.clubResource.findMany({ where: { clubId: club.id }, orderBy: { order: 'asc' } }),
    (club as any).spotlightUserId
      ? prisma.user.findUnique({
          where: { id: (club as any).spotlightUserId },
          select: { id: true, name: true, color: true, profilePhoto: true, bio: true },
        })
      : Promise.resolve(null),
    (async () => {
      const eventIds = clubEvents.map((e: any) => e.id)
      if (!eventIds.length) return {}
      const memberIds = (await prisma.clubMembership.findMany({
        where: { clubId: club.id, status: 'approved' },
        select: { userId: true },
      })).map(m => m.userId)
      if (!memberIds.length) return {}
      const attendees = await prisma.eventAttendee.findMany({
        where: { eventId: { in: eventIds }, status: 'approved', userId: { in: memberIds } },
        select: { eventId: true, user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
      })
      const map: Record<string, any[]> = {}
      for (const a of attendees) {
        if (!map[a.eventId]) map[a.eventId] = []
        if (map[a.eventId].length < 6) map[a.eventId].push({ ...a.user, photo: a.user.profilePhoto })
      }
      return map
    })(),
  ])

  const spotlightUser = spotlightData
    ? {
        userId:    spotlightData.id,
        name:      spotlightData.name,
        color:     spotlightData.color,
        photo:     spotlightData.profilePhoto,
        bio:       spotlightData.bio,
        note:      (club as any).spotlightNote ?? null,
        updatedAt: (club as any).spotlightUpdatedAt ?? null,
      }
    : null

  return (
    <div className="min-h-screen bg-warm pb-20 md:pb-0">
      {/* Hero */}
      <div className="relative">
        {club.coverImage ? (
          <div className="relative h-52 sm:h-72 overflow-hidden">
            <Image
              src={resolveImageUrl(club.coverImage)}
              alt={club.name}
              fill
              className="object-cover"
              sizes="100vw"
              priority
              style={{ objectPosition: `center ${(club as any).coverImagePosition ?? 50}%` }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
          </div>
        ) : (
          <div className={`${club.bgColor} h-32 sm:h-48`} />
        )}

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={`${club.coverImage ? 'absolute top-4 left-4 sm:left-8' : 'pt-6'}`}>
            <Link
              href="/clubs"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-black/30 backdrop-blur-sm hover:bg-black/50 px-3 py-1.5 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              All clubs
            </Link>
          </div>

          <div className={`flex items-end gap-5 ${club.coverImage ? '-mt-10 pb-6' : 'py-6'}`}>
            <div className="w-20 h-20 rounded-2xl bg-white shadow-card flex items-center justify-center text-4xl shrink-0 ring-4 ring-white">
              {club.emoji}
            </div>
            <div className={club.coverImage ? 'pb-1' : ''}>
              <span className={`text-xs font-bold ${club.coverImage ? 'text-white/80' : club.color} uppercase tracking-widest`}>
                {club.category}
              </span>
              <h1 className={`text-3xl md:text-4xl font-extrabold tracking-tight mt-0.5 mb-2 ${club.coverImage ? 'text-white' : 'text-gray-900'}`}>
                {club.name}
              </h1>
              <div className={`flex items-center gap-4 text-sm ${club.coverImage ? 'text-white/80' : 'text-gray-600'}`}>
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {club.memberCount} members
                </span>
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {clubEvents.length} upcoming events
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          {/* Main */}
          <div className="lg:col-span-2">

            {/* Pinned "next event" card — strongest call to attend on
                the page. Renders the soonest upcoming event from
                clubEvents (already sorted date-asc by getEventsByClub
                in lib/db.ts). Silently absent when the club has no
                upcoming events. */}
            {(() => {
              const next = clubEvents[0] as { id: string; title: string; date: string; time: string; location: string; neighborhood: string; price: number } | undefined
              if (!next) return null
              const when = new Date(next.date + 'T00:00:00')
              const today = new Date()
              today.setHours(0, 0, 0, 0)
              const dayDelta = Math.round((when.getTime() - today.getTime()) / (24 * 60 * 60_000))
              const relative =
                dayDelta === 0 ? 'Today'
                : dayDelta === 1 ? 'Tomorrow'
                : dayDelta < 7 ? when.toLocaleDateString('en-GB', { weekday: 'long' })
                : when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
              return (
                <Link
                  href={`/events/${next.id}`}
                  className="block bg-gradient-to-br from-amber-500 to-orange-500 text-white rounded-2xl shadow-card p-6 mb-8 hover:shadow-lg transition-shadow group"
                >
                  <p className="text-[11px] font-bold uppercase tracking-widest text-amber-100 mb-2 flex items-center gap-1.5">
                    <span>📍</span> Next event · {relative}
                  </p>
                  <h2 className="text-xl sm:text-2xl font-extrabold leading-tight mb-2 group-hover:underline">
                    {next.title}
                  </h2>
                  <div className="flex items-center gap-3 text-sm text-amber-50 flex-wrap">
                    <span>🕒 {next.time}</span>
                    <span className="text-amber-200">·</span>
                    <span>📍 {next.neighborhood}</span>
                    <span className="text-amber-200">·</span>
                    <span className="font-bold">{next.price === 0 ? 'Free' : `₺${next.price}`}</span>
                  </div>
                  <p className="text-xs text-amber-100 mt-3 group-hover:text-white transition-colors">
                    View details + RSVP →
                  </p>
                </Link>
              )
            })()}

            <div className="bg-white rounded-2xl shadow-card p-8 mb-8">
              <h2 className="text-xl font-bold text-gray-900 mb-4">About this club</h2>
              <p className="text-gray-600 leading-relaxed text-base">{club.description}</p>
            </div>

            {/* House rules — community-wide first, then club-specific.
                Native <details> disclosure so members see the summary
                line by default and can expand. No client JS needed.
                Community rules are structured (icon + title + body
                per rule) and render as a stack of cards; club rules
                stay as free-text for now (their editor is still a
                plain textarea on /admin/clubs/[id]). Renders nothing
                when neither set is configured. */}
            {((communitySettings.communityRules?.length ?? 0) > 0 || club.rules) && (
              <details className="bg-amber-50 border border-amber-100 rounded-2xl mb-8 group">
                <summary className="px-6 py-4 cursor-pointer select-none flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-bold text-amber-900">
                    📜 House Rules
                  </span>
                  <span className="text-xs text-amber-700 group-open:hidden">Expand</span>
                  <span className="text-xs text-amber-700 hidden group-open:inline">Collapse</span>
                </summary>
                <div className="px-6 pb-6 space-y-5 text-sm text-amber-950">
                  {(communitySettings.communityRules?.length ?? 0) > 0 && (
                    <div>
                      <h3 className="text-[11px] font-bold uppercase tracking-widest text-amber-700 mb-3">
                        Smileys Community
                      </h3>
                      <ol className="space-y-2.5">
                        {communitySettings.communityRules!.map((r, i) => (
                          <li key={i} className="flex gap-3">
                            <span
                              className="shrink-0 w-7 h-7 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center text-sm font-bold text-amber-800"
                              aria-hidden="true"
                            >
                              {r.icon || (i + 1)}
                            </span>
                            <div className="flex-1 min-w-0 pt-0.5">
                              {r.title && (
                                <p className="font-semibold text-amber-900 leading-tight">
                                  {r.title}
                                </p>
                              )}
                              {r.body && (
                                <p className="text-amber-950/80 leading-relaxed mt-0.5">
                                  {r.body}
                                </p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {club.rules && (
                    <div>
                      <h3 className="text-[11px] font-bold uppercase tracking-widest text-amber-700 mb-2">
                        {club.name} specific
                      </h3>
                      <p className="whitespace-pre-wrap leading-relaxed">
                        {club.rules}
                      </p>
                    </div>
                  )}
                </div>
              </details>
            )}

            <ClubTabs
              slug={club.slug}
              clubEvents={clubEvents as any[]}
              canPost={canPost}
              currentUserId={session?.id}
              isAdmin={isPrivileged}
              canPin={canPin}
              canAnnounce={canAnnounce}
              canUpload={canUpload}
              isMember={membershipStatus === 'approved'}
              memberAttendeesByEvent={memberAttendeesByEvent}
              memberCount={club.memberCount}
              reviewCount={reviewStats._count._all}
              reviewAvg={reviewStats._avg.rating}
            />
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <ClubJoinWidget
              club={{ id: club.id, name: club.name, slug: club.slug, isPrivate: club.isPrivate ?? false }}
              initialStatus={membershipStatus}
              isLoggedIn={!!session}
            />

            <SocialShare
              title={club.name}
              url={`${APP_URL}/clubs/${club.slug}`}
              cacheKey={club.coverImage ? club.coverImage.match(/\/(\d+)-/)?.[1]?.slice(-8) : undefined}
            />

            <ClubSpotlight
              slug={club.slug}
              initialSpotlight={spotlightUser}
              canEdit={canPin}
            />

            <ClubRulesEditor
              slug={club.slug}
              initialRules={(club as any).rules ?? null}
              canEdit={canPin}
            />

            <ClubResources
              slug={club.slug}
              initialResources={resources}
              canEdit={canPin}
            />

            {hosts.length > 0 && (
              <div className="bg-white rounded-2xl shadow-card p-6">
                <h3 className="font-bold text-gray-900 mb-4">Hosted by</h3>
                {canSeeMemberContent ? (
                  <div className="space-y-3">
                    {hosts.map(({ user }) => {
                      // #7 perf: 128-wide thumb (w-10 css = 40px, retina ~80).
                      const photo = avatarUrl(user.profilePhoto, 128)
                      const initials = user.name.trim().split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
                      return (
                        <div key={user.id} className="flex items-center gap-3">
                          {photo ? (
                            <img src={photo} alt={user.name} loading="lazy" decoding="async" className="w-10 h-10 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: user.color }}>
                              {initials}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">{user.name}</p>
                            {user.bio && <p className="text-xs text-gray-400 truncate">{user.bio}</p>}
                          </div>
                          <span className="ml-auto text-xs font-bold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 shrink-0">Host</span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 py-2 text-gray-400">
                    <div className="flex -space-x-2">
                      {[...Array(Math.min(hosts.length, 3))].map((_, i) => (
                        <div key={i} className="w-8 h-8 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center text-gray-400">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        </div>
                      ))}
                    </div>
                    <p className="text-sm text-gray-400">Join to see who hosts this club</p>
                  </div>
                )}
              </div>
            )}

            <div className="bg-white rounded-2xl shadow-card p-6">
              <h3 className="font-bold text-gray-900 mb-4">Club info</h3>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Category</dt>
                  <dd className="font-medium text-gray-900">{club.category}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Members</dt>
                  <dd className="font-medium text-gray-900">{club.memberCount}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Events</dt>
                  <dd className="font-medium text-gray-900">{totalEventCount} total · {clubEvents.length} upcoming</dd>
                </div>
                {lastEvent && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Last event</dt>
                    <dd className="font-medium text-gray-900">
                      {new Date(lastEvent.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-gray-500">Location</dt>
                  <dd className="font-medium text-gray-900">Istanbul</dd>
                </div>
              </dl>

              {(club.whatsappUrl || club.instagramUrl) && (
                <div className="mt-5 pt-4 border-t border-gray-100 space-y-2">
                  {club.whatsappUrl && (
                    canSeeMemberContent ? (
                    <a
                      href={club.whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-green-50 hover:bg-green-100 transition-colors text-sm font-semibold text-green-700"
                    >
                      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                      </svg>
                      Join WhatsApp group
                    </a>
                    ) : (
                    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-gray-50 text-sm text-gray-400">
                      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      WhatsApp group — members only
                    </div>
                    )
                  )}
                  {club.instagramUrl && (
                    <a
                      href={club.instagramUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-pink-50 hover:bg-pink-100 transition-colors text-sm font-semibold text-pink-700"
                    >
                      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                      </svg>
                      Follow on Instagram
                    </a>
                  )}
                </div>
              )}

              {/* Community-wide "Follow Smileys" footer block. Always
                  visible (assuming the admin has set instagram/whatsapp
                  in /admin/settings), with a label that distinguishes
                  it from the per-club links above. Subtle tone so it
                  doesn't compete with the primary join CTA. */}
              {(communityIg || communityWa) && (
                <div className="mt-5 pt-4 border-t border-gray-100">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                    Smileys Community
                  </p>
                  <div className="flex gap-2">
                    {communityWa && (
                      <a
                        href={communityWa}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Smileys Community WhatsApp"
                        className="flex items-center justify-center w-9 h-9 rounded-xl bg-gray-100 hover:bg-green-50 text-gray-500 hover:text-green-600 transition-colors"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                        </svg>
                      </a>
                    )}
                    {communityIg && (
                      <a
                        href={communityIg}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Smileys on Instagram"
                        className="flex items-center justify-center w-9 h-9 rounded-xl bg-gray-100 hover:bg-pink-50 text-gray-500 hover:text-pink-600 transition-colors"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
                        </svg>
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
