import Link from 'next/link'
import { formatDay, fromWallClockInTz, todayInTz, shiftDay } from '@/lib/cityTime'
import Image from 'next/image'
import { APP_URL } from '@/lib/env'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { ACTIVATED_MEMBER_WHERE } from '@/lib/memberCount'
import { restrictedSetFor } from '@/lib/memberPrivacy'
import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { DEFAULT_CITY_SLUG } from '@/lib/city'
import { resolveCityForPage, type CitySearch } from '@/lib/cityPageParam'
import { shareCover } from '@/lib/shareCover'
import { resolveImageUrl, firstNameOf, formatPrice } from '@/lib/data'
import { getPublicCities } from '@/lib/cities'
import { getCityHandbookIndex } from '@/lib/handbookIndex'
import { canonicalCategory } from '@/lib/handbook-categories'
import { audiencesFor, matchesAudience } from '@/lib/guide'
import { loadRoutes } from '@/lib/guideContent'
import { formatTime } from '@/lib/data'
import {
  parseTripRange, parseTripFilters, applyTripFilters, tripFilterOptions, tripEventWhen,
  cityAvailability, isFreeEvent, type TripWhen,
} from '@/lib/tripPlan'
import { guestView, visitorName } from '@/lib/visitorPolicy'
import { getNeighborhoodViews } from '@/lib/neighborhoodsDb'
import { loadExperiences } from '@/lib/guideContent'
import VisitingClient from './VisitingClient'
import StickyVisitCta from './StickyVisitCta'

// Cached 2-min — visitor announcements don't churn second-by-second.
// `today` is passed in so day-boundary rollover invalidates the
// cache entry (different cache key per day). Session-independent by
// design (see redaction below) so this stays a single shared cache
// entry per day instead of forking per viewer.
// Cached per (day, viewer-class) rather than per viewer: `forMembers` only
// ever takes two values, so this stays two shared cache entries instead of
// forking per session. Guests get the public-only subset.
interface CachedVisit {
  id: string; userId: string | null; name: string; startsOn: string; endsOn: string; approximate: boolean
  fromCity: string | null; neighborhood: string | null; intro: string; contact: string | null; email: string | null
  travelerType: string | null; languages: string[]; lookingFor: string[]
  user: { id: string; name: string; color: string; profilePhoto: string | null; interests: string[]; profileVisibility: string } | null
}

const VISIT_WHERE = (today: string, cityId: string, forMembers: boolean) => ({
  status: 'active' as const,
  cityId,
  endsOn: { gte: today },
  ...(forMembers ? {} : { visibility: 'public' }),
  // A banned, suspended or admin-hidden author's card goes with them.
  OR: [{ userId: null }, { user: { status: 'approved', hiddenFromMembers: false } }],
})

const getAnnouncements = unstable_cache(
  // cityId is an ARGUMENT, not a closure read: unstable_cache keys on its args,
  // so taking it from the enclosing request would have served one city's
  // visitors to every city for the full 120s window.
  //
  // The guest entry is made safe INSIDE the cache: unstable_cache values
  // stream to the browser in the RSC payload, so a guest's entry must never
  // hold exact dates, a full name, a neighbourhood or an author — it holds
  // what a guest is shown (lib/visitorPolicy guestView) and nothing else.
  async (today: string, forMembers: boolean, cityId: string): Promise<CachedVisit[]> => {
    if (!forMembers) {
      const rows = await prisma.visitorAnnouncement.findMany({
        where:   VISIT_WHERE(today, cityId, false),
        orderBy: { startsOn: 'asc' },
        take:    100,
        select:  { id: true, name: true, startsOn: true, endsOn: true, fromCity: true, intro: true, travelerType: true, languages: true, lookingFor: true },
      })
      return rows.map(r => ({
        id: r.id, userId: null, ...guestView(r), fromCity: r.fromCity, neighborhood: null, intro: r.intro,
        contact: null, email: null, travelerType: r.travelerType, languages: r.languages, lookingFor: r.lookingFor, user: null,
      }))
    }
    const rows = await prisma.visitorAnnouncement.findMany({
      where:   VISIT_WHERE(today, cityId, true),
      orderBy: { startsOn: 'asc' },
      take:    100,
      select: {
        id: true, userId: true, name: true, startsOn: true, endsOn: true, fromCity: true, neighborhood: true, intro: true,
        contact: true, email: true, travelerType: true, languages: true, lookingFor: true,
        user: { select: { id: true, name: true, color: true, profilePhoto: true, interests: true, profileVisibility: true } },
      },
    })
    return rows.map(r => ({ ...r, approximate: false }))
  },
  ['visitor-announcements'],
  { revalidate: 120, tags: ['visitor-announcements'] },
)

// A page that defines its own `openGraph` object does NOT inherit the root
// layout's default og:image — Next.js doesn't deep-merge nested metadata
// fields, so any page with a custom openGraph block silently loses the
// image unless it sets one itself. This page is specifically meant to be
// shared (a friend sending it to someone visiting Istanbul), so a blank
// preview on WhatsApp/iMessage/Twitter — all of which require og:image to
// render a card at all — would kill exactly the traffic this exists for.
//
// The picture follows the shared rule (lib/shareCover): a cover made for the
// city, else its hero photo, else the pre-resized share copy of the hero
// photo the page itself falls back to (visiting-hero-og.jpg).

export async function generateMetadata({ searchParams }: { searchParams?: Promise<CitySearch> }): Promise<Metadata> {
  // Every string here named Istanbul, so Bodrum's guide sent a Bodrum reader to
  // "Visiting Istanbul?" — and a shared link previewed Istanbul whatever the
  // sharer had on screen. ?city= is what lets this URL say which city it means;
  // a crawler has no session cookie.
  const { city } = await resolveCityForPage(searchParams)
  const title = `Visiting ${city.name}? Meet locals — Smileys Community`
  const description = `Tell Smileys members you're coming to ${city.name}. Locals will reach out to grab coffee, share neighborhood tips, and welcome you in.`
  const shareDesc = 'Post your trip dates, see who else is in town, and connect with locals before you arrive.'
  const image = shareCover('visiting', city, `Visiting ${city.name}? — Smileys Community`)
  // Each city's variant is its own canonical, like /guide and /neighborhoods;
  // the default city keeps the bare URL.
  const canonical = city.slug === DEFAULT_CITY_SLUG ? `${APP_URL}/visiting` : `${APP_URL}/visiting?city=${city.slug}`
  return {
    alternates: { canonical },
    title,
    description,
    openGraph: { title, description: shareDesc, url: canonical, images: [image] },
    twitter: { card: image.twitterCard, title, description: shareDesc, images: [image.url] },
  }
}

