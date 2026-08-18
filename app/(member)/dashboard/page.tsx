import Link from 'next/link'
import { formatDate, formatTime, formatPrice, resolveImageUrl, avatarUrl, BLUR_PLACEHOLDER, todayIstanbul } from '@/lib/data'
import { articleCover } from '@/lib/articleCover'
import { neighborhoodToSlug } from '@/lib/neighborhoods'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId } from '@/lib/city'
import { DISCOVER_LINKS } from '@/lib/navLinks'
import { redirect } from 'next/navigation'
import { readFileSync } from 'fs'
import { join } from 'path'
import MiniCalendar from '@/components/MiniCalendar'
import PullToRefreshTrigger from '@/components/PullToRefreshTrigger'
import QuickLinks from '@/components/QuickLinks'
import CityWeather from '@/components/CityWeather'
import ReviewReminder from '@/components/ReviewReminder'
import VenueReviewPrompt from '@/components/VenueReviewPrompt'
import ReferralImpact from '@/components/ReferralImpact'
import InviteBanner from '@/components/InviteBanner'
import AnnouncementBanner from '@/components/AnnouncementBanner'
import OnboardingCard from '@/components/OnboardingCard'
import CupPromoBanner from '@/components/CupPromoBanner'
import CommunityPollWidget from '@/components/CommunityPollWidget'
import PendingConnectionsWidget from '@/components/PendingConnectionsWidget'
import ClubActivityTimeline from '@/components/ClubActivityTimeline'
import DashboardVisitorsStrip from '@/components/DashboardVisitorsStrip'
import PartnersBanner from '@/components/PartnersBanner'
import GetStartedChecklist from '@/components/GetStartedChecklist'
import FirstEventBlock from '@/components/FirstEventBlock'
import Image from 'next/image'
import { categoryMeta } from '@/lib/handbook-categories'

export const dynamic = 'force-dynamic'

function getInitials(name: string) {
  return name.trim().split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
}

