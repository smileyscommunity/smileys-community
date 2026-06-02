import Link from 'next/link'
import { formatDate, formatTime, resolveImageUrl, avatarUrl, BLUR_PLACEHOLDER, todayIstanbul } from '@/lib/data'
import { neighborhoodToSlug } from '@/lib/neighborhoods'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { readFileSync } from 'fs'
import { join } from 'path'
import MiniCalendar from '@/components/MiniCalendar'
import PullToRefreshTrigger from '@/components/PullToRefreshTrigger'
import QuickLinks from '@/components/QuickLinks'
import IstanbulWeather from '@/components/IstanbulWeather'
import ReviewReminder from '@/components/ReviewReminder'
import ReferralImpact from '@/components/ReferralImpact'
import InviteBanner from '@/components/InviteBanner'
import AnnouncementBanner from '@/components/AnnouncementBanner'
import OnboardingCard from '@/components/OnboardingCard'
import CupPromoBanner from '@/components/CupPromoBanner'
import CommunityPollWidget from '@/components/CommunityPollWidget'
import PendingConnectionsWidget from '@/components/PendingConnectionsWidget'
import PartnersBanner from '@/components/PartnersBanner'
import Image from 'next/image'

export const dynamic = 'force-dynamic'

function getInitials(name: string) {
  return name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function getGreeting() {
  const hour = (new Date().getUTCHours() + 3) % 24 // Istanbul UTC+3
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function daysUntil(dateStr: string): number {
  const today = todayIstanbul()
  const diff  = new Date(dateStr).getTime() - new Date(today).getTime()
  return Math.ceil(diff / 86400000)
}

function profileCompletion(p: { profilePhoto: string | null; bio: string | null; neighborhood: string | null; interests: string[]; instagram: string | null; gender: string | null }) {
  const fields = [!!p.profilePhoto, !!p.bio, !!p.neighborhood, p.interests.length > 0, !!p.instagram, !!p.gender]
  return Math.round((fields.filter(Boolean).length / fields.length) * 100)
}

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const today      = todayIstanbul()
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const weekAgo    = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const weekEnd    = new Date(); weekEnd.setDate(weekEnd.getDate() + 7)
  const weekEndStr = weekEnd.toISOString().split('T')[0]

  const [myAttendances, myMemberships, eventsThisMonth, userProfile, , unreviewedRaw, referralStats] = await Promise.all([
    prisma.eventAttendee.findMany({
      where: { userId: session.id, status: 'approved' },
      include: { event: { select: { id: true, title: true, date: true, time: true, neighborhood: true, emoji: true, price: true, coverImage: true, limitedSpots: true, spotsLeft: true, lat: true, lng: true } } },
      orderBy: { joinedAt: 'desc' },
    }),
    prisma.clubMembership.findMany({
      where: { userId: session.id, status: 'approved' },
      include: { club: { select: { id: true, name: true, slug: true, emoji: true, bgColor: true, memberCount: true } } },
    }),
    prisma.eventAttendee.count({
      where: { userId: session.id, status: 'approved', joinedAt: { gte: new Date(monthStart) } },
    }),
    prisma.user.findUnique({
      where: { id: session.id },
      select: { referralCode: true, profilePhoto: true, bio: true, neighborhood: true, joinedAt: true, color: true, membershipType: true, interests: true, instagram: true, gender: true },
    }),
    prisma.notification.count({ where: { userId: session.id, isRead: false } }),
    prisma.eventAttendee.findMany({
      where: {
        userId: session.id,
        status: 'approved',
        event: { date: { lt: today }, status: { in: ['published', 'archived'] } }
      },
      include: { event: { select: { id: true, title: true, emoji: true, reviews: { where: { userId: session.id } } } } },
      take: 5,
    }),
    (async () => {
      const user = await prisma.user.findUnique({ where: { id: session.id }, select: { referralCode: true } })
      if (!user?.referralCode) return { friends: 0, events: 0 }
      const apps = await prisma.memberApplication.findMany({
        where: { referredBy: user.referralCode, status: 'approved' },
        select: { email: true }
      })
      if (!apps.length) return { friends: 0, events: 0 }
      const emails = apps.map(a => a.email.toLowerCase().trim())
      const eventCount = await prisma.eventAttendee.count({
        where: { user: { email: { in: emails } }, status: 'approved' }
      })
      return { friends: emails.length, events: eventCount }
    })(),
  ])

  const unreviewed = unreviewedRaw
    .filter(a => a.event.reviews.length === 0)
    .map(a => ({ id: a.event.id, title: a.event.title, emoji: a.event.emoji }))

  const clubIds        = myMemberships.map(m => m.clubId)
  const joinedEventIds = myAttendances.map(a => a.eventId)
  const upcomingEvents = myAttendances.filter(a => a.event.date >= today).sort((a, b) => a.event.date.localeCompare(b.event.date)).slice(0, 5)
  const clubs          = myMemberships.map(m => m.club)
  const pastEventIds   = myAttendances.filter(a => a.event.date < today).map(a => a.eventId)

  // Read member spotlight from file
  let spotlightData: { userId: string; funFact: string; topSpots: string[] } | null = null
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'member-spotlight.json'), 'utf-8'))
    if (raw.userId) spotlightData = raw
  } catch { /* no spotlight set */ }

  // Read announcement
  let announcement: { text: string; link: string; active: boolean } | null = null
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'announcement.json'), 'utf-8'))
    if (raw.active && raw.text) announcement = raw
  } catch { /* no announcement */ }

  // Read dashboard ad banners from banners.json
  let adBanners: any[] = []
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'banners.json'), 'utf-8'))
    const data = raw?.dashboard
    if (Array.isArray(data)) {
      adBanners = data.filter(b => b.active && b.headline)
    } else if (data?.active && data?.headline) {
      adBanners = [data]
    }
  } catch { /* no banners */ }

  const [recommendedEvents, recentActivity, waitlisted, wallActivity, whosGoingRaw, spotlightUser, activePoll, featuredEvents] = await Promise.all([
    clubIds.length
      ? prisma.event.findMany({
          where: { clubId: { in: clubIds }, date: { gte: today }, status: 'published', id: { notIn: joinedEventIds } },
          orderBy: { date: 'asc' }, take: 4,
          select: { id: true, title: true, date: true, time: true, emoji: true, neighborhood: true, price: true, spotsLeft: true, limitedSpots: true, coverImage: true },
        })
      : userProfile?.neighborhood
        ? prisma.event.findMany({
            where: { neighborhood: userProfile.neighborhood, date: { gte: today }, status: 'published', id: { notIn: joinedEventIds } },
            orderBy: { date: 'asc' }, take: 4,
            select: { id: true, title: true, date: true, time: true, emoji: true, neighborhood: true, price: true, spotsLeft: true, limitedSpots: true, coverImage: true },
          })
        : prisma.event.findMany({
            where: { date: { gte: today }, status: 'published', id: { notIn: joinedEventIds } },
            orderBy: { date: 'asc' }, take: 4,
            select: { id: true, title: true, date: true, time: true, emoji: true, neighborhood: true, price: true, spotsLeft: true, limitedSpots: true, coverImage: true },
          }),
    clubIds.length
      ? prisma.clubMembership.findMany({
          where: { clubId: { in: clubIds }, userId: { not: session.id }, status: 'approved', joinedAt: { gte: weekAgo } },
          include: { user: { select: { name: true, color: true } }, club: { select: { name: true, emoji: true, slug: true } } },
          orderBy: { joinedAt: 'desc' }, take: 5,
        })
      : Promise.resolve([]),
    prisma.eventAttendee.findMany({
      where: { userId: session.id, status: 'pending' },
      include: { event: { select: { id: true, title: true, date: true, emoji: true } } },
      orderBy: { joinedAt: 'desc' }, take: 3,
    }),
    clubIds.length
      ? prisma.clubPost.findMany({
          where: { clubId: { in: clubIds }, type: 'post' },
          orderBy: { createdAt: 'desc' }, take: 4,
          include: {
            user: { select: { name: true, color: true, profilePhoto: true } },
            club: { select: { name: true, emoji: true, slug: true } },
          },
        })
      : Promise.resolve([]),
    // Who's going: familiar faces (past co-attendees) going to upcoming events
    pastEventIds.length > 0
      ? prisma.eventAttendee.findMany({
          where: {
            status: 'approved',
            userId: { not: session.id },
            event: { date: { gte: today }, status: 'published', id: { notIn: joinedEventIds } },
            user: { joinedEvents: { some: { eventId: { in: pastEventIds }, status: 'approved' } } },
          },
          include: {
            user:  { select: { id: true, name: true, color: true, profilePhoto: true } },
            event: { select: { id: true, title: true, date: true, emoji: true } },
          },
          orderBy: { event: { date: 'asc' } },
          take: 20,
        })
      : Promise.resolve([]),
    // Member spotlight user profile
    spotlightData?.userId
      ? prisma.user.findUnique({
          where:  { id: spotlightData.userId },
          select: { id: true, name: true, color: true, profilePhoto: true, neighborhood: true },
        })
      : Promise.resolve(null),
    // Active community poll with user's vote
    prisma.communityPoll.findFirst({
      where:   { active: true },
      orderBy: { createdAt: 'desc' },
      include: {
        options: { orderBy: { order: 'asc' }, include: { _count: { select: { votes: true } } } },
      },
    }),
    // Featured events not yet joined
    prisma.event.findMany({
      where: { featured: true, date: { gte: today }, status: 'published', id: { notIn: joinedEventIds } },
      orderBy: { date: 'asc' }, take: 3,
      select: { id: true, title: true, date: true, time: true, emoji: true, neighborhood: true, price: true, spotsLeft: true, limitedSpots: true, coverImage: true },
    }),
  ])

  // New queries: suggested members, this week's events, community stats, neighborhood event count
  const suggestedMembersWhere = (() => {
    const conditions: any[] = []
    if (clubIds.length) conditions.push({ clubMemberships: { some: { clubId: { in: clubIds }, status: 'approved' } } })
    if (userProfile?.neighborhood) conditions.push({ neighborhood: userProfile.neighborhood })
    return conditions.length > 0
      ? { id: { not: session.id }, status: 'approved', OR: conditions }
      : { id: { not: session.id }, status: 'approved' }
  })()

  const [suggestedMembers, thisWeekEvents, totalMembers, eventsThisWeek, neighborhoodEventCount, newMembers, recentPhotos] = await Promise.all([
    prisma.user.findMany({
      where: suggestedMembersWhere,
      select: { id: true, name: true, color: true, profilePhoto: true, neighborhood: true, bio: true },
      take: 6,
      orderBy: { joinedAt: 'desc' },
    }),
    prisma.event.findMany({
      where: { date: { gte: today, lte: weekEndStr }, status: 'published' },
      orderBy: { date: 'asc' },
      take: 20,
      select: { id: true, title: true, date: true, emoji: true, neighborhood: true, price: true },
    }),
    prisma.user.count({ where: { status: 'approved' } }),
    prisma.event.count({ where: { date: { gte: today, lte: weekEndStr }, status: 'published' } }),
    userProfile?.neighborhood
      ? prisma.event.count({ where: { neighborhood: userProfile.neighborhood, date: { gte: today }, status: 'published' } })
      : Promise.resolve(0),
    prisma.user.findMany({
      where: { status: 'approved', joinedAt: { gte: weekAgo }, id: { not: session.id } },
      select: { id: true, name: true, color: true, profilePhoto: true, neighborhood: true, joinedAt: true },
      orderBy: { joinedAt: 'desc' },
      take: 8,
    }),
    prisma.eventPhoto.findMany({
      orderBy: { createdAt: 'desc' },
      take: 9,
      select: { id: true, url: true, caption: true, eventId: true, event: { select: { title: true } } },
    }),
  ])

  // Build poll data for widget
  let pollForWidget = null
  if (activePoll) {
    const userVote = await prisma.communityPollVote.findUnique({
      where: { userId_pollId: { userId: session.id, pollId: activePoll.id } },
      select: { optionId: true },
    })
    const totalVotes = activePoll.options.reduce((s, o) => s + o._count.votes, 0)
    pollForWidget = {
      id:            activePoll.id,
      question:      activePoll.question,
      totalVotes,
      votedOptionId: userVote?.optionId ?? null,
      options: activePoll.options.map(o => ({
        id:      o.id,
        text:    o.text,
        votes:   o._count.votes,
        percent: totalVotes > 0 ? Math.round((o._count.votes / totalVotes) * 100) : 0,
      })),
    }
  }

  // Deduplicate who's going by userId
  const seenUsers = new Set<string>()
  const whosGoing = whosGoingRaw.filter(a => seenUsers.has(a.userId) ? false : (seenUsers.add(a.userId), true)).slice(0, 8)

  const upcomingDates  = upcomingEvents.map(a => a.event.date)
  const nextEvent      = upcomingEvents[0]
  const daysToNext     = nextEvent ? daysUntil(nextEvent.event.date) : null
  const completion     = userProfile ? profileCompletion(userProfile) : 0
  const memberSince    = userProfile?.joinedAt
    ? new Date(userProfile.joinedAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : null

  const stats = [
    { label: 'Events attended', value: myAttendances.length, icon: '🎉', color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'My clubs',        value: clubs.length,          icon: '🏛️', color: 'text-violet-600', bg: 'bg-violet-50' },
    { label: 'This month',      value: eventsThisMonth,       icon: '📅', color: 'text-blue-600',   bg: 'bg-blue-50'   },
    { label: 'Upcoming',        value: upcomingEvents.length, icon: '⏳', color: 'text-green-600',  bg: 'bg-green-50'  },
  ]

  return (
    <div className="min-h-screen bg-warm pb-20 md:pb-10">
      <PullToRefreshTrigger />

      {/* Header hero */}
      <div className="bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 relative overflow-hidden">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_top_right,#fff_0%,transparent_60%)]" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-6 relative z-10">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-amber-100 text-sm font-medium mb-1">{getGreeting()} 👋</p>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight truncate">
                {session.name.split(' ')[0]}
              </h1>
              {nextEvent && (
                <div className="mt-3 inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm text-white text-xs font-semibold px-3 py-1.5 rounded-full">
                  <span>Next: {nextEvent.event.title}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    daysToNext === 0 ? 'bg-red-500' : daysToNext === 1 ? 'bg-orange-400' : 'bg-white/30'
                  }`}>
                    {daysToNext === 0 ? 'Today!' : daysToNext === 1 ? 'Tomorrow' : `${daysToNext}d`}
                  </span>
                </div>
              )}
              {/* Smileys Cup 2026 — compact pill sitting next to the
                  "Next: <event>" pill (when present) so it shares the
                  same row of action affordances under the member's
                  name instead of taking its own full-width row below
                  the stats strip. Saves significant vertical space
                  above the fold on mobile. Dismissible per-browser
                  and auto-hides post-tournament. */}
              <CupPromoBanner />
            </div>
            <div className="shrink-0 flex flex-col items-end gap-2">
              {userProfile?.profilePhoto ? (
                // #7 perf: 128-wide thumb instead of the full 1200×1200
                // original. ~50× smaller wire bytes for the same 14×14
                // CSS render. lazy/async hints for the cumulative drop.
                <img src={avatarUrl(userProfile.profilePhoto, 128)} alt={session.name} loading="lazy" decoding="async"
                  className="w-14 h-14 rounded-2xl object-cover ring-2 ring-white/40 shadow-lg" />
              ) : (
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-lg font-bold ring-2 ring-white/40 shadow-lg"
                  style={{ backgroundColor: userProfile?.color ?? '#b45309' }}>
                  {getInitials(session.name)}
                </div>
              )}
            </div>
          </div>

          {/* Quick stats strip */}
          <div className="flex gap-2 mt-4 overflow-x-auto scrollbar-hide pb-1">
            {stats.map(s => (
              <div key={s.label} className="shrink-0 bg-white/20 backdrop-blur-sm rounded-xl px-3 py-2 text-center min-w-[60px]">
                <div className="text-base font-extrabold text-white leading-none">{s.value}</div>
                <div className="text-[9px] text-amber-100 mt-0.5 leading-tight">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="lg:flex lg:gap-6 space-y-6 lg:space-y-0">

          {/* ── LEFT ── */}
          <div className="lg:w-60 lg:shrink-0 space-y-4">
            {/* Dismissible "what's new" card — only renders for members who
                haven't dismissed it (localStorage). Self-hides otherwise. */}
            <OnboardingCard />

            {/* Announcement */}
            {announcement && (
              <AnnouncementBanner text={announcement.text} link={announcement.link || undefined} />
            )}

            {/* Pending connection requests */}
            <PendingConnectionsWidget />

            {/* Profile card */}
            <div className="bg-white rounded-2xl shadow-card overflow-hidden">
              <div className="h-12 bg-gradient-to-r from-amber-400 to-orange-400" />
              <div className="px-4 pb-4 -mt-6">
                <div className="flex items-end justify-between mb-3">
                  <div className="relative">
                    {userProfile?.profilePhoto ? (
                      <img src={avatarUrl(userProfile.profilePhoto, 128)} alt={session.name}
                        loading="lazy" decoding="async" className="w-14 h-14 rounded-xl object-cover ring-2 ring-white shadow" />
                    ) : (
                      <div className="w-14 h-14 rounded-xl flex items-center justify-center text-white text-lg font-bold ring-2 ring-white shadow"
                        style={{ backgroundColor: userProfile?.color ?? '#f59e0b' }}>
                        {getInitials(session.name)}
                      </div>
                    )}
                    {userProfile?.membershipType === 'member' && (
                      <span className="absolute -bottom-1 -right-1 text-sm">⭐</span>
                    )}
                  </div>
                  <Link href="/profile"
                    className="text-xs font-semibold text-amber-600 border border-amber-200 bg-amber-50 px-3 py-1.5 rounded-xl hover:bg-amber-100 transition-colors">
                    Edit profile
                  </Link>
                </div>
                <p className="font-bold text-gray-900">{session.name}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  {userProfile?.neighborhood && (
                    <p className="text-xs text-gray-400">📍 {userProfile.neighborhood}</p>
                  )}
                  {memberSince && (
                    <p className="text-xs text-gray-400">· {memberSince}</p>
                  )}
                </div>
                {userProfile?.bio && (
                  <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 mt-2">{userProfile.bio}</p>
                )}
                {!userProfile?.gender && (
                  <div className="mt-3 p-3 bg-red-50 rounded-xl flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-red-700">⚠️ Set your gender to join gender-balanced events</p>
                    <Link href="/profile" className="text-xs text-red-600 font-bold shrink-0">Set now →</Link>
                  </div>
                )}
                {completion < 100 && (
                  <div className="mt-2 p-3 bg-amber-50 rounded-xl">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-amber-800">Profile {completion}% complete</span>
                      <Link href="/profile" className="text-xs text-amber-600 font-semibold">Complete →</Link>
                    </div>
                    <div className="h-1.5 bg-amber-200 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-500 rounded-full" style={{ width: `${completion}%` }} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Who's Going */}
            {whosGoing.length > 0 && (
              <div className="bg-white rounded-2xl shadow-card p-5">
                <h2 className="text-sm font-bold text-gray-900 mb-1">Who's going 👀</h2>
                <p className="text-xs text-gray-400 mb-3">Familiar faces at upcoming events</p>
                <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
                  {whosGoing.map(a => (
                    <Link key={a.user.id} href={`/events/${a.event.id}`}
                      className="flex flex-col items-center gap-1.5 shrink-0 group">
                      {a.user.profilePhoto ? (
                        <img src={avatarUrl(a.user.profilePhoto, 128)} alt={a.user.name} loading="lazy" decoding="async"
                          className="w-11 h-11 rounded-full object-cover border-2 border-white shadow-sm group-hover:ring-2 group-hover:ring-amber-400 transition-all" />
                      ) : (
                        <div className="w-11 h-11 rounded-full border-2 border-white shadow-sm flex items-center justify-center text-white text-xs font-bold group-hover:ring-2 group-hover:ring-amber-400 transition-all"
                          style={{ backgroundColor: a.user.color }}>
                          {a.user.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                        </div>
                      )}
                      <span className="text-xs text-gray-500 text-center leading-tight max-w-[48px] truncate">
                        {a.user.name.split(' ')[0]}
                      </span>
                      <span className="text-xs text-amber-600 font-medium text-center leading-tight max-w-[52px] line-clamp-2">
                        {a.event.emoji} {a.event.title}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Member Spotlight */}
            {spotlightUser && spotlightData && (
              <div className="bg-white rounded-2xl shadow-card p-5">
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-sm">⭐</span>
                  <h2 className="text-sm font-bold text-gray-900">Member spotlight</h2>
                </div>
                <div className="flex items-center gap-3 mb-3">
                  {spotlightUser.profilePhoto ? (
                    <img src={avatarUrl(spotlightUser.profilePhoto, 128)} alt={spotlightUser.name} loading="lazy" decoding="async"
                      className="w-14 h-14 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-full shrink-0 flex items-center justify-center text-white font-bold text-lg"
                      style={{ backgroundColor: spotlightUser.color }}>
                      {spotlightUser.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 truncate">{spotlightUser.name}</p>
                    {spotlightUser.neighborhood && (
                      <p className="text-xs text-gray-400">📍 {spotlightUser.neighborhood}</p>
                    )}
                  </div>
                </div>
                {spotlightData.funFact && (
                  <p className="text-xs text-gray-600 leading-relaxed mb-3 italic">"{spotlightData.funFact}"</p>
                )}
                {spotlightData.topSpots.some(s => s) && (
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Top Istanbul spots</p>
                    <div className="space-y-1">
                      {spotlightData.topSpots.filter(s => s).map((spot, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs text-gray-600">
                          <span className="text-amber-500 font-bold">{i + 1}.</span> {spot}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Events attended', value: myAttendances.length,  icon: '🎉', bg: 'bg-amber-50',  text: 'text-amber-600'  },
                { label: 'My clubs',        value: clubs.length,           icon: '🏛️', bg: 'bg-violet-50', text: 'text-violet-600' },
                { label: 'This month',      value: eventsThisMonth,        icon: '📅', bg: 'bg-blue-50',   text: 'text-blue-600'   },
                { label: 'Upcoming',        value: upcomingEvents.length,  icon: '⏳', bg: 'bg-green-50',  text: 'text-green-600'  },
              ].map(s => (
                <div key={s.label} className={`rounded-2xl shadow-card p-4 ${s.bg}`}>
                  <div className="text-xl mb-1">{s.icon}</div>
                  <div className={`text-2xl font-extrabold ${s.text}`}>{s.value}</div>
                  <div className="text-xs text-gray-500 mt-0.5 leading-tight">{s.label}</div>
                </div>
              ))}
            </div>

            {/* New members this week */}
            {newMembers.length > 0 && (
              <div className="bg-white rounded-2xl shadow-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">New this week 🌱</p>
                  <Link href="/members" className="text-xs text-amber-600 font-semibold hover:underline">See all</Link>
                </div>
                <div className="space-y-2.5">
                  {newMembers.map(m => {
                    const photo = m.profilePhoto ? avatarUrl(m.profilePhoto, 64) : null
                    const initials = m.name.trim().split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                    const daysAgo = Math.max(0, Math.floor((Date.now() - new Date(m.joinedAt).getTime()) / 86400000))
                    return (
                      <Link key={m.id} href={`/members/${m.id}`}
                        className="flex items-center gap-2.5 hover:bg-gray-50 rounded-xl px-1.5 py-1 -mx-1.5 transition-colors group">
                        {photo ? (
                          <img src={photo} alt={m.name} loading="lazy" decoding="async" className="w-8 h-8 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                            style={{ backgroundColor: m.color }}>{initials}</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate group-hover:text-amber-600 transition-colors">{m.name}</p>
                          <p className="text-xs text-gray-400 truncate">{m.neighborhood ?? (daysAgo === 0 ? 'Joined today' : `${daysAgo}d ago`)}</p>
                        </div>
                        {daysAgo === 0 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 shrink-0">New</span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Recent photos */}
            {recentPhotos.length > 0 && (
              <div className="bg-white rounded-2xl shadow-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Recent photos 📸</p>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {recentPhotos.map(p => (
                    <Link key={p.id} href={`/events/${p.eventId}`}
                      className="relative aspect-square rounded-xl overflow-hidden group block bg-gray-100">
                      <img
                        src={resolveImageUrl(p.url)}
                        alt={p.caption ?? p.event.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Community pulse */}
            <div className="bg-white rounded-2xl shadow-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <p className="text-xs font-bold text-gray-900 uppercase tracking-widest">Community</p>
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Total members</span>
                  <span className="text-sm font-extrabold text-gray-900">{totalMembers.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Events this week</span>
                  <span className="text-sm font-extrabold text-amber-600">{eventsThisWeek}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Events this month</span>
                  <span className="text-sm font-extrabold text-gray-900">{eventsThisMonth}</span>
                </div>
                {userProfile?.neighborhood && neighborhoodEventCount > 0 && (
                  <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                    <span className="text-xs text-gray-500 truncate pr-2">In {userProfile.neighborhood}</span>
                    <span className="text-sm font-extrabold text-green-600 shrink-0">{neighborhoodEventCount}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Poll of the week */}
            <CommunityPollWidget initial={pollForWidget} />

            {/* My neighborhood */}
            {userProfile?.neighborhood && (
              <Link href={`/neighborhoods/${neighborhoodToSlug(userProfile.neighborhood)}`}
                className="block bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100 rounded-2xl p-4 hover:border-amber-300 transition-colors group">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-amber-700 uppercase tracking-widest">My area</p>
                  <svg className="w-4 h-4 text-amber-400 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
                <p className="font-bold text-gray-900 text-sm">📍 {userProfile.neighborhood}</p>
                {neighborhoodEventCount > 0 ? (
                  <p className="text-xs text-amber-700 mt-1">
                    {neighborhoodEventCount} upcoming event{neighborhoodEventCount !== 1 ? 's' : ''} nearby
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">Explore your neighborhood →</p>
                )}
              </Link>
            )}

          </div>

          {/* ── CENTER ── */}
          <div className="flex-1 min-w-0 space-y-6">
            <ReviewReminder events={unreviewed} />

            {/* Advertisement banner grid */}
            {adBanners.length > 0 && (
              <div className={`grid gap-3 mb-6 ${adBanners.length === 1 ? 'grid-cols-1' : adBanners.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
                {adBanners.map((banner, i) => {
                  const inner = banner.type === 'promo' ? (
                    <div className="flex items-center gap-3 bg-gradient-to-r from-amber-500 to-orange-400 rounded-2xl px-4 py-3 overflow-hidden relative h-full">
                      <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_20%_50%,#fff_0%,transparent_60%)]" />
                      <div className="flex-1 min-w-0 relative z-10">
                        <p className="text-xs font-bold text-amber-100 uppercase tracking-widest mb-0.5">From Smileys</p>
                        <p className="text-sm font-bold text-white leading-snug truncate">{banner.headline}</p>
                        {banner.subtitle && <p className="text-xs text-amber-100 truncate opacity-90">{banner.subtitle}</p>}
                        {banner.cta && <p className="text-xs font-bold text-white mt-1 underline">{banner.cta} →</p>}
                      </div>
                      <div className="shrink-0 w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl relative z-10">{banner.emoji}</div>
                    </div>
                  ) : banner.type === 'strip' ? (
                    <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 h-full">
                      <span className="text-xl shrink-0">{banner.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-amber-900 truncate">{banner.headline}</p>
                        {banner.subtitle && <p className="text-xs text-amber-700 truncate">{banner.subtitle}</p>}
                      </div>
                      {banner.cta && <span className="text-xs font-bold text-amber-600 shrink-0">{banner.cta} →</span>}
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 bg-gradient-to-r from-gray-900 to-gray-700 rounded-2xl px-4 py-3 overflow-hidden relative group h-full">
                      <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_80%_50%,#f59e0b_0%,transparent_60%)]" />
                      <div className="flex-1 min-w-0 relative z-10">
                        <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-0.5">Sponsored</p>
                        <p className="text-sm font-bold text-white leading-snug truncate group-hover:text-amber-300 transition-colors">{banner.headline}</p>
                        {banner.subtitle && <p className="text-xs text-gray-400 truncate">{banner.subtitle}</p>}
                        {banner.cta && <p className="text-xs text-amber-400 font-bold mt-1 group-hover:text-amber-300 transition-colors">{banner.cta} →</p>}
                      </div>
                      <div className="shrink-0 w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-xl relative z-10">{banner.emoji}</div>
                    </div>
                  )

                  return banner.link ? (
                    <a key={banner.id || i} href={banner.link} target={banner.link.startsWith('http') ? '_blank' : undefined} 
                      rel={banner.link.startsWith('http') ? 'noopener noreferrer' : undefined} className="block h-full group">{inner}</a>
                  ) : <div key={banner.id || i}>{inner}</div>
                })}
              </div>
            )}

            {/* Waitlisted events */}
            {waitlisted.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <h3 className="text-sm font-bold text-amber-800 mb-2">⏳ Pending approval ({waitlisted.length})</h3>
                <div className="space-y-2">
                  {waitlisted.map(({ event }) => (
                    <Link key={event.id} href={`/events/${event.id}`}
                      className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                      <span className="text-lg">{event.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-amber-900 truncate">{event.title}</p>
                        <p className="text-xs text-amber-700">{formatDate(event.date)}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Next event hero */}
            {nextEvent ? (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xl font-bold text-gray-900">My upcoming events</h2>
                  <Link href="/my-events" className="text-sm text-amber-600 font-semibold hover:underline">See all →</Link>
                </div>

                {/* Hero card for next event */}
                <div className="bg-white rounded-2xl shadow-card overflow-hidden hover:-translate-y-0.5 transition-transform duration-200 mb-3 cursor-pointer">
                  <Link href={`/events/${nextEvent.event.id}`} className="group block">
                    {nextEvent.event.coverImage ? (
                      <div className="relative h-36 overflow-hidden">
                        <img src={resolveImageUrl(nextEvent.event.coverImage)} alt={nextEvent.event.title}
                          loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                        <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
                          <div>
                            <p className="text-white font-bold text-lg leading-tight">{nextEvent.event.title}</p>
                            <p className="text-white/80 text-xs mt-0.5">{formatDate(nextEvent.event.date)} · {formatTime(nextEvent.event.time)}</p>
                          </div>
                          <span className={`shrink-0 text-xs font-bold px-2.5 py-1.5 rounded-xl ${
                            daysToNext === 0 ? 'bg-red-500 text-white' :
                            daysToNext === 1 ? 'bg-orange-500 text-white' :
                            'bg-white text-gray-900'
                          }`}>
                            {daysToNext === 0 ? 'Today!' : daysToNext === 1 ? 'Tomorrow' : `In ${daysToNext} days`}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 flex items-center gap-4">
                        <div className="w-16 h-16 rounded-xl bg-amber-50 flex items-center justify-center text-3xl shrink-0">
                          {nextEvent.event.emoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-amber-600 hover:underline truncate">{nextEvent.event.title}</h3>
                          <p className="text-xs text-gray-500 mt-0.5">{formatDate(nextEvent.event.date)} · {formatTime(nextEvent.event.time)}</p>
                          <p className="text-xs text-gray-400 mt-0.5">📍 {nextEvent.event.neighborhood}</p>
                        </div>
                        <span className={`shrink-0 text-xs font-bold px-2.5 py-1.5 rounded-xl ${
                          daysToNext === 0 ? 'bg-red-100 text-red-700' :
                          daysToNext === 1 ? 'bg-orange-100 text-orange-700' :
                          'bg-amber-50 text-amber-700'
                        }`}>
                          {daysToNext === 0 ? 'Today!' : daysToNext === 1 ? 'Tomorrow' : `In ${daysToNext}d`}
                        </span>
                      </div>
                    )}
                  </Link>
                  
                </div>

                {/* Remaining upcoming events */}
                {upcomingEvents.slice(1).length > 0 && (
                  <div className="space-y-2">
                    {upcomingEvents.slice(1).map(({ event }) => {
                      const d = daysUntil(event.date)
                      return (
                        <Link key={event.id} href={`/events/${event.id}`}
                          className="flex items-center gap-3 bg-white rounded-2xl shadow-card p-3.5 hover:-translate-y-0.5 transition-all duration-200 group">
                          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center text-xl shrink-0 group-hover:scale-110 transition-transform">
                            {event.emoji}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-semibold text-gray-900 group-hover:text-amber-600 transition-colors truncate">{event.title}</h3>
                            <p className="text-xs text-gray-400 mt-0.5">{formatDate(event.date)} · {event.neighborhood}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className="text-xs font-bold text-gray-700">{event.price === 0 ? 'Free' : `₺${event.price}`}</span>
                            <p className="text-[10px] text-gray-400 mt-0.5">{d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `${d}d`}</p>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xl font-bold text-gray-900">My upcoming events</h2>
                </div>
                <div className="bg-white rounded-2xl shadow-card p-8 text-center">
                  <div className="text-4xl mb-3">📅</div>
                  <p className="text-gray-500 font-medium">No upcoming events</p>
                  <p className="text-gray-400 text-sm mt-1">Join something to add it to your calendar</p>
                  <Link href="/events" className="mt-4 inline-block btn-primary text-sm">Browse events →</Link>
                </div>
              </div>
            )}

            {/* Featured events */}
            {featuredEvents.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">★ Featured events</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Handpicked by the Smileys team</p>
                  </div>
                  <Link href="/events" className="text-sm text-amber-600 font-semibold hover:underline">Browse all →</Link>
                </div>
                <div className="space-y-2">
                  {featuredEvents.map(event => (
                    <Link key={event.id} href={`/events/${event.id}`}
                      className="group flex gap-3 bg-amber-50 border border-amber-200 rounded-xl shadow-card p-3 hover:-translate-y-0.5 transition-transform duration-200">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-200 to-orange-200 flex items-center justify-center text-xl shrink-0">
                        {event.emoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <h3 className="text-sm font-semibold text-gray-900 group-hover:text-amber-700 transition-colors truncate">{event.title}</h3>
                          <span className="shrink-0 text-xs font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">★ Featured</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{formatDate(event.date)} · 📍 {event.neighborhood}</p>
                      </div>
                      <div className="text-right shrink-0 self-center">
                        <span className="text-sm font-bold text-gray-900">{event.price === 0 ? 'Free' : `₺${event.price}`}</span>
                        {event.limitedSpots && event.spotsLeft <= 5 && (
                          <p className="text-xs text-red-500 font-medium">{event.spotsLeft} left</p>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Recommended */}
            {recommendedEvents.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">Recommended for you</h2>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {clubIds.length > 0 ? 'Based on your clubs' : userProfile?.neighborhood ? `Events in ${userProfile.neighborhood}` : 'Upcoming events'}
                    </p>
                  </div>
                  <Link href="/events" className="text-sm text-amber-600 font-semibold hover:underline">Browse all →</Link>
                </div>
                <div className="space-y-2">
                  {recommendedEvents.map(event => (
                    <Link key={event.id} href={`/events/${event.id}`}
                      className="group flex gap-3 bg-white rounded-xl shadow-card p-3 hover:-translate-y-0.5 transition-transform duration-200">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center text-xl shrink-0">
                        {event.emoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-gray-900 group-hover:text-amber-600 transition-colors truncate">{event.title}</h3>
                        <p className="text-xs text-gray-400 mt-0.5">{formatDate(event.date)} · 📍 {event.neighborhood}</p>
                      </div>
                      <div className="text-right shrink-0 self-center">
                        <span className="text-sm font-bold text-gray-900">{event.price === 0 ? 'Free' : `₺${event.price}`}</span>
                        {event.limitedSpots && event.spotsLeft <= 5 && (
                          <p className="text-xs text-red-500 font-medium">{event.spotsLeft} left</p>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* People you might know */}
            {suggestedMembers.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">People you might know</h2>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {clubIds.length > 0 ? 'Members in your clubs' : userProfile?.neighborhood ? `People in ${userProfile.neighborhood}` : 'Recent members'}
                    </p>
                  </div>
                  <Link href="/members" className="text-sm text-amber-600 font-semibold hover:underline">All →</Link>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {suggestedMembers.slice(0, 6).map(m => (
                    <Link key={m.id} href={`/members/${m.id}`}
                      className="bg-white rounded-2xl shadow-card p-4 text-center hover:-translate-y-0.5 transition-all group">
                      {m.profilePhoto ? (
                        <img src={avatarUrl(m.profilePhoto, 128)} alt={m.name} loading="lazy" decoding="async"
                          className="w-14 h-14 rounded-full object-cover mx-auto mb-2 ring-2 ring-gray-100 group-hover:ring-amber-200 transition-all" />
                      ) : (
                        <div className="w-14 h-14 rounded-full mx-auto mb-2 flex items-center justify-center text-white text-lg font-bold ring-2 ring-gray-100 group-hover:ring-amber-200 transition-all"
                          style={{ backgroundColor: m.color }}>
                          {m.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <p className="text-sm font-semibold text-gray-900 group-hover:text-amber-600 transition-colors truncate">{m.name.split(' ')[0]}</p>
                      {m.neighborhood && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate">📍 {m.neighborhood}</p>
                      )}
                      {m.bio && (
                        <p className="text-xs text-gray-400 mt-1 line-clamp-2 leading-tight">{m.bio}</p>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* This week */}
            {thisWeekEvents.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">This week in Istanbul</h2>
                    <p className="text-xs text-gray-400 mt-0.5">{thisWeekEvents.length} event{thisWeekEvents.length !== 1 ? 's' : ''} coming up</p>
                  </div>
                  <Link href="/events" className="text-sm text-amber-600 font-semibold hover:underline">All →</Link>
                </div>
                {/* Group by day */}
                <div className="space-y-3">
                  {(() => {
                    const byDay: Record<string, typeof thisWeekEvents> = {}
                    thisWeekEvents.forEach(e => {
                      if (!byDay[e.date]) byDay[e.date] = []
                      byDay[e.date].push(e)
                    })
                    return Object.entries(byDay).map(([date, evts]) => {
                      const isToday = date === today
                      const label = isToday ? 'Today' : new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
                      return (
                        <div key={date}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${isToday ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                              {label}
                            </span>
                            <div className="flex-1 h-px bg-gray-100" />
                          </div>
                          <div className="space-y-1.5">
                            {evts.slice(0, 3).map(e => (
                              <Link key={e.id} href={`/events/${e.id}`}
                                className="flex items-center gap-3 bg-white rounded-xl shadow-card p-3 hover:shadow-md transition-all group">
                                <span className="text-lg w-8 text-center shrink-0">{e.emoji}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-gray-900 group-hover:text-amber-600 transition-colors truncate">{e.title}</p>
                                  <p className="text-xs text-gray-400 truncate">📍 {e.neighborhood}</p>
                                </div>
                                <span className="text-xs font-bold text-gray-500 shrink-0">
                                  {e.price === 0 ? 'Free' : `₺${e.price}`}
                                </span>
                              </Link>
                            ))}
                            {evts.length > 3 && (
                              <Link href="/events" className="block text-center text-xs text-amber-600 font-semibold py-1 hover:underline">
                                +{evts.length - 3} more →
                              </Link>
                            )}
                          </div>
                        </div>
                      )
                    })
                  })()}
                </div>
              </div>
            )}

            {recommendedEvents.length === 0 && upcomingEvents.length > 0 && (
              <div className="bg-white rounded-2xl shadow-card p-6 text-center">
                <div className="text-3xl mb-2">🔍</div>
                <p className="text-gray-500 text-sm font-medium">Discover more events</p>
                <Link href="/events" className="mt-3 inline-block btn-primary text-sm">Browse events</Link>
              </div>
            )}

            {/* My clubs */}
            <div className="bg-white rounded-2xl shadow-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-gray-900">My clubs</h2>
                <Link href="/clubs" className="text-xs text-amber-600 font-semibold hover:underline">All →</Link>
              </div>
              {clubs.length === 0 ? (
                <div className="text-center py-4">
                  <div className="text-3xl mb-2">🏛️</div>
                  <p className="text-gray-400 text-sm mb-2">Not in any clubs yet</p>
                  <Link href="/clubs" className="inline-block text-xs font-semibold text-amber-600 bg-amber-50 px-3 py-1.5 rounded-xl hover:bg-amber-100 transition-colors">
                    Explore clubs →
                  </Link>
                </div>
              ) : (
                <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                  {clubs.map(club => (
                    <Link key={club.id} href={`/clubs/${club.slug}`}
                      className="shrink-0 flex flex-col items-center gap-2 group">
                      <div className={`w-14 h-14 rounded-2xl ${club.bgColor} flex items-center justify-center text-2xl shadow-sm group-hover:scale-110 transition-transform`}>
                        {club.emoji}
                      </div>
                      <p className="text-[11px] font-semibold text-gray-700 group-hover:text-amber-600 transition-colors text-center max-w-[60px] leading-tight truncate">{club.name}</p>
                    </Link>
                  ))}
                  <Link href="/clubs" className="shrink-0 flex flex-col items-center gap-2">
                    <div className="w-14 h-14 rounded-2xl border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-400 hover:border-amber-300 hover:text-amber-500 transition-colors text-xl">
                      +
                    </div>
                    <p className="text-[11px] text-gray-400 text-center">More</p>
                  </Link>
                </div>
              )}
            </div>


            {/* Quick links — mobile only */}
            <div className="lg:hidden">
              <QuickLinks />
            </div>

            <div className="lg:hidden">
              <InviteBanner />
            </div>

            {referralStats.friends > 0 && (
              <div className="lg:hidden">
                <ReferralImpact friendCount={referralStats.friends} eventCount={referralStats.events} />
              </div>
            )}
          </div>

          {/* ── RIGHT ── */}
          <div className="hidden lg:block lg:w-60 lg:shrink-0 space-y-4">


            <IstanbulWeather />

            {/* Mini calendar */}
            <div className="bg-white rounded-2xl shadow-card p-5">
              <MiniCalendar eventDates={upcomingDates} />
            </div>

            <PartnersBanner />

            {/* Club wall activity */}
            {wallActivity.length > 0 ? (
              <div className="bg-white rounded-2xl shadow-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-gray-900">Club wall</h2>
                  {clubs.length > 0 && (
                    <Link href={`/clubs/${clubs[0].slug}`} className="text-xs text-amber-600 font-semibold hover:underline">View →</Link>
                  )}
                </div>
                <div className="space-y-3">
                  {wallActivity.map(post => (
                    <Link key={post.id} href={`/clubs/${post.club.slug}`}
                      className="flex gap-2.5 hover:opacity-80 transition-opacity">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ backgroundColor: post.user.color }}>
                        {getInitials(post.user.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-gray-700 leading-snug">
                          <span className="font-semibold">{post.user.name.split(' ')[0]}</span>
                          {' posted in '}
                          <span className="font-semibold text-amber-600">{post.club.emoji} {post.club.name}</span>
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{post.content}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ) : recentActivity.length > 0 ? (
              <div className="bg-white rounded-2xl shadow-card p-5">
                <h2 className="text-sm font-bold text-gray-900 mb-3">New in your clubs</h2>
                <div className="space-y-3">
                  {recentActivity.map((m, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ backgroundColor: m.user.color }}>
                        {getInitials(m.user.name)}
                      </div>
                      <p className="text-xs text-gray-700 leading-snug min-w-0">
                        <span className="font-semibold">{m.user.name.split(' ')[0]}</span>
                        {' joined '}
                        <Link href={`/clubs/${m.club.slug}`} className="font-semibold text-amber-600 hover:underline">
                          {m.club.emoji} {m.club.name}
                        </Link>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Onboarding checklist — hide once all done */}
            {(() => {
              const steps = [
                { label: 'Add a profile photo',   done: !!userProfile?.profilePhoto,          href: '/profile' },
                { label: 'Write a short bio',      done: !!userProfile?.bio?.trim(),            href: '/profile' },
                { label: 'Set your neighborhood',  done: !!userProfile?.neighborhood,           href: '/profile' },
                { label: 'Pick your interests',    done: (userProfile?.interests?.length ?? 0) > 0, href: '/profile' },
                { label: 'Join a club',             done: myMemberships.length > 0,             href: '/clubs'   },
                { label: 'RSVP to an event',        done: myAttendances.length > 0,             href: '/events'  },
              ]
              const doneCount = steps.filter(s => s.done).length
              if (doneCount === steps.length) return null
              const pct = Math.round((doneCount / steps.length) * 100)
              return (
                <div className="bg-white rounded-2xl shadow-card p-5">
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-sm font-bold text-gray-900">Get started</h2>
                    <span className="text-xs font-semibold text-amber-600">{doneCount}/{steps.length}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full mb-4 overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="space-y-2">
                    {steps.map(step => (
                      <Link key={step.label} href={step.href}
                        className={`flex items-center gap-2.5 text-sm transition-colors ${step.done ? 'text-gray-400 line-through pointer-events-none' : 'text-gray-700 hover:text-amber-600'}`}>
                        <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${step.done ? 'border-green-400 bg-green-400' : 'border-gray-300'}`}>
                          {step.done && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                        {step.label}
                      </Link>
                    ))}
                  </div>
                </div>
              )
            })()}

            <QuickLinks />

            <InviteBanner />

            {referralStats.friends > 0 && (
              <ReferralImpact friendCount={referralStats.friends} eventCount={referralStats.events} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