export default async function VisitingPage({ searchParams }: { searchParams?: Promise<CitySearch & Record<string, string | string[] | undefined>> }) {
  // One resolution for the whole page: every query below was pinned to the
  // default city, so a Bodrum reader got Istanbul's events, members,
  // neighborhoods and hangouts under a header inviting them to Istanbul.
  const { city, cityId, pinned } = await resolveCityForPage(searchParams)
  // Put the city in the URL for anyone not on the default city, so the address
  // bar they copy is a link that survives being shared — the rule every other
  // city-scoped page follows. Guarded on `pinned` so this can't loop; the
  // ?neighborhood= deep link comes along.
  if (!pinned && city.slug !== DEFAULT_CITY_SLUG) {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries((await searchParams) ?? {})) {
      if (key === 'city' || value === undefined) continue
      for (const one of Array.isArray(value) ? value : [value]) qs.append(key, one)
    }
    qs.set('city', city.slug)
    redirect(`/visiting?${qs}`)
  }
  // The city's calendar: UTC kept expired visits and yesterday's events on
  // the page for hours after the city's midnight.
  const today         = todayInTz(city.timezone)
  const sixtyDaysOut  = shiftDay(today, 60)

  // Session resolves first because the announcement query's visibility
  // filter depends on it; the rest still run in parallel.
  const session = await getSession()

  // Moved here from /guide — "First time in Istanbul?" is this page's exact
  // audience, and the same experiences were already reachable there via the
  // mood explorer and collections, so the strip was pure duplication on the
  // reference page.
  // The viewed city's experiences. Unscoped, this put "Historic Istanbul
  // Without Losing Your Mind" on Bodrum's visiting page — an experience in a
  // city the reader isn't going to.
  const allExperiences = await loadExperiences(cityId)
  const firstTimers = allExperiences.filter(e => e.firstTime)

  // §22 of the Guide IA brief — "Perfect for your stay": guide experiences
  // matched to the season of the viewer's own visit dates (not today's).
  // Simple curated filtering, no itinerary engine.
  function seasonalPicks(startsOn: string): string[] {
    const month = Number(startsOn.slice(5, 7))
    if (month >= 6 && month <= 9) return ['princes-islands', 'moda-sunset', 'ferry-at-sunset', 'bebek-rumeli-walk']
    if (month === 12 || month <= 2) return ['turkish-hammam', 'turkish-coffee-slow', 'meyhane-night', 'historic-peninsula-sanely']
    return ['ferry-at-sunset', 'balat-fener-walk', 'kadikoy-market-graze', 'meyhane-night']
  }

  const [announcements, viewerVisit, upcomingEvents, localCandidates, neighborhoodCounts, blockedIds] = await Promise.all([
    getAnnouncements(today, !!session, cityId),
    // The viewer's own visit is queried directly rather than fished out of
    // the cached list above: that cache lags mutations by up to 2 minutes
    // and caps at 100 rows, so a visitor who just posted their dates would
    // still be told to "add your travel dates" right below their own card.
    session
      ? prisma.visitorAnnouncement.findFirst({
          // Scoped to THIS page's city — a visit posted to another city must
          // not drive Istanbul's "events during your stay" sections.
          where:   { userId: session.id, status: 'active', endsOn: { gte: today }, cityId: cityId },
          orderBy: { startsOn: 'asc' },
          select:  { id: true, startsOn: true, endsOn: true, neighborhood: true },
        })
      : null,
    prisma.event.findMany({
      where:   { status: 'published', date: { gte: today, lte: sixtyDaysOut }, cityId: cityId },
      select:  {
        id: true, title: true, emoji: true, date: true, time: true, endTime: true, location: true, neighborhood: true,
        price: true, memberPrice: true, currency: true, isFirstTimerFriendly: true, language: true,
        // Attendee count is filtered to approved RSVPs so the "N going"
        // figure matches what the event page itself shows.
        _count: { select: { attendees: { where: { status: 'approved' } } } },
      },
      orderBy: { date: 'asc' },
      take:    60,
    }),
    // Locals to meet. Members who ticked "🏠 Hosting visitors" in settings come
    // first — they are the only ones who actually said they welcome strangers,
    // and this page never asked the rest. goodHangouts still orders within each
    // group, and remains the whole ordering while nobody has opted in, so the
    // strip never empties on the way to its first host.
    // Public page: admin-hidden accounts stay out, and connections-only
    // profiles are hidden from guests outright and from members unless
    // connected (restrictedSetFor, below) — the /neighborhoods rules.
    prisma.user.findMany({
      where:   {
        status: 'approved', cityId: cityId, hiddenFromMembers: false,
        ...(session ? {} : { profileVisibility: { not: 'connections' } }),
      },
      select:  {
        id: true, name: true, color: true, profilePhoto: true, neighborhood: true,
        openToHosting: true, openToCoffee: true, openToLanguage: true, profileVisibility: true,
      },
      orderBy: [{ openToHosting: 'desc' }, { goodHangouts: 'desc' }],
      take:    8,
    }),
    // Member totals per neighborhood — activated only (lib/memberCount).
    prisma.user.groupBy({
      by:      ['neighborhood'],
      where:   { ...ACTIVATED_MEMBER_WHERE, neighborhood: { not: null }, cityId: cityId },
      _count:  { _all: true },
    }),
    // A blocked pair sees nothing of each other. The list above is a shared
    // cache entry, so the block is applied after it, per viewer.
    session
      ? prisma.memberBlock.findMany({
          where:  { OR: [{ blockerId: session.id }, { blockedId: session.id }] },
          select: { blockerId: true, blockedId: true },
        }).then(rows => new Set(rows.map(b => (b.blockerId === session.id ? b.blockedId : b.blockerId))))
      : new Set<string>(),
  ])

  // This page is public (anonymous visitors are the point — it's a growth
  // surface like /guide and /handbook). Strip contact info for anyone
  // without a session, matching the exact same redaction already done in
  // GET /api/visitors — a signed-out request must never see a member's raw
  // contact/email, only that they exist and how to reach them (sign up).
  const isMember = !!session
  // Authors whose profile is connections-only and who aren't connected to
  // the viewer keep their profile (photo, link, interests) off the card —
  // the /api/members rule, which the card used to skip.
  const restrictedAuthors = session
    ? await restrictedSetFor(session, announcements.flatMap(a => a.user ? [a.user] : []))
    : new Set<string>()
  // The guest entry is already a guest's view (see getAnnouncements); a
  // member's card is the card as posted, minus a restricted author.
  const serialised = announcements
    .filter(a => !a.userId || !blockedIds.has(a.userId))
    .map(a => {
      const author = a.user && !restrictedAuthors.has(a.user.id) ? a.user : null
      return {
        id:           a.id,
        // The stored name is free text and was prefilled with the poster's
        // full account name, so hiding the author left the surname on the
        // card anyway. Cards written before that prefill was fixed still
        // carry it, hence cutting it here rather than only at the form.
        name:         visitorName(a.name),
        startsOn:     a.startsOn,
        endsOn:       a.endsOn,
        approximate:  a.approximate,
        fromCity:     a.fromCity,
        neighborhood: a.neighborhood,
        intro:        a.intro,
        contact:      a.contact,
        email:        a.email,
        interests:    author?.interests ?? [],
        travelerType: a.travelerType,
        languages:    a.languages,
        lookingFor:   a.lookingFor,
        user:         author ? { id: author.id, name: author.name, color: author.color, profilePhoto: author.profilePhoto } : null,
      }
    })
  // Past the cap the latest-starting visits fall off silently; say so.
  const totalCount = announcements.length >= 100
    ? await prisma.visitorAnnouncement.count({ where: VISIT_WHERE(today, cityId, isMember) })
    : serialised.length
  const viewerIsLocal = !!session && session.cityId === cityId
  // Where the CTAs go: a member with a visit edits it; a member on another
  // city's page posts to THAT city (the form used to default to Istanbul).
  const newVisitHref = viewerVisit ? `/visiting/new?edit=${viewerVisit.id}` : pinned ? `/visiting/new?city=${city.slug}` : '/visiting/new'
  const ctaLabel     = viewerVisit ? 'Edit your visit' : "Tell Us You're Coming"

  // The "open to…" flags live on the members-only directory. Hiding them in
  // the render is not enough — props reach the browser in the RSC payload, so
  // a guest would receive them in the page source while seeing nothing. Strip
  // them here instead; guests get exactly the four fields they always got.
  const restrictedLocals = session ? await restrictedSetFor(session, localCandidates) : new Set<string>()
  const featuredLocals   = localCandidates.filter(m => !restrictedLocals.has(m.id)).slice(0, 5)
  const localsForViewer = session
    ? featuredLocals.map(({ profileVisibility: _pv, ...rest }) => rest)
    : featuredLocals.map(({ id, name, color, profilePhoto, neighborhood }) =>
        ({ id, name, color, profilePhoto, neighborhood }))

  const cityCount = new Set(serialised.map(a => a.fromCity?.trim().toLowerCase()).filter(Boolean)).size

  // ── The trip planner ────────────────────────────────────────────────
  // The dates come from the URL (?from=&to= — anyone can plan, no account
  // needed), else from the member's own posted visit, else there are none
  // and the section shows what's coming up. Queried on the range itself: a
  // fixed 60-day window told a December visitor "nothing scheduled" while
  // December's events existed. lib/tripPlan owns the rules — past ranges are
  // refused, a range starting in the past is clamped to today, and events
  // that have already finished are dropped rather than shown as upcoming.
  const sp        = (await searchParams) ?? {}
  const one       = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null
  const trip      = parseTripRange({ from: one(sp.from), to: one(sp.to) }, today)
  const filters   = parseTripFilters({ hood: one(sp.hood), free: one(sp.free), first: one(sp.first), lang: one(sp.lang) })
  const planRange = trip.range
    ?? (!trip.error && viewerVisit ? { from: viewerVisit.startsOn < today ? today : viewerVisit.startsOn, to: viewerVisit.endsOn } : null)
  const planFromVisit = !trip.range && !!planRange
  const rangeRows = planRange
    ? await prisma.event.findMany({
        where:   { status: 'published', cityId, date: { gte: planRange.from, lte: planRange.to } },
        select:  {
          id: true, title: true, emoji: true, date: true, time: true, endTime: true, location: true, neighborhood: true,
          price: true, memberPrice: true, currency: true, isFirstTimerFriendly: true, language: true,
          _count: { select: { attendees: { where: { status: 'approved' } } } },
        },
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
        take:    200,
      })
    : upcomingEvents
  const nowInstant = new Date()
  const timedEvents = rangeRows.flatMap(e => {
    const when = tripEventWhen(e, city.timezone, today, nowInstant)
    return when ? [{ ...e, when }] : []
  })
  const filterOptions  = planRange ? tripFilterOptions(timedEvents) : null
  const filteredEvents = planRange ? applyTripFilters(timedEvents, filters) : timedEvents
  const filtersActive  = !!(filters.hood || filters.free || filters.first || filters.lang)
  const PLAN_SHOWN     = 12

  // The cards' "N events while you're here" chip counts against every
  // listed visit's window, not the next 60 days.
  const lastEndsOn     = serialised.reduce((m, a) => (a.endsOn > m ? a.endsOn : m), sixtyDaysOut)
  const eventsForCards = await prisma.event.findMany({
    where:   { status: 'published', cityId, date: { gte: today, lte: lastEndsOn } },
    select:  { id: true, title: true, emoji: true, date: true },
    orderBy: { date: 'asc' },
    take:    200,
  })

  // §20 of the hangouts plan — spontaneous plans surfaced to visitors.
  // Members only (hangouts are member content); date-matched to the
  // viewer's own visit when they've posted one, otherwise just what's
  // active or imminent. Server-side, so no client fetch/401 dance.
  const hangoutsDuringVisit = session ? await prisma.hangout.findMany({
    where: {
      status: 'active',
      cityId,
      endsAt: { gte: new Date() },
      // A blocked host's plan, or a banned one's, is not "while you're here".
      ...(blockedIds.size ? { userId: { notIn: [...blockedIds] } } : {}),
      user: { status: 'approved', hiddenFromMembers: false },
      // Inside the visit, both ends: tonight's hangout is not "while you're
      // here" for someone arriving next month.
      ...(viewerVisit ? { startsAt: {
        gte: fromWallClockInTz(viewerVisit.startsOn + 'T00:00', city.timezone),
        lte: new Date(fromWallClockInTz(viewerVisit.endsOn + 'T23:59', city.timezone).getTime() + 59_999),
      } } : {}),
    },
    select: {
      id: true, title: true, activity: true, neighborhood: true, startsAt: true, maxPeople: true,
      user: { select: { name: true } },
      _count: { select: { joins: true } },
    },
    orderBy: { startsAt: 'asc' },
    // Overfetch then sort so hangouts in the visitor's own stay-
    // neighborhood lead the row — those are the ones they can actually
    // walk to. Stable within groups: soonest first.
    take: 8,
  }).then(rows => {
    if (!viewerVisit?.neighborhood) return rows.slice(0, 4)
    return [...rows]
      .sort((a, b) => Number(b.neighborhood === viewerVisit.neighborhood) - Number(a.neighborhood === viewerVisit.neighborhood))
      .slice(0, 4)
  }) : []

  // §32 of the Clubs brief — the viewer's clubs' events during their
  // visit. Members with dates only; silent when empty.
  const clubEventsDuringVisit = (session && viewerVisit) ? await prisma.event.findMany({
    where: {
      status: 'published',
      cityId,   // the viewed city's — an Istanbul club's events are not "while you're here" in Izmir
      date:   { gte: viewerVisit.startsOn, lte: viewerVisit.endsOn },
      club:   { memberships: { some: { userId: session.id, status: 'approved' } } },
    },
    orderBy: { date: 'asc' },
    take: 3,
    select: {
      id: true, title: true, emoji: true, date: true,
      club: { select: { name: true, emoji: true, slug: true } },
    },
  }) : []

  // Their neighborhood leads when known, then the busiest ones fill the row.
  const memberCountFor = (n: string) =>
    neighborhoodCounts.find(c => c.neighborhood === n)?._count._all ?? 0

  // From the VIEWED city's registry, not Istanbul's constant: this section
  // offered Kadıköy and Moda to someone planning a trip to Bodrum, linked to
  // slugs that resolve in another city.
  const visitRegistry = await getNeighborhoodViews(cityId)
  const neighborhoodPicks = [
    ...(viewerVisit?.neighborhood ? visitRegistry.filter(n => n.name === viewerVisit.neighborhood) : []),
    ...visitRegistry
      .filter(n => n.name !== viewerVisit?.neighborhood)
      .sort((a, b) => memberCountFor(b.name) - memberCountFor(a.name)),
  ].slice(0, 4).map(row => ({
    name:    row.name,
    slug:    row.slug,
    meta:    { emoji: row.emoji, vibe: row.vibe },
    members: memberCountFor(row.name),
  }))

  // Links into other city-scoped pages carry the city: /neighborhoods and
  // /handbook otherwise resolve from the session, and four neighborhood
  // slugs exist in two cities.
  const cityQs = `?city=${city.slug}`

  // One card for both event lists below. The newcomer facts are the ones a
  // first-timer decides on — cost, whether it is picked as an easy first one,
  // the language — and each shows only when the event has it set.
  const VisitEventCard = ({ e }: { e: (typeof timedEvents)[number] }) => (
    <Link href={`/events/${e.id}`}
      className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-amber-200 transition-all group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500">
      {/* When, relative to now in the city's own time — "Happening now",
          "Today", "Tomorrow" or the date — plus the start time. Finished
          events never reach this card (lib/tripPlan). */}
      <p className="text-xs font-bold tracking-wide">
        <span className={whenTone(e.when)}>{e.when.label.toUpperCase()}</span>
        {e.time && <span className="text-gray-500"> · {formatTime(e.time)}</span>}
      </p>
      <h3 className="font-bold text-gray-900 mt-1.5 leading-snug">
        <span aria-hidden="true">{e.emoji} </span>{e.title}
      </h3>
      <p className="text-xs text-gray-500 mt-2">
        <span aria-hidden="true">📍 </span>{e.neighborhood || e.location}
      </p>
      <p className="text-xs text-gray-500 mt-0.5">
        <span aria-hidden="true">👥 </span>{e._count.attendees} going
        <span aria-hidden="true"> · </span>
        {isFreeEvent(e) ? <span className="font-semibold text-green-700">Free</span> : formatPrice(e.price, e.currency)}
        {e.language?.trim() && <><span aria-hidden="true"> · </span><span className="sr-only">Language: </span>{e.language.trim()}</>}
      </p>
      {e.isFirstTimerFriendly && (
        <p className="inline-block mt-2 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
          <span aria-hidden="true">👋 </span>First-timer friendly
        </p>
      )}
      <span className="block text-xs font-bold text-gray-700 mt-3 group-hover:text-amber-600 transition-colors">
        View event →
      </span>
    </Link>
  )
  const whenTone = (w: TripWhen) =>
    w.kind === 'now' ? 'text-emerald-700' : w.kind === 'later' ? 'text-amber-700' : 'text-amber-800'

  // ── Arrival essentials, interests, availability ─────────────────────
  // All existing content: the city's Handbook (lib/handbookIndex), its Guide
  // audiences and day routes (lib/guide, lib/guideContent), and the city list
  // with the same maturity signal the city cards use (lib/tripPlan).
  const [handbook, routes, publicCities] = await Promise.all([
    getCityHandbookIndex(cityId, city.country ?? null),
    loadRoutes(cityId),
    getPublicCities(),
  ])
  // The city's own article first (its transport card beats a national note).
  const essential = (category: string) => handbook
    .filter(a => canonicalCategory(a.category) === category)
    .sort((a, b) => Number(b.cityId === cityId) - Number(a.cityId === cityId))[0] ?? null
  const essentials = [
    { key: 'connect',   label: 'SIM and internet',       article: essential('Mobile & Digital') },
    { key: 'transport', label: 'Getting around',         article: essential('Getting Around') },
    { key: 'money',     label: 'Money',                  article: essential('Money & Banking') },
    { key: 'safety',    label: 'Safety and emergencies', article: essential('Safety & Emergencies') },
  ].filter(x => x.article)
  const firstTimerSoon = timedEvents.filter(e => e.isFirstTimerFriendly)
  // Guide intents this city's vocabulary can answer, with how many
  // experiences each one opens — an intent with none is not offered.
  const guideQs = pinned ? `&city=${city.slug}` : ''
  const intents = audiencesFor(city.slug)
    .map(a => ({ ...a, count: allExperiences.filter(e => matchesAudience(e, a)).length }))
    .filter(a => a.count > 0)
  const availability = {
    active:      publicCities.filter(c => cityAvailability(c) === 'active'),
    founding:    publicCities.filter(c => cityAvailability(c) === 'founding'),
    coming_soon: publicCities.filter(c => cityAvailability(c) === 'coming_soon'),
  }
  const thisCityAvailability = publicCities.find(c => c.slug === city.slug)
  const hereAvailability = thisCityAvailability ? cityAvailability(thisCityAvailability) : 'coming_soon'


  return (
    <div className={`min-h-screen bg-white ${viewerVisit ? '' : 'pb-24 md:pb-0'}`}>
      {/* Hero — full-bleed cinematic photo with the copy overlaid. The
          gradient is what makes white text legible over a bright sunset
          photo: without it the headline sits on the blown-out sky at the
          horizon and drops well below AA. Kept opaque enough at the
          bottom that the CTAs never land on the busy boat/crowd detail. */}
      {/* min-height, not a fixed height: the headline wraps to four lines on
          a phone, and a fixed box clipped the eyebrow off the top. */}
      <section className="relative min-h-[500px] sm:min-h-[560px] lg:min-h-[620px] w-full overflow-hidden flex items-center">
        {/* The city's own photo where it has one — this shot is Istanbul, down
            to the signpost in it, and its alt text said so to screen readers on
            every city's page. */}
        <Image
          src={city.heroImage ? resolveImageUrl(city.heroImage) : '/app/images/visiting-hero.jpg'}
          alt={city.heroImage
            ? `Smileys members in ${city.name}`
            : 'Four Smileys members at an Istanbul viewpoint at sunset, one pointing across the Bosphorus toward a domed mosque, beside a signpost pointing to Galata Tower, Sultanahmet, and Hagia Sophia'}
          fill
          priority
          fetchPriority="high"
          sizes="100vw"
          className="object-cover object-center"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/30" />
        <div className="relative w-full py-16 sm:py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
            <div className="max-w-2xl">
              <p className="text-xs font-bold tracking-[0.2em] uppercase text-amber-300 mb-4">
                Visiting {city.name}
              </p>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.1]">
                Don&apos;t just visit {city.name}. Know someone here.
              </h1>
              <p className="text-base sm:text-lg text-white/90 mt-5 leading-relaxed max-w-xl">
                Smileys brings together local recommendations, real events and a community of people
                who live here — so you can find the parts of {city.name} you&apos;ll love, see what&apos;s
                on during your stay, and meet a few people before you land.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                {/* Posting is member-only (anonymous posting was tried and
                    reverted — see app/(member)/visiting/new/page.tsx), so a
                    logged-out visitor is sent to /apply rather than into a
                    form that would just bounce them to login. */}
                <a href="#plan"
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-amber-500 hover:bg-amber-600 text-white text-base font-bold rounded-xl transition-colors shadow-lg">
                  Plan my visit
                  <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </a>
                <a href="#tell"
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 border border-white/50 hover:bg-white/10 text-white text-base font-semibold rounded-xl transition-colors backdrop-blur-sm">
                  {viewerVisit ? 'Your visit card' : 'Tell us you’re coming'}
                </a>
              </div>
              <p className="text-xs sm:text-sm text-white/70 mt-5">
                Real people <span aria-hidden="true">•</span> Local connections <span aria-hidden="true">•</span> No awkward cold introductions
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Value strip — four short promises. Deliberately terse: this sits
          between the hero and the visitor list, so anything longer pushes
          the actual people (the point of the page) further down. */}
      <section className="border-b border-gray-100 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: '☕', title: 'Meet a Local',      body: `Grab a coffee, drink or meal with someone already living in ${city.name}.` },
              { icon: '💬', title: 'Get Local Tips',    body: 'Ask real people about neighborhoods, transport, restaurants and everyday life.' },
              { icon: '🤝', title: 'Make Connections',  body: 'Start meeting people before your flight even lands.' },
              { icon: '🎉', title: 'Find Plans',        body: "Discover Smileys events and activities happening while you're here." },
            ].map(v => (
              <div key={v.title} className="bg-gray-50 border border-gray-100 rounded-2xl p-5">
                <div aria-hidden="true" className="text-2xl mb-3">{v.icon}</div>
                <h2 className="text-sm font-bold text-gray-900 mb-1.5">{v.title}</h2>
                <p className="text-xs text-gray-600 leading-relaxed">{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Plan your visit ── the page's primary interaction. A plain GET
          form: works without JavaScript, every control is a native labelled
          input, and the result is a shareable URL. Filters appear only when
          they would narrow the list (lib/tripPlan tripFilterOptions). */}
      <section id="plan" aria-labelledby="plan-title" className="bg-white border-b border-gray-100 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-14">
          <h2 id="plan-title" className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">Plan your visit</h2>
          <ol className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-600">
            {[
              { n: 1, label: 'Your dates',           href: '#plan' },
              { n: 2, label: 'Events during your stay', href: '#plan-events' },
              { n: 3, label: 'Experiences you’ll like', href: '#interests' },
              { n: 4, label: 'Where you’re staying', href: '#stay' },
              { n: 5, label: 'Tell the community',   href: '#tell' },
            ].map(st => (
              <li key={st.n}>
                <a href={st.href} className="inline-flex items-center gap-2 hover:text-amber-700">
                  <span aria-hidden="true" className="w-6 h-6 rounded-full bg-amber-100 text-amber-800 text-xs font-extrabold flex items-center justify-center">{st.n}</span>
                  {st.label}
                </a>
              </li>
            ))}
          </ol>

          <form method="get" action="/app/visiting#plan-events" className="mt-8 rounded-2xl border border-gray-200 bg-gray-50 p-4 sm:p-6">
            {pinned && <input type="hidden" name="city" value={city.slug} />}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-4 items-end">
              <div>
                <label htmlFor="trip-from" className="block text-sm font-semibold text-gray-800 mb-1.5">Arriving</label>
                <input id="trip-from" name="from" type="date" min={today} required
                  defaultValue={trip.range?.from ?? (planFromVisit ? planRange?.from : '') ?? ''} className="input bg-white" />
              </div>
              <div>
                <label htmlFor="trip-to" className="block text-sm font-semibold text-gray-800 mb-1.5">Leaving</label>
                <input id="trip-to" name="to" type="date" min={today} required
                  defaultValue={trip.range?.to ?? (planFromVisit ? planRange?.to : '') ?? ''} className="input bg-white" />
              </div>
              <button type="submit" className="btn-primary px-6 py-3">Show my events</button>
            </div>

            {filterOptions && (filterOptions.hoods.length > 0 || filterOptions.free || filterOptions.first || filterOptions.langs.length > 0) && (
              <fieldset className="mt-5 pt-5 border-t border-gray-200">
                <legend className="text-sm font-semibold text-gray-800 mb-3">Narrow it down</legend>
                <div className="flex flex-wrap items-end gap-4">
                  {filterOptions.hoods.length > 0 && (
                    <div>
                      <label htmlFor="trip-hood" className="block text-xs font-semibold text-gray-600 mb-1">Neighbourhood</label>
                      <select id="trip-hood" name="hood" defaultValue={filters.hood ?? ''} className="input bg-white py-2">
                        <option value="">Anywhere</option>
                        {filterOptions.hoods.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  )}
                  {filterOptions.langs.length > 0 && (
                    <div>
                      <label htmlFor="trip-lang" className="block text-xs font-semibold text-gray-600 mb-1">Language</label>
                      <select id="trip-lang" name="lang" defaultValue={filters.lang ?? ''} className="input bg-white py-2">
                        <option value="">Any</option>
                        {filterOptions.langs.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </div>
                  )}
                  {filterOptions.free && (
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700 py-2">
                      <input type="checkbox" name="free" value="1" defaultChecked={filters.free} className="accent-amber-500 w-4 h-4" />
                      Free only
                    </label>
                  )}
                  {filterOptions.first && (
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700 py-2">
                      <input type="checkbox" name="first" value="1" defaultChecked={filters.first} className="accent-amber-500 w-4 h-4" />
                      First-timer friendly
                    </label>
                  )}
                </div>
                {filterOptions.langs.length > 0 && (
                  <p className="text-xs text-gray-500 mt-2">Language only matches events whose host listed one.</p>
                )}
              </fieldset>
            )}
          </form>

          <div id="plan-events" className="scroll-mt-24 mt-8" aria-live="polite">
            {trip.error ? (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{trip.error}</p>
            ) : planRange ? (
              <>
                <h3 className="text-xl font-extrabold text-gray-900">
                  {filteredEvents.length === 0
                    ? `Nothing ${filtersActive ? 'matching' : 'scheduled'} between ${formatDay(planRange.from)} and ${formatDay(planRange.to)} yet`
                    : `${filteredEvents.length} event${filteredEvents.length === 1 ? '' : 's'} between ${formatDay(planRange.from)} and ${formatDay(planRange.to)}`}
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  {planFromVisit ? 'Matched to the dates on your visit card. ' : ''}
                  {trip.clamped ? 'Your stay has already started, so this shows today onwards. ' : ''}
                  {filteredEvents.length === 0
                    ? (filtersActive
                        ? <>Try fewer filters — <Link href={`/visiting?${new URLSearchParams({ ...(pinned ? { city: city.slug } : {}), from: planRange.from, to: planRange.to })}#plan-events`} className="font-semibold text-amber-700 hover:underline">clear them</Link>.</>
                        : 'New events are added every week, so check back closer to your trip.')
                    : 'Events that have already finished are not shown.'}
                </p>
                {filteredEvents.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
                    {filteredEvents.slice(0, PLAN_SHOWN).map(e => <VisitEventCard key={e.id} e={e} />)}
                  </div>
                )}
                {filteredEvents.length > PLAN_SHOWN && (
                  <Link href={pinned ? `/${city.slug}/events` : '/events'} className="inline-block mt-6 text-sm font-bold text-amber-700 hover:underline">
                    {filteredEvents.length - PLAN_SHOWN} more — open the full calendar →
                  </Link>
                )}
              </>
            ) : timedEvents.length > 0 ? (
              <>
                <h3 className="text-xl font-extrabold text-gray-900">Coming up in {city.name}</h3>
                <p className="text-sm text-gray-600 mt-1">Add your dates above to see only what falls during your stay.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
                  {timedEvents.slice(0, 6).map(e => <VisitEventCard key={e.id} e={e} />)}
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-600">Nothing on the {city.name} calendar in the next two months yet — add your dates and check back closer to your trip.</p>
            )}
          </div>
        </div>
      </section>

      {/* ── Your first 48 hours ── built only from what the city has: its
          Handbook articles for connectivity and transport, its Guide's
          first-timer experiences, and first-timer-friendly events actually
          on the calendar. A step with nothing behind it says so rather than
          linking somewhere empty. The event notes are policy that holds in
          every city (the badge, host and price shown before RSVP, the FAQ's
          cancellation rule), not promises about any one event. */}
      <section id="first-48" aria-labelledby="first-48-title" className="bg-white border-b border-gray-100 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <h2 id="first-48-title" className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">Your first 48 hours</h2>
          <p className="text-gray-600 mt-1">Four things to do once you land — each linked to the page that covers it.</p>
          <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            {[
              {
                title: 'Arrive and get connected',
                body:  'A local SIM or eSIM, so maps, messages and ride apps work from the start.',
                href:  essentials.find(x => x.key === 'connect')?.article ? `/handbook/${essentials.find(x => x.key === 'connect')!.article!.slug}` : null,
                cta:   'SIM and internet guide',
              },
              {
                title: 'Learn the transport basics',
                body:  'How to pay for buses, metro and ferries, and what to buy on day one.',
                href:  essentials.find(x => x.key === 'transport')?.article ? `/handbook/${essentials.find(x => x.key === 'transport')!.article!.slug}` : null,
                cta:   'Transport guide',
              },
              {
                title: 'Pick a first local experience',
                body:  firstTimers.length > 0
                  ? `Start with one of the ${city.name} Guide’s first-timer picks: ${firstTimers.slice(0, 2).map(e => e.title).join(' or ')}.`
                  : `Browse the ${city.name} Guide for somewhere to start.`,
                href:  firstTimers.length > 0 ? `/guide?for=first-time${guideQs}` : `/guide${cityQs}`,
                cta:   'First-time picks',
              },
              {
                title: 'Join a friendly event or coffee',
                body:  firstTimerSoon.length > 0
                  ? `${firstTimerSoon.length} first-timer-friendly event${firstTimerSoon.length === 1 ? '' : 's'} ${planRange ? 'during your stay' : 'coming up'} — easy ones to come to on your own.`
                  : 'Pick any event that suits you, or say hello to a local who is open to meeting visitors.',
                href:  firstTimerSoon.length > 0 && planRange
                  ? `/visiting?${new URLSearchParams({ ...(pinned ? { city: city.slug } : {}), from: planRange.from, to: planRange.to, first: '1' })}#plan-events`
                  : '#plan-events',
                cta:   'See events',
              },
            ].map((st, i) => (
              <li key={st.title} className="bg-gray-50 border border-gray-100 rounded-2xl p-5 flex flex-col">
                <span aria-hidden="true" className="w-8 h-8 rounded-full bg-amber-500 text-white text-sm font-extrabold flex items-center justify-center mb-3">{i + 1}</span>
                <h3 className="font-bold text-gray-900 mb-1.5">{st.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed flex-1">{st.body}</p>
                {st.href
                  ? <Link href={st.href} className="mt-4 text-sm font-bold text-amber-700 hover:text-amber-800">{st.cta} <span aria-hidden="true">→</span></Link>
                  : <p className="mt-4 text-xs text-gray-500">No {city.name} guide for this yet.</p>}
              </li>
            ))}
          </ol>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
            {essentials.length > 0 && (
              <div className="rounded-2xl border border-gray-200 p-5">
                <h3 className="font-bold text-gray-900 mb-2">Handbook essentials</h3>
                <ul className="space-y-1.5 text-sm">
                  {essentials.map(x => (
                    <li key={x.key}>
                      <span className="text-gray-500">{x.label}: </span>
                      <Link href={`/handbook/${x.article!.slug}`} className="font-semibold text-gray-900 hover:text-amber-700">{x.article!.title}</Link>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-gray-500 mt-3 leading-relaxed">
                  Written by members from experience, not legal, visa, medical or transport-operator advice. Fares,
                  rules and requirements change — where a guide links official sources, check them before you rely on it.
                </p>
              </div>
            )}
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
              <h3 className="font-bold text-gray-900 mb-2">What a first Smileys event is like</h3>
              <ul className="space-y-2 text-sm text-gray-600 leading-relaxed">
                <li className="flex gap-2"><span aria-hidden="true">👋</span><span>Events marked <span className="font-semibold text-gray-900">First-timer friendly</span> are picked by the team as easy ones to come to on your own.</span></li>
                <li className="flex gap-2"><span aria-hidden="true">👤</span><span>Every event names its host and shows how many people are going before you RSVP.</span></li>
                <li className="flex gap-2"><span aria-hidden="true">💰</span><span>Many are free; when there is a price, it is shown up front.</span></li>
                <li className="flex gap-2"><span aria-hidden="true">📅</span><span>Plans change? Cancel as early as you can, so someone on the waitlist gets your spot.</span></li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* First-timer strip — moved from /guide (see the comment above the
          firstTimers query): the curated essentials, not 100 attractions. */}
      {firstTimers.length > 0 && (
        <section className="bg-amber-50 border-b border-amber-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
            <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-gray-900">Worth seeing first in {city.name}</h2>
            <p className="text-gray-600 mt-1 mb-5">Start with these — everything else can wait.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {firstTimers.map(e => (
                <Link key={e.slug} href={`/guide/${e.slug}`}
                  className="bg-white border border-amber-100 rounded-2xl p-4 hover:border-amber-300 hover:shadow-md transition-all group">
                  <span aria-hidden="true" className="block text-3xl mb-2">{e.emoji}</span>
                  <p className="text-sm font-bold text-gray-900 leading-snug group-hover:text-amber-700 transition-colors">{e.title}</p>
                  <span className="inline-block text-xs font-bold text-amber-600 mt-2">Read guide →</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Find experiences by interest ── the Guide's own audience paths
          (lib/guide audiencesFor — only those this city's vocabulary can
          answer, and only with at least one experience) plus its day routes,
          which string existing experiences into a day. No new content. */}
      {(intents.length > 0 || routes.length > 0) && (
        <section id="interests" aria-labelledby="interests-title" className="bg-white border-b border-gray-100 scroll-mt-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <h2 id="interests-title" className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">What kind of trip is it?</h2>
            <p className="text-gray-600 mt-1">Experiences from the {city.name} Guide, by what you&apos;re in the mood for.</p>
            {intents.length > 0 && (
              <ul className="flex flex-wrap gap-2 mt-5">
                {intents.map(a => (
                  <li key={a.value}>
                    <Link href={`/guide?for=${a.value}${guideQs}`}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:border-amber-300 hover:text-amber-700 transition-colors">
                      <span aria-hidden="true">{a.emoji}</span>{a.label}
                      <span className="text-xs font-normal text-gray-500">{a.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {routes.length > 0 && (
              <div className="mt-8">
                <h3 className="text-sm font-extrabold text-gray-600 uppercase tracking-widest mb-3">
                  {routes.length > 1 ? 'A day at a time — or two for a weekend' : 'A day plan'}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {routes.map(r => (
                    <Link key={r.slug} href={`/guide/routes/${r.slug}`}
                      className="bg-gray-50 border border-gray-100 rounded-2xl p-4 hover:border-amber-200 hover:shadow-md transition-all group">
                      <span aria-hidden="true" className="block text-2xl mb-1">{r.emoji}</span>
                      <p className="text-sm font-bold text-gray-900 group-hover:text-amber-700 transition-colors leading-snug">{r.title}</p>
                      {r.time && <p className="text-xs text-gray-500 mt-1">{r.time}</p>}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Full container width (not max-w-3xl) so the visitor cards can
            lay out 3-up on desktop; the handbook cross-link below keeps
            its own reading width so it doesn't stretch into a banner. */}
        <div id="visitors" className="scroll-mt-20">

        <VisitingClient announcements={serialised} events={eventsForCards} today={today} viewerIsLocal={viewerIsLocal} totalCount={totalCount} newVisitHref={isMember ? newVisitHref : '/apply'} cityCount={cityCount} featuredLocals={localsForViewer} cityName={city.name} />

        {/* Cross-link to /handbook — visitors landing here are the exact
            audience for the long-form survival reads. Closes the loop
            with /handbook (and /guide) which both link back here as
            "Visiting first?". Soft grey card so it doesn't compete
            with the post-CTA. */}
        <Link href={`/handbook${cityQs}`}
          className="block mt-8 max-w-3xl bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-2xl px-5 py-4 transition-colors group">
          <div className="flex items-center gap-4">
            <div aria-hidden="true" className="text-2xl shrink-0">📖</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900">Arriving soon? Read the Handbook.</p>
              <p className="text-xs text-gray-600 mt-0.5">Residence permits, banking, transport — written by members who lived it.</p>
            </div>
            <span className="text-sm font-bold text-gray-700 shrink-0 group-hover:translate-x-0.5 transition-transform">→</span>
          </div>
        </Link>
        </div>
      </div>

      {/* ── Know where you're staying? ── */}
      <section id="stay" className="bg-gray-50 border-t border-gray-100 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">
            Know where you&apos;re staying?
          </h2>
          <p className="text-gray-600 mt-2 mb-8">Discover your neighborhood before you arrive.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {neighborhoodPicks.map(n => (
              <Link key={n.name} href={`/neighborhoods/${n.slug}${cityQs}`}
                className="bg-white border border-gray-100 rounded-2xl p-5 hover:border-amber-200 hover:shadow-md transition-all group">
                <div aria-hidden="true" className="text-2xl mb-2">{n.meta?.emoji ?? '📍'}</div>
                <h3 className="font-bold text-gray-900">{n.name}</h3>
                {n.members > 0 && (
                  <p className="text-xs font-semibold text-amber-700 mt-0.5">{n.members} Smileys nearby</p>
                )}
                <p className="text-xs text-gray-500 mt-2 leading-relaxed">{n.meta?.vibe ?? 'Local recommendations · People nearby'}</p>
                <span className="inline-block text-xs font-bold text-gray-700 mt-3 group-hover:text-amber-600 transition-colors">
                  Explore {n.name} →
                </span>
              </Link>
            ))}
          </div>
          <Link href={`/neighborhoods${cityQs}`} className="inline-block mt-8 text-sm font-bold text-amber-600 hover:underline">
            Explore all {city.name} neighborhoods →
          </Link>
        </div>
      </section>

      {/* ── Tell the community you're coming ── how it actually works, said
          before anyone posts. Every line is a rule the product enforces:
          posting needs an approved account (visiting/new is members-only),
          visits default to members-only and a public card shows guests a
          first name and the month (lib/visitorPolicy), contact happens by a
          connection request the visitor accepts or declines (VisitingClient),
          and Report/Block sit on every profile and message thread. It
          promises no introductions — some visitors hear from nobody. */}
      <section id="tell" aria-labelledby="tell-title" className="bg-white border-t border-gray-100 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <h2 id="tell-title" className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">Tell the community you&apos;re coming</h2>
          <p className="text-gray-600 mt-2 max-w-2xl">Post your dates and a short intro, and members in {city.name} can see you&apos;re on your way. Here&apos;s exactly how it works.</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
            {[
              { icon: '🪪', term: 'You need a Smileys account', desc: 'Posting your dates, messaging members and joining events are for approved members. Applying is free and every application is reviewed by a person.' },
              { icon: '👀', term: 'Who sees your visit', desc: 'Only signed-in members, unless you choose to list it publicly. Even then, people who aren’t signed in see only your first name and the month — never your exact dates, neighbourhood or contact details.' },
              { icon: '🤝', term: 'What to expect', desc: 'A member who’d like to meet sends you a connection request with a note — a coffee, a tip, an event they’re going to — and can only message you once you accept. (Smileys staff and club hosts can message members directly.) Some visitors hear from several people and some from nobody; it depends on your dates and who’s around, so events are the surest way to meet people.' },
              { icon: '🛡️', term: 'Staying safe', desc: 'Never post where you’re staying or anything you wouldn’t tell a stranger — a neighbourhood is plenty. Meet in public places. If anyone makes you uncomfortable, block or report them from their profile or your message thread, and our team will review it.' },
            ].map(x => (
              <div key={x.term} className="bg-gray-50 border border-gray-100 rounded-2xl p-5">
                <dt className="font-bold text-gray-900"><span aria-hidden="true">{x.icon} </span>{x.term}</dt>
                <dd className="text-sm text-gray-600 mt-1.5 leading-relaxed">{x.desc}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <Link href={isMember ? newVisitHref : '/apply'}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
              {isMember ? ctaLabel : 'Apply to join — it’s free'}
            </Link>
            <Link href="/guidelines" className="inline-flex items-center justify-center px-6 py-3 border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-semibold rounded-xl transition-colors">
              Community rules
            </Link>
          </div>
        </div>
      </section>

      {/* ── Perfect for your stay — Guide experiences matched to the
          season of the viewer's posted dates. Members with dates only. */}
      {viewerVisit && (() => {
        const bySlug = new Map(allExperiences.map(e => [e.slug, e]))
        const picks = seasonalPicks(viewerVisit.startsOn)
          .map(sl => bySlug.get(sl))
          .filter((e): e is NonNullable<typeof e> => !!e)
        // The seasonal picks are Istanbul's guide; elsewhere the section
        // still carries the viewer's club events, which it used to take down with it.
        if (picks.length === 0 && clubEventsDuringVisit.length === 0) return null
        return (
          <section className="bg-white border-t border-gray-100">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">
                Perfect for your stay
              </h2>
              {picks.length > 0 && (<>
              <p className="text-gray-600 mt-2 mb-8">
                Experiences that suit the season you&apos;ll be here — from the {city.name} Guide.
              </p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {picks.map(e => (
                  <Link key={e.slug} href={`/guide/${e.slug}`}
                    className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:border-amber-200 hover:shadow-md hover:-translate-y-0.5 transition-all group">
                    <span aria-hidden="true" className="block text-3xl mb-2">{e.emoji}</span>
                    <p className="text-sm font-bold text-gray-900 leading-snug group-hover:text-amber-700 transition-colors">{e.title}</p>
                    <span className="inline-block text-xs font-bold text-amber-600 mt-2">Read guide →</span>
                  </Link>
                ))}
              </div>
              </>)}

              {/* §32 (Clubs) — your clubs while you're here. */}
              {clubEventsDuringVisit.length > 0 && (
                <div className="mt-8">
                  <h3 className="text-sm font-extrabold text-gray-600 uppercase tracking-widest mb-3">Your clubs while you&apos;re here</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {clubEventsDuringVisit.map(ev => (
                      <Link key={ev.id} href={`/events/${ev.id}`}
                        className="flex items-start gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm hover:border-amber-300 transition-colors">
                        <span aria-hidden="true" className="text-xl shrink-0">{ev.emoji}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-gray-900 truncate">{ev.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {formatDay(ev.date)}
                            {ev.club && <> · {ev.club.emoji} {ev.club.name}</>}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )
      })()}

      {/* ── Hangouts while you're here (§20) — members only, silent when
          there are none. Spontaneous plans are the fastest way a visitor
          actually meets people, which is this page's whole promise. */}
      {hangoutsDuringVisit.length > 0 && (
        <section className="bg-amber-50/60 border-t border-amber-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">
              Hangouts while you&apos;re here
            </h2>
            <p className="text-gray-600 mt-2 mb-8">
              Spontaneous plans from members — no RSVP ceremony, just show up.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {hangoutsDuringVisit.map(hg => (
                <Link key={hg.id} href={`/hangouts/${hg.id}`}
                  className="bg-white border border-amber-100 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-amber-300 transition-all group">
                  <p className="font-bold text-gray-900 leading-snug group-hover:text-amber-700 transition-colors">
                    {hg.title}
                  </p>
                  <p className="text-xs text-gray-500 mt-1.5">
                    🕐 {new Date(hg.startsAt).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: city.timezone })}
                    {hg.neighborhood && <> · 📍 {hg.neighborhood}</>}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {firstNameOf(hg.user.name)} · 👥 {hg._count.joins + 1} going
                    {hg.maxPeople && hg.maxPeople - hg._count.joins - 1 > 0 && <> · {hg.maxPeople - hg._count.joins - 1} spots left</>}
                  </p>
                  <span className="inline-block text-xs font-bold text-amber-600 mt-3">Join →</span>
                </Link>
              ))}
            </div>
            <Link href="/hangouts" className="inline-block mt-6 text-sm font-bold text-amber-600 hover:underline">
              All hangouts →
            </Link>
          </div>
        </section>
      )}

      {/* ── Already in <city>? ── */}
      <section className="bg-amber-50 border-t border-amber-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <div className="max-w-3xl">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">Already in {city.name}?</h2>
            <p className="text-gray-700 mt-3 leading-relaxed">
              Someone is about to experience your city for the first time.
              Help make their arrival a little easier.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
            {[
              { icon: '☕', label: 'Invite someone for coffee' },
              { icon: '💡', label: 'Share a local tip'         },
              { icon: '🤝', label: 'Make an introduction'      },
            ].map(a => (
              <div key={a.label} className="bg-white border border-amber-100 rounded-2xl p-5">
                <div aria-hidden="true" className="text-2xl mb-2">{a.icon}</div>
                <p className="text-sm font-bold text-gray-900">{a.label}</p>
              </div>
            ))}
          </div>
          <a href="#visitors"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 mt-8 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
            Welcome someone
            <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </a>
        </div>
      </section>

      {/* ── Where you can use Smileys today ── the network as it is. Active
          means members and events now; Founding means the city is open but
          just starting (few or no events yet); Coming soon means no community
          there yet. Same maturity signal as the city cards (lib/tripPlan). */}
      <section aria-labelledby="where-title" className="bg-white border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <h2 id="where-title" className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">Where you can use Smileys today</h2>
          {hereAvailability !== 'active' && (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 max-w-2xl">
              {hereAvailability === 'founding'
                ? `Smileys ${city.name} is just getting started — there may be few or no events during your stay yet, and fewer members around to meet.`
                : `Smileys isn’t active in ${city.name} yet — there are no events or members to meet there for now.`}
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
            {([
              { key: 'active',      title: 'Active',      note: 'Members, clubs and events you can join now.',        cities: availability.active },
              { key: 'founding',    title: 'Founding',    note: 'Open, but just starting — few or no events yet.',   cities: availability.founding },
              { key: 'coming_soon', title: 'Coming soon', note: 'No community there yet. Get notified when it opens.', cities: availability.coming_soon },
            ] as const).filter(g => g.cities.length > 0).map(g => (
              <div key={g.key} className="rounded-2xl border border-gray-100 bg-gray-50 p-5">
                <h3 className="font-bold text-gray-900">{g.title}</h3>
                <p className="text-xs text-gray-500 mt-0.5 mb-3">{g.note}</p>
                <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                  {g.cities.map(c => (
                    <li key={c.id}>
                      <Link href={g.key === 'coming_soon' ? `/${c.slug}` : (c.slug === DEFAULT_CITY_SLUG ? '/visiting' : `/visiting?city=${c.slug}`)}
                        className="font-semibold text-gray-800 hover:text-amber-700">{c.name}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Social proof (§10 of the brief) is deliberately absent: the only
          testimonials on record are general Smileys ones, not from visitors
          who used this feature. Dressing those up as visit stories would be
          fabrication, so the section stays out until real ones exist. */}

      {/* ── Final CTA ── */}
      <section className="bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Arrive knowing someone.
          </h2>
          <p className="text-gray-300 mt-5 max-w-xl mx-auto leading-relaxed">
            Tell the community you&apos;re coming and start making connections before you arrive.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href={isMember ? newVisitHref : '/apply'}
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-amber-500 hover:bg-amber-600 text-white text-base font-bold rounded-xl transition-colors">
              {ctaLabel}
              <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
            {!isMember && (
              <Link href="/apply"
                className="inline-flex items-center justify-center gap-2 px-7 py-3.5 border border-white/40 hover:bg-white/10 text-white text-base font-semibold rounded-xl transition-colors">
                Join Smileys
              </Link>
            )}
          </div>
        </div>
      </section>

      <StickyVisitCta hasPosted={!!viewerVisit} href={isMember ? newVisitHref : '/apply'} />
    </div>
  )
}