function getGreeting() {
  // Use the IANA Europe/Istanbul zone instead of hardcoding `getUTCHours() + 3`.
  // Turkey is currently on permanent UTC+3, but a future DST change (or any
  // reader of this code wondering "why +3?") is one tzdata update away from
  // breaking the morning/afternoon/evening boundaries.
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Istanbul',
    hour:     'numeric',
    // hourCycle 'h23' — hour12:false can render midnight as "24", which
    // would fall through to "Good evening" at midnight instead of morning.
    hourCycle: 'h23',
  }).format(new Date()))
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function daysUntil(dateStr: string): number {
  const today = todayIstanbul()
  const diff  = new Date(dateStr).getTime() - new Date(today).getTime()
  return Math.ceil(diff / 86400000)
}

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  // Every discovery strip below is scoped to the viewer's city — the
  // dashboard was the biggest cross-city leak (Izmir's seeded clubs were
  // topping every Istanbul member's "new clubs" strip).
  const cityId = await resolveCityId(session)
  // The weather card needs a point and a clock, not just an id — same city the
  // rest of this page is scoped to.
  const hasNeighborhoods = (await prisma.neighborhood.count({
    where: { cityId, active: true },
  })) > 0
  const city = await prisma.city.findUnique({
    where:  { id: cityId },
    select: { name: true, lat: true, lng: true, timezone: true },
  }) ?? { name: 'Istanbul', lat: null, lng: null, timezone: 'Europe/Istanbul' }

  const today      = todayIstanbul()
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const weekAgo    = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const monthAgo    = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const weekEnd    = new Date(); weekEnd.setDate(weekEnd.getDate() + 7)
  const weekEndStr = weekEnd.toISOString().split('T')[0]
  const monthEnd    = new Date(); monthEnd.setDate(monthEnd.getDate() + 30)
  const monthEndStr = monthEnd.toISOString().split('T')[0]

  const [myAttendances, myMemberships, eventsThisMonth, userProfile, , unreviewedRaw, weeklyVisitors, recentListings, recentMovingSales] = await Promise.all([
    // Lightweight: only ids + dates are needed for the id lists, counts,
    // and month/streak math. Full event objects for the upcoming cards
    // come from the separate (take: 5) query below — avoids loading every
    // attendance's full event payload.
    prisma.eventAttendee.findMany({
      where: { userId: session.id, status: 'approved' },
      select: { eventId: true, event: { select: { date: true } } },
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
    prisma.profileView.count({
      where: { viewedId: session.id, createdAt: { gte: weekAgo } },
    }),
    prisma.listing.findMany({
      where: { status: 'active', cityId, userId: { not: session.id } },
      orderBy: { createdAt: 'desc' },
      take: 4,
      select: { id: true, title: true, category: true, photo: true, photoPosition: true, price: true, createdAt: true, user: { select: { name: true, color: true, profilePhoto: true } } },
    }),
    // Moving Sales — separate table from Listing, so it needs its own
    // query; was previously missing from the dashboard entirely.
    prisma.movingSale.findMany({
      where: { status: 'active', cityId, userId: { not: session.id } },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: {
        id: true, leavingOn: true, neighborhood: true, createdAt: true,
        items: { select: { name: true }, take: 3 },
        user: { select: { name: true, color: true, profilePhoto: true } },
      },
    }),
  ])

  // Upcoming attendances with full event payload — the only place that
  // needs the heavy event fields (cards + map). Bounded to 5. Pulled
  // OUT of the Promise.all above because the 9-tuple inference was
  // narrowing this query's event shape to the lightweight {date} of
  // the first eventAttendee query, breaking `.title` access at build
  // time (local `tsc --noEmit` didn't catch it; `next build` did).
  const upcomingAttendances = await prisma.eventAttendee.findMany({
    where: { userId: session.id, status: 'approved', event: { date: { gte: today } } },
    include: { event: { select: { id: true, title: true, date: true, time: true, neighborhood: true, emoji: true, price: true, currency: true, coverImage: true, limitedSpots: true, spotsLeft: true, lat: true, lng: true } } },
    orderBy: [{ event: { date: 'asc' } }],
    take: 5,
  })

  const unreviewed = unreviewedRaw
    .filter((a) => a.event.reviews.length === 0)
    .map((a) => ({ id: a.event.id, title: a.event.title, emoji: a.event.emoji }))

  // Post-visit venue review prompt: the member's most-recent checked-in
  // past event whose venue is a live directory listing they haven't
  // reviewed. Matches the event page's case-insensitive location↔business
  // rule. Cheap — the directory is a small curated set and the visit scan
  // is capped. Null when there's nothing to prompt (component self-hides).
  let venueToReview: { businessId: string; businessName: string; eventTitle: string } | null = null
  {
    const checkedInVisits = await prisma.eventAttendee.findMany({
      where: {
        userId: session.id, status: 'approved', checkedIn: true,
        event: { date: { lt: today }, cancelledAt: null },
      },
      orderBy: { event: { date: 'desc' } },
      take: 20,
      select: { event: { select: { title: true, location: true } } },
    })
    if (checkedInVisits.length) {
      const liveBusinesses = await prisma.business.findMany({
        where:  { isApproved: true, isActive: true },
        select: { id: true, name: true },
      })
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
      const bizByName = new Map(liveBusinesses.map((b) => [norm(b.name), b]))
      const reviewedIds = new Set(
        (await prisma.businessReview.findMany({
          where:  { authorId: session.id, businessId: { in: liveBusinesses.map((b) => b.id) } },
          select: { businessId: true },
        })).map((r) => r.businessId),
      )
      for (const v of checkedInVisits) {
        const biz = bizByName.get(norm(v.event.location ?? ''))
        if (biz && !reviewedIds.has(biz.id)) {
          venueToReview = { businessId: biz.id, businessName: biz.name, eventTitle: v.event.title }
          break
        }
      }
    }
  }

  const clubIds        = myMemberships.map((m) => m.clubId)
  const joinedEventIds = myAttendances.map((a) => a.eventId)
  const upcomingEvents = upcomingAttendances
  const clubs          = myMemberships.map((m) => m.club)
  const pastEventIds   = myAttendances.filter((a) => a.event.date < today).map((a) => a.eventId)

  // Read member spotlight from file
  let spotlightData: { userId: string; funFact: string; topSpots: string[] } | null = null
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'member-spotlight.json'), 'utf-8'))
    if (raw.userId) spotlightData = raw
  } catch { /* no spotlight set */ }

  // Read announcement
  let announcement: { text: string; link: string; active: boolean; updatedAt?: string } | null = null
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
      adBanners = data.filter((b) => b.active && b.headline)
    } else if (data?.active && data?.headline) {
      adBanners = [data]
    }
  } catch { /* no banners */ }

  // First promo-type banner gets embedded in the orange hero section.
  // Remaining banners (or non-promo types) stay in the center column.
  const heroBanner = adBanners.find((b) => b.type === 'promo') ?? null
  const centerBanners = heroBanner ? adBanners.filter((b) => b !== heroBanner) : adBanners

  // Pre-batch derivations needed inside the merged Promise.all below.
  const fourteenDaysOut = new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString().slice(0, 10)
  const suggestedMembersWhere = (() => {
    const conditions: any[] = []
    if (clubIds.length) conditions.push({ clubMemberships: { some: { clubId: { in: clubIds }, status: 'approved' } } })
    if (userProfile?.neighborhood) conditions.push({ neighborhood: userProfile.neighborhood })
    return conditions.length > 0
      ? { id: { not: session.id }, status: 'approved', OR: conditions }
      : { id: { not: session.id }, status: 'approved' }
  })()

  // One big parallel batch instead of two sequential ones with two
  // standalone awaits sandwiched between. Previously the page fanned
  // out 11 queries → awaited 2 more → fanned out 12 more, so wall time
  // was the sum of three serial round-trip phases. The only cross-
  // batch dependency was trendingEvents's `notIn` filter on the
  // featuredEvents IDs; moved to a post-fetch JS dedupe (cheap — both
  // arrays are small), so all 25 queries can run as a single fan-out.
  const [
    // formerly batch 2
    recommendedEvents, recentActivity, waitlisted, wallActivity, whosGoingRaw, spotlightUser, activePoll, featuredEvents, runningLow, recentClubEvents, referralStats,
    // formerly standalone awaits
    upcomingVisitors, latestHandbook,
    // formerly batch 3 — trendingEventsRaw is deduped against featuredEvents post-fetch
    suggestedMembers, thisWeekEvents, totalMembers, eventsThisWeek, neighborhoodEventCount, newMembers, recentPhotos, trendingEventsRaw, nearbyMembers, newClubs, latestPosts, activeHangouts, recentHangouts, recentPulses, recentConnections, recentReferences, recentRsvps, recentlyCreatedClubs, recentBusinesses,
    // activity-wall extras
    recentEventReviews, recentPlaceReviews, recentHangoutJoins, recentHoodPosts, recentResources, recentTestimonials, recentCupPicks, recentCupDonations,
    recentArticles, communityEventsThisMonth,
  ] = await Promise.all([
    clubIds.length
      ? prisma.event.findMany({
          where: { clubId: { in: clubIds }, date: { gte: today }, status: 'published', id: { notIn: joinedEventIds } },
          orderBy: { date: 'asc' }, take: 4,
          select: { id: true, title: true, date: true, time: true, emoji: true, neighborhood: true, price: true, currency: true, totalSpots: true, limitedSpots: true, coverImage: true, _count: { select: { attendees: { where: { status: 'approved' } } } } },
        })
      : userProfile?.neighborhood
        ? prisma.event.findMany({
            where: { neighborhood: userProfile.neighborhood, cityId, date: { gte: today }, status: 'published', id: { notIn: joinedEventIds } },
            orderBy: { date: 'asc' }, take: 4,
            select: { id: true, title: true, date: true, time: true, emoji: true, neighborhood: true, price: true, currency: true, totalSpots: true, limitedSpots: true, coverImage: true, _count: { select: { attendees: { where: { status: 'approved' } } } } },
          })
        : prisma.event.findMany({
            where: { cityId, date: { gte: today }, status: 'published', id: { notIn: joinedEventIds } },
            orderBy: { date: 'asc' }, take: 4,
            select: { id: true, title: true, date: true, time: true, emoji: true, neighborhood: true, price: true, currency: true, totalSpots: true, limitedSpots: true, coverImage: true, _count: { select: { attendees: { where: { status: 'approved' } } } } },
          }),
    // Club joins for the activity wall. Members of clubs see their own
    // clubs' joins; members of none fall back to community-wide joins
    // (public clubs only) so newcomers — the people who most need to
    // see a lively wall — don't get an empty club section.
    prisma.clubMembership.findMany({
      where: {
        ...(clubIds.length
          ? { clubId: { in: clubIds } }
          : { club: { isPrivate: false, isActive: true } }),
        userId: { not: session.id }, status: 'approved', joinedAt: { gte: weekAgo },
      },
      include: { user: { select: { name: true, color: true } }, club: { select: { name: true, emoji: true, slug: true } } },
      orderBy: { joinedAt: 'desc' }, take: 5,
    }),
    prisma.eventAttendee.findMany({
      where: { userId: session.id, status: 'pending' },
      include: { event: { select: { id: true, title: true, date: true, emoji: true } } },
      orderBy: { joinedAt: 'desc' }, take: 3,
    }),
    // Club wall posts — same no-clubs fallback as joins above. The
    // isPrivate filter matters here: private-club posts must not
    // leak onto a non-member's dashboard.
    prisma.clubPost.findMany({
      where: {
        ...(clubIds.length
          ? { clubId: { in: clubIds } }
          : { club: { isPrivate: false, isActive: true } }),
        type: { in: ['post', 'announcement'] },
      },
      orderBy: { createdAt: 'desc' }, take: 4,
      include: {
        user: { select: { name: true, color: true, profilePhoto: true } },
        club: { select: { name: true, emoji: true, slug: true } },
        poll: { select: { question: true } },
      },
    }),
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
      select: { id: true, title: true, date: true, time: true, emoji: true, neighborhood: true, price: true, currency: true, spotsLeft: true, limitedSpots: true, coverImage: true },
    }),
    // Spots running low: upcoming events with ≤5 spots left that user hasn't
    // joined. Ordered soonest-first (date is text 'YYYY-MM-DD', so asc = chrono)
    // so the closest event sits on top — the one you need to grab a spot for now.
    prisma.event.findMany({
      where: { date: { gte: today }, status: 'published', limitedSpots: true, spotsLeft: { gt: 0, lte: 5 }, id: { notIn: joinedEventIds } },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
      take: 4,
      select: { id: true, title: true, date: true, emoji: true, spotsLeft: true, neighborhood: true, price: true },
    }),
    // Events created in user's clubs within the last 14 days — feeds the
    // unified ClubActivityTimeline alongside new members + new posts.
    // createdAt (not date) drives recency so an event posted yesterday
    // for next month still surfaces as "new in your clubs". Exclude
    // events already on the user's calendar — the timeline is about
    // *discovery*, not nagging members about RSVPs they've made.
    prisma.event.findMany({
      where: {
        ...(clubIds.length
          ? { clubId: { in: clubIds } }
          : { club: { isPrivate: false, isActive: true } }),
        status:    'published',
        createdAt: { gte: twoWeeksAgo },
        id:        { notIn: joinedEventIds },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { club: { select: { name: true, emoji: true, slug: true } } },
    }),
    // Referral stats — reuses userProfile.referralCode (already loaded in
    // batch 1) instead of a redundant prisma.user.findUnique. Self-hides
    // when the user has no referral code or no successful referrals.
    (async () => {
      if (!userProfile?.referralCode) return { friends: 0, events: 0 }
      const apps = await prisma.memberApplication.findMany({
        where: { referredBy: userProfile.referralCode, status: 'approved' },
        select: { email: true }
      })
      if (!apps.length) return { friends: 0, events: 0 }
      const emails = apps.map(a => a.email.toLowerCase().trim())
      const eventCount = await prisma.eventAttendee.count({
        where: { user: { email: { in: emails } }, status: 'approved' }
      })
      return { friends: emails.length, events: eventCount }
    })(),
    // Upcoming visitors — surfaces the /visiting page on the highest-
    // traffic dashboard so the wave feature lives where members actually
    // are. Filters: only member-posted, starting within the next 14 days,
    // excludes the current user.
    prisma.visitorAnnouncement.findMany({
      where: {
        status:   'active',
        userId:   { not: session.id },
        endsOn:   { gte: today },
        startsOn: { lte: fourteenDaysOut },
      },
      orderBy: { startsOn: 'asc' },
      take: 4,
      include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
    }),
    // From the Handbook — surfaces the freshest expat-survival articles
    // so members discover the KB without leaving the dashboard. Same
    // shape as latestPosts so we can reuse the existing card markup.
    prisma.post.findMany({
      // null cityId = global article, shown in every city.
      where:   { status: 'published', kind: 'handbook', OR: [{ cityId }, { cityId: null }] },
      orderBy: { publishedAt: 'desc' },
      take: 2,
      select: { id: true, title: true, slug: true, excerpt: true, coverImage: true, body: true, category: true, publishedAt: true },
    }),
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
      select: { id: true, title: true, date: true, emoji: true, neighborhood: true, price: true, currency: true },
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
    // Merge event-attached photos with standalone club photos so a
    // photo uploaded directly to a club (no event) still surfaces here.
    // Over-fetch from each pool, then trim to 9 after a unified sort.
    Promise.all([
      prisma.eventPhoto.findMany({
        orderBy: { createdAt: 'desc' },
        take: 9,
        select: { id: true, url: true, caption: true, createdAt: true, eventId: true, event: { select: { title: true } }, user: { select: { name: true, color: true } } },
      }),
      prisma.clubPhoto.findMany({
        orderBy: { createdAt: 'desc' },
        take: 9,
        select: { id: true, url: true, caption: true, createdAt: true, club: { select: { slug: true, name: true } }, user: { select: { name: true, color: true } } },
      }),
    ]).then(([eventPhotos, clubPhotos]) => [
      ...eventPhotos.map(p => ({ id: p.id, url: p.url, caption: p.caption, createdAt: p.createdAt, href: `/events/${p.eventId}`, title: p.event.title, user: p.user })),
      ...clubPhotos.map(p => ({ id: p.id, url: p.url, caption: p.caption, createdAt: p.createdAt, href: `/clubs/${p.club.slug}?tab=photos`, title: p.club.name, user: p.user })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 9)),
    // Trending: upcoming events with the most attendees. The featured-
    // event exclusion that used to live in the WHERE clause is now a
    // post-fetch JS dedupe so this query no longer waits on featuredEvents.
    // Over-fetch by the featured `take: 3` to absorb the dedupe loss.
    prisma.event.findMany({
      where: { cityId, date: { gte: today }, status: 'published', id: { notIn: joinedEventIds } },
      orderBy: { attendees: { _count: 'desc' } },
      take: 7,
      select: { id: true, title: true, date: true, emoji: true, neighborhood: true, price: true, currency: true, totalSpots: true, spotsLeft: true, limitedSpots: true, _count: { select: { attendees: { where: { status: 'approved' } } } } },
    }),
    // Members near you: same neighborhood, excluding self
    userProfile?.neighborhood
      ? prisma.user.findMany({
          where: { neighborhood: userProfile.neighborhood, status: 'approved', cityId, id: { not: session.id } },
          select: { id: true, name: true, color: true, profilePhoto: true, bio: true },
          orderBy: { joinedAt: 'desc' },
          take: 6,
        })
      : Promise.resolve([]),
    // New clubs the user hasn't joined, ordered by member count
    prisma.club.findMany({
      where: { isActive: true, cityId, id: { notIn: clubIds } },
      orderBy: { memberCount: 'desc' },
      take: 4,
      select: { id: true, name: true, slug: true, emoji: true, bgColor: true, memberCount: true, description: true },
    }),
    // Latest published posts from admin — community-style only; the
    // handbook articles get their own surface via `latestHandbook` so
    // the "From Smileys" strip doesn't mix the two editorial voices.
    prisma.post.findMany({
      where: { status: 'published', kind: 'community' },
      orderBy: { publishedAt: 'desc' },
      take: 3,
      select: { id: true, title: true, slug: true, excerpt: true, coverImage: true, body: true, category: true, publishedAt: true },
    }),
    // Active hangouts happening now
    prisma.hangout.findMany({
      where: { status: 'active', cityId, endsAt: { gt: new Date() } },
      select: { id: true, neighborhood: true },
      orderBy: { startsAt: 'asc' },
      take: 10,
    }),
    // Recent hangouts posted — feeds ClubActivityTimeline so the dashboard
    // cross-promotes spontaneous meetups alongside club activity.
    prisma.hangout.findMany({
      where: { status: 'active', cityId, endsAt: { gt: new Date() }, createdAt: { gte: weekAgo }, userId: { not: session.id } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true, title: true, neighborhood: true, createdAt: true,
        user: { select: { name: true, color: true } },
      },
    }),
    // Active availability pulses — members flagging they're free to meet up
    // right now. Non-expired only (until >= now); feeds the "free right
    // now" strip (id/photo for avatars) + ClubActivityTimeline. Excludes
    // the viewer's own, last 7 days.
    prisma.availabilityPulse.findMany({
      where: { until: { gte: new Date() }, cityId, createdAt: { gte: weekAgo }, userId: { not: session.id } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true, neighborhood: true, note: true, until: true, createdAt: true,
        user: { select: { id: true, name: true, color: true, profilePhoto: true } },
      },
    }),
    // Recent accepted connections — social proof that the network is active.
    // Excludes the current user's own connections (they know about those).
    prisma.memberConnection.findMany({
      where: {
        status:    'accepted',
        updatedAt: { gte: weekAgo },
        NOT: { OR: [{ requesterId: session.id }, { receiverId: session.id }] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: {
        updatedAt: true,
        requester: { select: { name: true, color: true } },
        receiver:  { select: { name: true, color: true } },
      },
    }),
    // Recent good hangout references — reinforces the trust system.
    // Only 'good' vibes to keep the feed positive.
    prisma.hangoutReference.findMany({
      where: {
        vibe:       'good',
        createdAt:  { gte: weekAgo },
        fromUserId: { not: session.id },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        createdAt: true,
        fromUser:  { select: { name: true, color: true } },
        hangout:   { select: { id: true, title: true } },
      },
    }),
    // Recent RSVPs to events — feeds ClubActivityTimeline so members see
    // when others sign up for events they might also care about.
    prisma.eventAttendee.findMany({
      where: {
        status:    'approved',
        userId:    { not: session.id },
        joinedAt:  { gte: weekAgo },
        event:     { status: 'published', date: { gte: today } },
      },
      orderBy: { joinedAt: 'desc' },
      take: 8,
      select: {
        joinedAt: true,
        user:  { select: { name: true, color: true } },
        event: { select: { id: true, title: true, emoji: true } },
      },
    }),
    // Clubs created in the last 14 days — feeds ClubActivityTimeline so a
    // brand-new club gets dashboard visibility while it has zero members.
    prisma.club.findMany({
      where:   { isActive: true, cityId, createdAt: { gte: twoWeeksAgo } },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { id: true, name: true, slug: true, emoji: true, createdAt: true },
    }),
    // Newly approved directory places — only after moderation so
    // unreviewed submissions never surface on the dashboard.
    prisma.business.findMany({
      where:   { isApproved: true, isActive: true, cityId, createdAt: { gte: twoWeeksAgo } },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { id: true, name: true, category: true, createdAt: true },
    }),
    // Event reviews — 4★+ only, mirroring the 'good'-vibes filter on
    // hangout references so the wall stays celebratory, not gripey.
    prisma.review.findMany({
      where:   { rating: { gte: 4 }, createdAt: { gte: weekAgo }, userId: { not: session.id } },
      orderBy: { createdAt: 'desc' },
      take: 4,
      select: {
        rating: true, createdAt: true,
        user:  { select: { name: true, color: true } },
        event: { select: { id: true, title: true, emoji: true } },
      },
    }),
    // Directory reviews — 4★+, not moderated away, on live places only.
    prisma.businessReview.findMany({
      where: {
        rating:    { gte: 4 },
        isHidden:  false,
        createdAt: { gte: weekAgo },
        authorId:  { not: session.id },
        business:  { isApproved: true, isActive: true },
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: {
        rating: true, createdAt: true,
        author:   { select: { name: true, color: true } },
        business: { select: { id: true, name: true } },
      },
    }),
    // Hangout joins — joining is as strong a social signal as posting.
    prisma.hangoutJoin.findMany({
      where:   { createdAt: { gte: weekAgo }, userId: { not: session.id }, hangout: { status: 'active' } },
      orderBy: { createdAt: 'desc' },
      take: 4,
      select: {
        createdAt: true,
        user:    { select: { name: true, color: true } },
        hangout: { select: { id: true, title: true } },
      },
    }),
    // Neighborhood wall posts.
    prisma.neighborhoodPost.findMany({
      where:   { createdAt: { gte: weekAgo }, userId: { not: session.id } },
      orderBy: { createdAt: 'desc' },
      take: 4,
      select: {
        id: true, content: true, neighborhood: true, createdAt: true,
        user: { select: { name: true, color: true } },
      },
    }),
    // New resources added in the user's clubs.
    clubIds.length
      ? prisma.clubResource.findMany({
          where:   { clubId: { in: clubIds }, createdAt: { gte: twoWeeksAgo } },
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: { id: true, title: true, emoji: true, createdAt: true, club: { select: { name: true, emoji: true, slug: true } } },
        })
      : Promise.resolve([]),
    // Fresh member testimonials (admin-curated, active only).
    prisma.testimonial.findMany({
      where:   { active: true, createdAt: { gte: twoWeeksAgo } },
      orderBy: { createdAt: 'desc' },
      take: 2,
      select: { id: true, memberName: true, quote: true, createdAt: true },
    }),
    // Cup predictions — seasonal banter while the campaign runs.
    prisma.cupPrediction.findMany({
      where:   { submittedAt: { gte: weekAgo }, userId: { not: session.id } },
      orderBy: { submittedAt: 'desc' },
      take: 3,
      select: { pickedTeam: true, submittedAt: true, user: { select: { name: true, color: true } } },
    }),
    // Approved Cup prize donations — celebrate sponsors; pending ones
    // stay hidden until an admin reviews them.
    prisma.cupPrizeDonation.findMany({
      where:   { status: 'approved', createdAt: { gte: twoWeeksAgo } },
      orderBy: { createdAt: 'desc' },
      take: 2,
      select: { id: true, donorName: true, donorOrganization: true, prizeTitle: true, createdAt: true },
    }),
    // Recently published articles (handbook + community) for the activity wall.
    // Windowed to the last 30 days and ranked by recency like every other wall
    // source (NOT pinned): a fresh article surfaces when posted, then naturally
    // rolls off as newer activity — and newer articles — take its place. The
    // dedicated "From Smileys" / "From the Handbook" strips carry the full list.
    prisma.post.findMany({
      where:   { status: 'published', kind: { in: ['handbook', 'community'] }, publishedAt: { gte: monthAgo } },
      orderBy: { publishedAt: 'desc' },
      take: 5,
      select: { id: true, title: true, slug: true, kind: true, publishedAt: true },
    }),
    // Community-wide events in the next 30 days — the "Events this month" stat.
    // (eventsThisMonth above is the viewer's OWN attendances; this is the whole
    // community, parallel to eventsThisWeek's next-7-days count so month ≥ week.)
    prisma.event.count({ where: { date: { gte: today, lte: monthEndStr }, status: 'published' } }),
  ])

  // Activity wall reuses the batch-1 recentListings (already active-only,
  // own excluded) — just narrowed to the wall's 7-day freshness window so
  // a stale board doesn't surface month-old listings as "activity".
  const wallListings = recentListings.filter(l => new Date(l.createdAt) >= weekAgo)

  // Same reuse for visitor announcements: upcomingVisitors already holds
  // active, member-posted, soon-starting announcements — the wall only
  // wants the freshly *posted* ones.
  const wallVisitors = upcomingVisitors
    .filter(v => new Date(v.createdAt) >= weekAgo)
    .map(v => ({ id: v.id, name: v.name, fromCity: v.fromCity, createdAt: v.createdAt }))

  // Neighborhood pages route by slug, but posts store the display name.
  const wallHoodPosts = recentHoodPosts.map(p => ({ ...p, slug: neighborhoodToSlug(p.neighborhood) }))

  // Build poll data for widget
  let pollForWidget = null
  if (activePoll) {
    const userVote = await prisma.communityPollVote.findUnique({
      where: { userId_pollId: { userId: session.id, pollId: activePoll.id } },
      select: { optionId: true },
    })
    const totalVotes = activePoll.options.reduce((s: number, o) => s + o._count.votes, 0)
    pollForWidget = {
      id:            activePoll.id,
      question:      activePoll.question,
      totalVotes,
      votedOptionId: userVote?.optionId ?? null,
      options: activePoll.options.map((o) => ({
        id:      o.id,
        text:    o.text,
        votes:   o._count.votes,
        percent: totalVotes > 0 ? Math.round((o._count.votes / totalVotes) * 100) : 0,
      })),
    }
  }

  // Deduplicate who's going by userId
  const seenUsers = new Set<string>()
  const whosGoing = whosGoingRaw.filter((a) => seenUsers.has(a.userId) ? false : (seenUsers.add(a.userId), true)).slice(0, 8)

  // Deduplicate nearbyMembers: exclude anyone already in suggestedMembers
  const suggestedMemberIds = new Set(suggestedMembers.map((m) => m.id))
  const deduplicatedNearby = nearbyMembers.filter((m) => !suggestedMemberIds.has(m.id))

  const upcomingDates  = upcomingEvents.map((a) => a.event.date)
  const nextEvent      = upcomingEvents[0]
  const daysToNext     = nextEvent ? daysUntil(nextEvent.event.date) : null
  const memberSince    = userProfile?.joinedAt
    ? new Date(userProfile.joinedAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : null

  // Monthly streak: consecutive months (going back from now) with ≥1 event attended
  const monthsWithEvents = new Set(
    myAttendances.filter((a) => a.event.date <= today).map((a) => a.event.date.slice(0, 7))
  )
  let monthStreak = 0
  {
    const d = new Date()
    let yr = d.getFullYear(), mo = d.getMonth() + 1
    while (monthStreak < 36) {
      const key = `${yr}-${String(mo).padStart(2, '0')}`
      if (!monthsWithEvents.has(key)) break
      monthStreak++
      mo--; if (mo === 0) { mo = 12; yr-- }
    }
  }

  // Deduplicate: recommended must not repeat featured events
  const featuredIds = new Set(featuredEvents.map((e) => e.id))
  const deduplicatedRecommended = recommendedEvents.filter((e) => !featuredIds.has(e.id))
  // Post-fetch dedupe of trending against featured (used to live in the
  // SQL WHERE clause; moved here so the query no longer waited on
  // featuredEvents). Slice to 4 to match the original UI cap.
  const trendingEvents = trendingEventsRaw.filter((e) => !featuredIds.has(e.id)).slice(0, 4)

  // Trimmed from 6 vanity tiles to 4 — drops "Events attended" (lifetime
  // total grows slowly) and "My clubs" (changes once a month). The
  // remaining four are either forward-looking (Upcoming, This month),
  // motivational (Month streak), or actually-clickable (Profile views).
  const stats: { label: string; value: number; href?: string }[] = [
    { label: 'Upcoming',      value: upcomingEvents.length },
    { label: 'Profile views', value: weeklyVisitors, href: '/profile-visitors' },
    { label: 'Month streak',  value: monthStreak           },
    { label: 'This month',    value: eventsThisMonth       },
  ]

  return (
    <div className="min-h-screen bg-warm pb-20 md:pb-10">
      <PullToRefreshTrigger />

      {/* Header hero — subtle amber wash with dark text. Previously a
          saturated amber→orange gradient with white text; on a daily
          surface that read as a marketing page. Calmer wash + darker
          text scales better visit-over-visit, while the soft amber
          dust keeps the brand identity. */}
      <div className="bg-gradient-to-br from-amber-50 to-orange-50 border-b border-amber-100 relative overflow-hidden">
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(ellipse_at_top_right,#fcd34d_0%,transparent_60%)]" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-5 sm:pt-10 sm:pb-6 relative z-10">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-amber-700 text-sm font-medium mb-1">{getGreeting()} 👋</p>
              <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight truncate">
                {session.name.split(' ')[0]}
              </h1>
              {nextEvent && (
                <div className="mt-3 inline-flex items-center gap-2 bg-white border border-amber-200 text-gray-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                  <span>Next: {nextEvent.event.title}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    daysToNext === 0 ? 'bg-red-500 text-white' :
                    daysToNext === 1 ? 'bg-amber-400 text-white' :
                    'bg-amber-100 text-amber-700'
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
                // 128-wide thumb instead of the full 1200×1200 original.
                // ~50× smaller wire bytes for the same 14×14 CSS render.
                <img src={avatarUrl(userProfile.profilePhoto, 128)} alt={session.name} loading="lazy" decoding="async"
                  className="w-14 h-14 rounded-2xl object-cover ring-2 ring-amber-200 shadow" />
              ) : (
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-lg font-bold ring-2 ring-amber-200 shadow"
                  style={{ backgroundColor: userProfile?.color ?? '#b45309' }}>
                  {getInitials(session.name)}
                </div>
              )}
            </div>
          </div>

          {/* Hero promo banner */}
          {heroBanner && (
            <div className="mt-4">
              {heroBanner.link ? (
                <a href={heroBanner.link}
                  target={heroBanner.link.startsWith('http') ? '_blank' : undefined}
                  rel={heroBanner.link.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className="flex items-center gap-3 bg-white border border-amber-200 hover:border-amber-300 rounded-xl px-3 py-2.5 transition-colors group">
                  <div className="shrink-0 w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center text-lg">{heroBanner.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-0.5">From Smileys</p>
                    <p className="text-sm font-bold text-gray-900 truncate">{heroBanner.headline}</p>
                    {heroBanner.subtitle && <p className="text-xs text-gray-600 truncate">{heroBanner.subtitle}</p>}
                  </div>
                  {heroBanner.cta && <span className="text-xs font-bold text-amber-700 shrink-0 group-hover:translate-x-0.5 transition-transform">{heroBanner.cta} →</span>}
                </a>
              ) : (
                <div className="flex items-center gap-3 bg-white border border-amber-200 rounded-xl px-3 py-2.5">
                  <div className="shrink-0 w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center text-lg">{heroBanner.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-0.5">From Smileys</p>
                    <p className="text-sm font-bold text-gray-900 truncate">{heroBanner.headline}</p>
                    {heroBanner.subtitle && <p className="text-xs text-gray-600 truncate">{heroBanner.subtitle}</p>}
                  </div>
                  {heroBanner.cta && <span className="text-xs font-bold text-amber-700 shrink-0">{heroBanner.cta} →</span>}
                </div>
              )}
            </div>
          )}

          {/* Quick stats strip */}
          <div className="grid grid-cols-4 gap-2 mt-3">
            {stats.map((s) => {
              const inner = (
                <>
                  <div className="text-lg font-extrabold text-gray-900 leading-none">{s.value}</div>
                  <div className="text-[11px] text-gray-600 mt-1 leading-tight">{s.label}</div>
                </>
              )
              const cls = 'bg-white border border-amber-100 rounded-xl px-2 py-2.5 text-center'
              return s.href ? (
                <Link key={s.label} href={s.href} className={`${cls} relative hover:border-amber-300 transition-colors`}>
                  <span aria-hidden="true" className="absolute top-1 right-1.5 text-[11px] font-bold text-amber-500 leading-none">→</span>
                  {inner}
                </Link>
              ) : (
                <div key={s.label} className={cls}>{inner}</div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Flex column on mobile (was a plain block stack) so the
            children can re-order with `order-N`. On desktop reverts to
            lg:flex-row with the original left/center/right layout. */}
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-6 lg:space-y-0">

          {/* ── LEFT ── */}
          {/* Mobile: order-2 — slips below the action-dense CENTER
              column so members see urgent events + recent activity
              before their own profile card and social-discovery
              widgets. Desktop layout (order-1) is unchanged. */}
          <div className="order-2 lg:order-1 lg:w-60 lg:shrink-0 space-y-4">

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
                  <p className="text-xs text-gray-600 leading-relaxed line-clamp-2 mt-2">{userProfile.bio}</p>
                )}
                {!userProfile?.gender && (
                  <div className="mt-3 p-3 bg-red-50 rounded-xl flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-red-700">⚠️ Set your gender to join gender-balanced events</p>
                    <Link href="/profile" className="text-xs text-red-600 font-bold shrink-0">Set now →</Link>
                  </div>
                )}
                {/* Profile-completion % banner removed — the Get started
                    checklist below (mobile) / right rail (desktop) already
                    owns this nudge with specific steps, not just a number. */}
              </div>
            </div>

            {/* Who's Going — social context */}
            {whosGoing.length > 0 && (
              <div className="bg-white rounded-2xl shadow-card p-5">
                <h2 className="text-sm font-bold text-gray-900 mb-1">Who's going 👀</h2>
                <p className="text-xs text-gray-400 mb-3">Familiar faces at upcoming events</p>
                <div className="flex flex-wrap gap-3 pb-1">
                  {whosGoing.map((a) => (
                    <Link key={a.user.id} href={`/events/${a.event.id}`}
                      className="flex flex-col items-center gap-1.5 shrink-0 group">
                      {a.user.profilePhoto ? (
                        <img src={avatarUrl(a.user.profilePhoto, 96)} alt={a.user.name} loading="lazy" decoding="async"
                          className="w-11 h-11 rounded-full object-cover border-2 border-white shadow-sm group-hover:ring-2 group-hover:ring-amber-400 transition-all" />
                      ) : (
                        <div className="w-11 h-11 rounded-full border-2 border-white shadow-sm flex items-center justify-center text-white text-xs font-bold group-hover:ring-2 group-hover:ring-amber-400 transition-all"
                          style={{ backgroundColor: a.user.color }}>
                          {a.user.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                        </div>
                      )}
                      <span className="text-xs text-gray-600 text-center leading-tight max-w-[48px] truncate">
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
                {spotlightData.topSpots.some((s) => s) && (
                  <div>
                    <p className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">Top Istanbul spots</p>
                    <div className="space-y-1">
                      {spotlightData.topSpots.filter((s) => s).map((spot, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs text-gray-600">
                          <span className="text-amber-500 font-bold">{i + 1}.</span> {spot}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Poll of the week — engagement */}
            <CommunityPollWidget initial={pollForWidget} />

            {/* New members this week */}
            {newMembers.length > 0 && (
              <div className="bg-white rounded-2xl shadow-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest">New this week 🌱</h2>
                  <Link href="/members" className="text-xs text-amber-600 font-semibold hover:underline">See all</Link>
                </div>
                <div className="space-y-2.5">
                  {newMembers.map((m) => {
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
                  <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest">Recent photos 📸</h2>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {recentPhotos.map((p) => (
                    <Link key={p.id} href={p.href}
                      className="relative aspect-square rounded-xl overflow-hidden group block bg-gray-100">
                      <img
                        src={resolveImageUrl(p.url)}
                        alt={p.caption ?? p.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* New on Smileys — Handbook highlight */}
            {latestHandbook.length > 0 && (
              <div className="bg-white rounded-2xl shadow-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest">New on Smileys</h2>
                  <span className="text-base">📖</span>
                </div>
                <Link href="/handbook" className="block mb-3 group">
                  <p className="text-xs font-semibold text-amber-600 mb-1">The Handbook</p>
                  <p className="text-xs text-gray-600 leading-relaxed">Permits, banking, transport — written by members who lived it.</p>
                </Link>
                <div className="space-y-2 border-t border-gray-100 pt-3">
                  {latestHandbook.map((post) => (
                    <Link key={post.id} href={`/handbook/${post.slug}`}
                      className="flex items-start gap-2 group">
                      {/* Emoji comes from the shared category table (which
                          resolves legacy keys) rather than a local copy — the
                          inline map here silently fell back to 📖 for every
                          category added after it was written. */}
                      <span className="text-sm shrink-0 mt-0.5">
                        {categoryMeta(post.category)?.emoji ?? '📖'}
                      </span>
                      <p className="text-xs text-gray-700 group-hover:text-amber-600 transition-colors leading-snug line-clamp-2">{post.title}</p>
                    </Link>
                  ))}
                </div>
                <Link href="/handbook"
                  className="mt-3 flex items-center justify-center gap-1 w-full py-2 text-xs font-semibold text-amber-600 border border-amber-200 rounded-xl hover:bg-amber-50 transition-colors">
                  Read the Handbook →
                </Link>
              </div>
            )}

            {/* Onboarding card — dismissible, least priority for established members */}
            <OnboardingCard />

          </div>

          {/* ── CENTER ── */}
          {/* Mobile: order-1 — urgent + action-rich content (filling
              up fast, my upcoming events, recent activity, recommended)
              renders first so the dashboard opens onto something the
              member can act on, not their own profile card. */}
          <div className="order-1 lg:order-2 flex-1 min-w-0 space-y-6">

            {/* Newcomer activation: members who have never RSVP'd lead with a
                hand-picked first event — signed-in→first-RSVP is the biggest
                funnel leak. Self-hides the moment they join one. */}
            {myAttendances.length === 0 && <FirstEventBlock />}

            {/* Urgent-first: system announcement + pending connection
                requests (action items) used to live in the left rail,
                which lands at #20+ on mobile after the whole center
                column. Promoted to the top of the center column so
                they're above the fold on every viewport. Each is
                self-hiding when there's nothing to show. */}
            {announcement && (
              <AnnouncementBanner text={announcement.text} link={announcement.link || undefined} updatedAt={announcement.updatedAt} />
            )}

            <PendingConnectionsWidget />

            {/* Mobile-only render of Get started — the right-rail copy is
                hidden under lg, so this keeps the onboarding nudge present
                on phones / tablets. Same component, same null-when-done
                behaviour. */}
            <div className="lg:hidden">
              <GetStartedChecklist
                hasProfilePhoto={!!userProfile?.profilePhoto}
                hasBio={!!userProfile?.bio?.trim()}
                hasNeighborhood={!!userProfile?.neighborhood}
                interestCount={userProfile?.interests?.length ?? 0}
                clubCount={myMemberships.length}
                attendedCount={myAttendances.length}
              />
            </div>

            {/* ── ACTIONS ── */}
            <ReviewReminder events={unreviewed} />

            {/* Post-visit venue review — inline one-tap rating for the most
                recent checked-in venue the member hasn't reviewed. */}
            {venueToReview && <VenueReviewPrompt {...venueToReview} />}

            {/* Live hangouts strip */}
            {activeHangouts.length > 0 && (
              <Link href="/hangouts" className="block group">
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-3 hover:from-amber-100 hover:to-orange-100 transition-colors">
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                    <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">Live</span>
                  </div>
                  <p className="text-sm text-amber-900 flex-1 truncate">
                    <strong>{activeHangouts.length}</strong> hangout{activeHangouts.length !== 1 ? 's' : ''} happening now
                    {activeHangouts[0]?.neighborhood && (
                      <span className="text-amber-700 font-normal"> · starting in {activeHangouts[0].neighborhood}</span>
                    )}
                  </p>
                  <span className="text-xs font-bold text-amber-600 shrink-0 group-hover:translate-x-0.5 transition-transform">See all →</span>
                </div>
              </Link>
            )}

            {/* Advertisement banners (promo type moved to hero; only remaining types show here) */}
            {centerBanners.length > 0 && (
              <div className={`grid gap-3 ${centerBanners.length === 1 ? 'grid-cols-1' : centerBanners.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
                {centerBanners.map((banner, i) => {
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

            {/* Free right now — live pulses get dashboard visibility so
                they reach members who'd never think to open /hangouts.
                Time-sensitive (pulses die within 4h), hence high placement;
                self-hides when nobody's around. */}
            {recentPulses.length > 0 && (
              <Link href="/hangouts"
                className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-2xl px-4 py-3 hover:border-green-400 transition-colors">
                <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                </span>
                <div className="flex -space-x-1.5 shrink-0">
                  {recentPulses.slice(0, 4).map(p => (
                    p.user.profilePhoto
                      ? <Image key={p.id} src={avatarUrl(p.user.profilePhoto, 64)} alt={p.user.name} width={28} height={28}
                          className="w-7 h-7 rounded-full border-2 border-white object-cover" />
                      : <div key={p.id} className="w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-white text-[10px] font-bold"
                          style={{ backgroundColor: p.user.color }}>{getInitials(p.user.name)}</div>
                  ))}
                </div>
                <p className="text-sm text-green-900 min-w-0 flex-1 truncate">
                  <span className="font-bold">
                    {recentPulses.length === 1
                      ? `${recentPulses[0].user.name.split(' ')[0]} is free to meet right now`
                      : `${recentPulses.length} members are free to meet right now`}
                  </span>
                </p>
                <span className="text-xs font-bold text-green-700 shrink-0">Say hi →</span>
              </Link>
            )}

            {/* Recent activity — moved here from the right rail so it
                anchors above the urgent "Filling up fast" card on both
                mobile and desktop. Center column renders on every
                viewport, so a single placement replaces the previous
                two (mobile-only + right-rail) renders. */}
            <ClubActivityTimeline members={recentActivity} posts={wallActivity} events={recentClubEvents} photos={recentPhotos} rsvps={recentRsvps} newMembers={newMembers} hangouts={recentHangouts} pulses={recentPulses} connections={recentConnections} references={recentReferences} newClubs={recentlyCreatedClubs} listings={wallListings} businesses={recentBusinesses} eventReviews={recentEventReviews} placeReviews={recentPlaceReviews} visitors={wallVisitors} hangoutJoins={recentHangoutJoins} hoodPosts={wallHoodPosts} resources={recentResources} testimonials={recentTestimonials} cupPicks={recentCupPicks} cupDonations={recentCupDonations} articles={recentArticles} cap={12} />

            {/* Upcoming visitors — surfaces /visiting + the new wave
                action on the dashboard. Component renders nothing when
                empty, so it self-hides on quiet weeks. */}
            <DashboardVisitorsStrip visitors={upcomingVisitors.map(v => ({
              id:       v.id,
              name:     v.name,
              startsOn: typeof v.startsOn === 'string' ? v.startsOn : new Date(v.startsOn).toISOString().split('T')[0],
              endsOn:   typeof v.endsOn   === 'string' ? v.endsOn   : new Date(v.endsOn).toISOString().split('T')[0],
              user:     v.user ?? null,
            }))} />

            {/* Spots running low — urgent, time-sensitive */}
            {runningLow.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">🔥</span>
                  <h3 className="text-sm font-bold text-red-800">Filling up fast</h3>
                  <span className="ml-auto text-[10px] font-bold text-red-500 bg-red-100 px-2 py-0.5 rounded-full uppercase tracking-wide">Limited spots</span>
                </div>
                <div className="space-y-2">
                  {runningLow.map((event) => (
                    <Link key={event.id} href={`/events/${event.id}`}
                      className="flex items-center gap-3 bg-white rounded-xl p-3 border border-red-100 hover:border-red-300 hover:-translate-y-0.5 transition-all group">
                      <span className="text-xl shrink-0">{event.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-red-700 transition-colors truncate">{event.title}</p>
                        <p className="text-xs text-gray-600 mt-0.5">{formatDate(event.date)} · 📍 {event.neighborhood}</p>
                      </div>
                      <span className="text-xs font-extrabold text-red-600 bg-red-100 px-2 py-1 rounded-lg shrink-0">{event.spotsLeft} left</span>
                    </Link>
                  ))}
                </div>
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

            {/* ── PHASE: DISCOVER ── visible chunking between the urgent
                "things needing your attention" block above and the broader
                content-discovery block below. Quiet eyebrow + hairline so
                the rhythm reads without adding text noise. */}
            <div className="flex items-center gap-3 pt-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Discover</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* From Smileys — latest published articles */}
            {latestPosts.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">From Smileys</h2>
                    <p className="text-xs text-gray-400 mt-0.5">News, guides &amp; community updates</p>
                  </div>
                  <Link href="/posts" className="text-sm text-amber-600 font-semibold hover:underline">All →</Link>
                </div>
                <div className="space-y-3">
                  {latestPosts.map((post) => {
                    const cover = articleCover({ coverImage: post.coverImage, body: post.body })
                    return (
                    <Link key={post.id} href={`/posts/${post.slug}`}
                      className="group flex gap-3 bg-white rounded-2xl shadow-card p-4 hover:-translate-y-0.5 transition-transform duration-200">
                      {cover ? (
                        <img src={cover} alt={post.title} loading="lazy"
                          className="w-16 h-16 rounded-xl object-cover shrink-0" />
                      ) : (
                        <div className="w-16 h-16 rounded-xl bg-amber-50 flex items-center justify-center text-2xl shrink-0">📰</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">{post.category}</span>
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-amber-700 transition-colors leading-snug mt-0.5">{post.title}</p>
                        {post.excerpt && (
                          <p className="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed">{post.excerpt}</p>
                        )}
                      </div>
                    </Link>
                    )
                  })}
                </div>
              </div>
            )}

            {/* From The Handbook — surfaces the freshest expat-survival
                articles right after the community-articles strip. Same
                card layout as "From Smileys", differentiated by a 📖
                fallback icon, blue category chip (matches the Handbook
                category color palette), and a deeper "View handbook"
                CTA that lands on /handbook rather than /posts. */}
            {latestHandbook.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">From The Handbook</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Living in Istanbul, decoded by members</p>
                  </div>
                  <Link href="/handbook" className="text-sm text-amber-600 font-semibold hover:underline">All →</Link>
                </div>
                <div className="space-y-3">
                  {latestHandbook.map(post => {
                    const cover = articleCover({ coverImage: post.coverImage, body: post.body })
                    return (
                    <Link key={post.id} href={`/handbook/${post.slug}`}
                      className="group flex gap-3 bg-white rounded-2xl shadow-card p-4 hover:-translate-y-0.5 transition-transform duration-200">
                      {cover ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={cover} alt={post.title} loading="lazy"
                          className="w-16 h-16 rounded-xl object-cover shrink-0" />
                      ) : (
                        <div className="w-16 h-16 rounded-xl bg-gray-50 flex items-center justify-center text-2xl shrink-0">📖</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{post.category}</span>
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-amber-700 transition-colors leading-snug mt-0.5">{post.title}</p>
                        {post.excerpt && (
                          <p className="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed">{post.excerpt}</p>
                        )}
                      </div>
                    </Link>
                    )
                  })}
                </div>
              </div>
            )}

            {/* My upcoming events */}
            {nextEvent ? (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xl font-bold text-gray-900">My upcoming events</h2>
                  <Link href="/my-events" className="text-sm text-amber-600 font-semibold hover:underline">See all →</Link>
                </div>
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
                            daysToNext === 1 ? 'bg-amber-500 text-white' :
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
                          <p className="text-xs text-gray-600 mt-0.5">{formatDate(nextEvent.event.date)} · {formatTime(nextEvent.event.time)}</p>
                          <p className="text-xs text-gray-400 mt-0.5">📍 {nextEvent.event.neighborhood}</p>
                        </div>
                        <span className={`shrink-0 text-xs font-bold px-2.5 py-1.5 rounded-xl ${
                          daysToNext === 0 ? 'bg-red-100 text-red-700' :
                          daysToNext === 1 ? 'bg-amber-100 text-amber-700' :
                          'bg-amber-50 text-amber-700'
                        }`}>
                          {daysToNext === 0 ? 'Today!' : daysToNext === 1 ? 'Tomorrow' : `In ${daysToNext}d`}
                        </span>
                      </div>
                    )}
                  </Link>
                </div>
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
                            <span className="text-xs font-bold text-gray-700">{event.price === 0 ? 'Free' : formatPrice(event.price, event.currency)}</span>
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
                  <p className="text-gray-600 font-medium">No upcoming events</p>
                  <p className="text-gray-400 text-sm mt-1">Join something to add it to your calendar</p>
                  <Link href="/events" className="mt-4 inline-block btn-primary text-sm">Browse events →</Link>
                </div>
              </div>
            )}

            {/* ── EVENT DISCOVERY ── curated → personalized → popular → full calendar */}

            {/* Featured events — team curated, highest trust */}
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
                  {featuredEvents.map((event) => (
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
                        <p className="text-xs text-gray-600 mt-0.5">{formatDate(event.date)} · 📍 {event.neighborhood}</p>
                      </div>
                      <div className="text-right shrink-0 self-center">
                        <span className="text-sm font-bold text-gray-900">{event.price === 0 ? 'Free' : formatPrice(event.price, event.currency)}</span>
                        {event.limitedSpots && event.spotsLeft > 0 && event.spotsLeft <= 5 && (
                          <p className="text-xs text-red-500 font-medium">{event.spotsLeft} left</p>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* ── COMMUNITY BOARD ── */}
            {recentListings.length > 0 && (
              <div className="bg-white rounded-2xl shadow-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold text-gray-900">📋 Community Board</h2>
                  <Link href="/board" className="text-xs text-amber-600 font-semibold hover:underline">See all →</Link>
                </div>
                <div className="space-y-3">
                  {recentListings.map((l) => {
                    const EMOJI: Record<string, string> = { ROOMS: '🏠', JOBS: '💼', SERVICES: '🛠️', BUY_SELL: '🛍️', FREE: '🎁', LOST_FOUND: '🔍', RECO: '⭐', EXPERIENCES: '🎟️', PETS: '🐾' }
                    return (
                      <Link key={l.id} href={`/board?id=${l.id}`}
                        className="flex items-center gap-3 group">
                        <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center text-lg shrink-0">
                          {EMOJI[l.category] ?? '📋'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 group-hover:text-amber-600 transition-colors truncate">{l.title}</p>
                          <p className="text-xs text-gray-400 truncate">
                            {l.user.name.split(' ')[0]}{l.price ? ` · ${l.price}` : ''}
                          </p>
                        </div>
                      </Link>
                    )
                  })}
                </div>
                <Link href="/board/new"
                  className="mt-4 flex items-center justify-center gap-1.5 w-full py-2 text-xs font-semibold text-amber-600 border border-amber-200 rounded-xl hover:bg-amber-50 transition-colors">
                  + Post a listing
                </Link>
              </div>
            )}

            {/* ── MOVING SALES — separate table from Listing, own small card
                rather than merged into Community Board above (different
                shape: multiple items + leaving date instead of one price). ── */}
            {recentMovingSales.length > 0 && (
              <div className="bg-white rounded-2xl shadow-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold text-gray-900">📦 Moving Sales</h2>
                  <Link href="/board?tab=MOVING" className="text-xs text-amber-600 font-semibold hover:underline">See all →</Link>
                </div>
                <div className="space-y-3">
                  {recentMovingSales.map((s) => (
                    <Link key={s.id} href="/board?tab=MOVING" className="flex items-center gap-3 group">
                      <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center text-lg shrink-0">📦</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-amber-600 transition-colors truncate">
                          {s.user.name.split(' ')[0]} is leaving{s.neighborhood ? ` ${s.neighborhood}` : ''}
                        </p>
                        <p className="text-xs text-gray-400 truncate">
                          {s.items.map(it => it.name).join(', ')}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Recommended — personalized picks */}
            {deduplicatedRecommended.length > 0 && (
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
                  {deduplicatedRecommended.map((event) => (
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
                        <span className="text-sm font-bold text-gray-900">{event.price === 0 ? 'Free' : formatPrice(event.price, event.currency)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Trending — social proof */}
            {trendingEvents.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">Trending now 📈</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Most popular upcoming events</p>
                  </div>
                  <Link href="/events" className="text-sm text-amber-600 font-semibold hover:underline">Browse all →</Link>
                </div>
                <div className="space-y-2">
                  {trendingEvents.map((event) => (
                    <Link key={event.id} href={`/events/${event.id}`}
                      className="group flex gap-3 bg-white rounded-xl shadow-card p-3 hover:-translate-y-0.5 transition-transform duration-200">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center text-xl shrink-0">
                        {event.emoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-gray-900 group-hover:text-amber-600 transition-colors truncate">{event.title}</h3>
                        <p className="text-xs text-gray-400 mt-0.5">{formatDate(event.date)} · 📍 {event.neighborhood}</p>
                      </div>
                      <div className="text-right shrink-0 self-center">
                        <span className="text-xs font-bold text-violet-600 bg-violet-50 px-2 py-1 rounded-lg block">
                          {event.totalSpots - event.spotsLeft} going
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* This week in Istanbul — full calendar browse */}
            {thisWeekEvents.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">This week in Istanbul</h2>
                    <p className="text-xs text-gray-400 mt-0.5">{thisWeekEvents.length} event{thisWeekEvents.length !== 1 ? 's' : ''} coming up</p>
                  </div>
                  <Link href="/events" className="text-sm text-amber-600 font-semibold hover:underline">All →</Link>
                </div>
                <div className="space-y-3">
                  {(() => {
                    const byDay: Record<string, typeof thisWeekEvents> = {}
                    thisWeekEvents.forEach((e) => {
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
                            {evts.slice(0, 3).map((e) => (
                              <Link key={e.id} href={`/events/${e.id}`}
                                className="flex items-center gap-3 bg-white rounded-xl shadow-card p-3 hover:shadow-md transition-all group">
                                <span className="text-lg w-8 text-center shrink-0">{e.emoji}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-gray-900 group-hover:text-amber-600 transition-colors truncate">{e.title}</p>
                                  <p className="text-xs text-gray-400 truncate">📍 {e.neighborhood}</p>
                                </div>
                                <span className="text-xs font-bold text-gray-600 shrink-0">
                                  {e.price === 0 ? 'Free' : formatPrice(e.price, e.currency)}
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

            {deduplicatedRecommended.length === 0 && upcomingEvents.length > 0 && (
              <div className="bg-white rounded-2xl shadow-card p-6 text-center">
                <div className="text-3xl mb-2">🔍</div>
                <p className="text-gray-600 text-sm font-medium">Discover more events</p>
                <Link href="/events" className="mt-3 inline-block btn-primary text-sm">Browse events</Link>
              </div>
            )}

            {/* ── PHASE: CONNECT ── people + clubs cluster, second of the
                two visible phase dividers (Discover above, Connect here). */}
            <div className="flex items-center gap-3 pt-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Connect</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* ── PEOPLE ── */}
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
                  {suggestedMembers.slice(0, 6).map((m) => (
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
                      {m.neighborhood && <p className="text-xs text-gray-400 mt-0.5 truncate">📍 {m.neighborhood}</p>}
                      {m.bio && <p className="text-xs text-gray-400 mt-1 line-clamp-2 leading-tight">{m.bio}</p>}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* ── CLUBS ── my clubs + explore, grouped */}
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
                <div className="flex flex-wrap gap-3 pb-1">
                  {clubs.map((club) => (
                    <Link key={club.id} href={`/clubs/${club.slug}`}
                      className="shrink-0 flex flex-col items-center gap-2 group">
                      <div className={`w-14 h-14 rounded-2xl ${club.bgColor} flex items-center justify-center text-2xl shadow-sm group-hover:scale-110 transition-transform`}>
                        {club.emoji}
                      </div>
                      <p className="text-[11px] font-semibold text-gray-700 group-hover:text-amber-600 transition-colors text-center max-w-[60px] leading-tight truncate">{club.name}</p>
                    </Link>
                  ))}
                  <Link href="/clubs" className="shrink-0 flex flex-col items-center gap-2">
                    <div className="w-14 h-14 rounded-2xl border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-400 hover:border-amber-300 hover:text-amber-500 transition-colors text-xl">+</div>
                    <p className="text-[11px] text-gray-400 text-center">More</p>
                  </Link>
                </div>
              )}
            </div>

            {newClubs.length > 0 && (
              <div className="bg-white rounded-2xl shadow-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-sm font-bold text-gray-900">Clubs to explore 🏛️</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Communities you haven't joined yet</p>
                  </div>
                  <Link href="/clubs" className="text-xs text-amber-600 font-semibold hover:underline">All →</Link>
                </div>
                <div className="space-y-3">
                  {newClubs.map((club) => (
                    <Link key={club.id} href={`/clubs/${club.slug}`}
                      className="flex items-center gap-3 hover:opacity-80 transition-opacity group">
                      <div className={`w-11 h-11 rounded-xl ${club.bgColor} flex items-center justify-center text-xl shrink-0 group-hover:scale-105 transition-transform`}>
                        {club.emoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-amber-600 transition-colors truncate">{club.name}</p>
                        {club.description && <p className="text-xs text-gray-400 mt-0.5 truncate">{club.description}</p>}
                      </div>
                      <span className="text-xs text-gray-400 shrink-0">{club.memberCount} members</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* ── DISCOVER ──
                On mobile this is the ONLY route to these pages. The header's
                Discover dropdown is desktop-only, the bottom bar is full at six
                tabs, and the account sheet is for your own account — so without
                this strip a member on a phone cannot reach Experiences, the
                Guide, the Directory, the Board, Neighborhoods, Stories or
                Hosts at all.
                Placed low on purpose: it's for browsing once you've dealt with
                what you came for, and it uses space the dashboard already has
                rather than competing for a nav slot. Reads from lib/navLinks so
                it can't drift from the desktop menu. */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-3">Discover</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {DISCOVER_LINKS
                  .filter(l => !l.guestOnly)
                  // Same rule as the footer: a city grows into neighbourhoods,
                  // so don't offer the link until it has some.
                  .filter(l => l.href !== '/neighborhoods' || hasNeighborhoods)
                  .map(link => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-gray-50 hover:bg-amber-50 text-sm text-gray-700 hover:text-amber-700 transition-colors"
                  >
                    <span aria-hidden="true" className="text-base shrink-0">{link.emoji}</span>
                    <span className="truncate">{link.label}</span>
                  </Link>
                ))}
                <Link
                  href="/cities"
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-gray-50 hover:bg-amber-50 text-sm text-gray-700 hover:text-amber-700 transition-colors"
                >
                  <span aria-hidden="true" className="text-base shrink-0">🌍</span>
                  <span className="truncate">Cities</span>
                </Link>
              </div>
            </div>

            {/* (QuickLinks / InviteBanner / ReferralImpact used to render
                here behind lg:hidden + again in the right column. They
                now live exclusively in the right column, which renders on
                every viewport via outer order-3 below.) */}
          </div>

          {/* ── RIGHT ──
              Outer container now renders on every viewport (was
              hidden lg:block) so QuickLinks / InviteBanner /
              ReferralImpact can live here ONCE instead of being
              duplicated in the center column behind lg:hidden.
              Mobile order: center → left → right. The dense
              desktop-only widgets stay in the nested hidden lg:block
              below; the action-y cross-viewport widgets live below
              that, visible everywhere. */}
          <div className="order-3 lg:w-60 lg:shrink-0 space-y-4">

            {/* Desktop-only widgets — too dense / sidebar-shaped for
                mobile (mini calendar, weather, narrow listing card). */}
            <div className="hidden lg:block space-y-4">

            {/* Onboarding checklist — top of the right rail so new users see
                the actionable thing before weather / calendar / teasers.
                Same component as the mobile copy at the top of the center
                column. Self-hides when all steps are done, so established
                users see this slot collapse to nothing. */}
            <GetStartedChecklist
              hasProfilePhoto={!!userProfile?.profilePhoto}
              hasBio={!!userProfile?.bio?.trim()}
              hasNeighborhood={!!userProfile?.neighborhood}
              interestCount={userProfile?.interests?.length ?? 0}
              clubCount={myMemberships.length}
              attendedCount={myAttendances.length}
            />

            <CityWeather name={city.name} lat={city.lat} lng={city.lng} timezone={city.timezone} />

            {/* Mini calendar */}
            <div className="bg-white rounded-2xl shadow-card p-5">
              <MiniCalendar eventDates={upcomingDates} />
            </div>

            {/* Featured event widget */}
            {featuredEvents.length > 0 && (() => {
              const e = featuredEvents[0]
              return (
                <Link href={`/events/${e.id}`} className="block bg-white rounded-2xl shadow-card overflow-hidden hover:shadow-md transition-shadow group">
                  {e.coverImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.coverImage} alt={e.title} className="w-full h-32 object-cover" />
                  ) : (
                    <div className="w-full h-20 bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-4xl">
                      {e.emoji}
                    </div>
                  )}
                  <div className="p-4">
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full uppercase tracking-wide">★ Featured</span>
                      {e.limitedSpots && e.spotsLeft > 0 && e.spotsLeft <= 5 && (
                        <span className="text-[10px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">{e.spotsLeft} spots left</span>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-gray-900 group-hover:text-amber-600 transition-colors leading-snug line-clamp-2">{e.title}</h3>
                    <p className="text-xs text-gray-600 mt-1.5">{formatDate(e.date)} · 📍 {e.neighborhood}</p>
                    <p className="text-xs font-semibold text-amber-600 mt-1">{e.price === 0 ? 'Free' : formatPrice(e.price, e.currency)}</p>
                  </div>
                </Link>
              )
            })()}

            {/* Board listing widget — pick one of the 4 freshest listings at
                random per page load instead of pinning the newest one, so
                each gets sidebar airtime. */}
            {recentListings.length > 0 && (() => {
              const l = recentListings[Math.floor(Math.random() * recentListings.length)]
              const EMOJI: Record<string, string> = { ROOMS: '🏠', JOBS: '💼', SERVICES: '🛠️', BUY_SELL: '🛍️', FREE: '🎁', LOST_FOUND: '🔍', RECO: '⭐', EXPERIENCES: '🎟️', PETS: '🐾' }
              return (
                <Link href={`/board?id=${l.id}`} className="block bg-white rounded-2xl shadow-card p-4 hover:shadow-md transition-shadow group">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest">New on Board</h2>
                    <span className="text-lg">{EMOJI[l.category] ?? '📋'}</span>
                  </div>
                  {l.photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.photo} alt={l.title} className="w-full h-28 object-cover rounded-xl mb-3" style={{ objectPosition: `center ${l.photoPosition ?? 50}%` }} />
                  )}
                  <p className="text-sm font-bold text-gray-900 group-hover:text-amber-600 transition-colors leading-snug line-clamp-2">{l.title}</p>
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-xs text-gray-400">{l.user.name.split(' ')[0]}</p>
                    {l.price && <p className="text-xs font-semibold text-amber-600">{l.price}</p>}
                  </div>
                </Link>
              )
            })()}

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

            {/* Members near you */}
            {deduplicatedNearby.length > 0 && (
              <div className="bg-white rounded-2xl shadow-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-bold text-gray-900 uppercase tracking-widest">Near you 📍</h2>
                  <Link href="/members" className="text-xs text-amber-600 font-semibold hover:underline">All →</Link>
                </div>
                <div className="space-y-2.5">
                  {deduplicatedNearby.slice(0, 5).map((m) => {
                    const photo = m.profilePhoto ? avatarUrl(m.profilePhoto, 64) : null
                    const initials = m.name.trim().split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
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
                          {m.bio && <p className="text-xs text-gray-400 truncate">{m.bio}</p>}
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}

            </div>{/* /hidden lg:block (desktop-only widgets) */}

            {/* Cross-viewport widgets — render at all sizes. Single
                source of truth (no center-column duplicates). */}
            <QuickLinks />

            <InviteBanner />

            <div className="hidden lg:block">
              <PartnersBanner />
            </div>

            {referralStats.friends > 0 && (
              <ReferralImpact friendCount={referralStats.friends} eventCount={referralStats.events} />
            )}

            {/* Community pulse — desktop-only stats panel, bottom of rail */}
            <div className="hidden lg:block bg-white rounded-2xl shadow-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                <h2 className="text-xs font-bold text-gray-900 uppercase tracking-widest">Community</h2>
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">Total members</span>
                  <span className="text-sm font-extrabold text-gray-900">{totalMembers.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">Events this week</span>
                  <span className="text-sm font-extrabold text-amber-600">{eventsThisWeek}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">Events this month</span>
                  <span className="text-sm font-extrabold text-gray-900">{communityEventsThisMonth}</span>
                </div>
                {userProfile?.neighborhood && neighborhoodEventCount > 0 && (
                  <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                    <span className="text-xs text-gray-600 truncate pr-2">In {userProfile.neighborhood}</span>
                    <span className="text-sm font-extrabold text-green-600 shrink-0">{neighborhoodEventCount}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
