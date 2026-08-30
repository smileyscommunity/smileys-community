import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { todayInTz } from '@/lib/cityTime'
import { getSession } from '@/lib/session'
import { getEvents, getClubs, redactEventForGuest } from '@/lib/db'
import CityPageTracker from '@/components/CityPageTracker'
import EventTabs from '@/components/EventTabs'
import JoinCityButton from '@/components/JoinCityButton'
import ClubCard from '@/components/ClubCard'
import { getNeighborhoodViews } from '@/lib/neighborhoodsDb'
import { resolveImageUrl, eventWindowFor, formatShortDate } from '@/lib/data'
import { getPublicCity, DEFAULT_CITY_SLUG } from '@/lib/cities'
import { CITY_MATURITY } from '@/lib/cityMaturity'
import { CITY_STATUS } from '@/lib/cityStatus'
import { APP_URL } from '@/lib/env'
import { absoluteOgImage } from '@/lib/og'
import { isSoldOut } from '@/lib/soldOut'

// The per-city shopfront: /app/istanbul today, /app/athens the moment an admin
// flips Athens to live. Nothing here names a city — everything comes from the
// city record — which is the whole point of the multi-city architecture. If you
// find yourself writing "Istanbul" into this file, it belongs in the city's
// `tagline`/`description` column instead.
//
// This is a dynamic segment at the site root, so it only catches paths no
// static route claims (/events, /clubs, /about … all still win). Unknown slugs
// fall through to notFound().

interface Params { params: Promise<{ city: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city) return {}

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

const getCityPageData = unstable_cache(
  // `tz` is the city's own zone, passed in rather than defaulted: it is part of
  // the cache key (unstable_cache hashes the args), so two cities in different
  // zones can't share a "today".
  async (cityId: string, tz: string) => {
    const today        = todayInTz(tz)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const [{ events }, clubs, neighborhoodCounts, testimonials, newMembersThisWeek, guideEntries] = await Promise.all([
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
    ])

    return { events, clubs, neighborhoodCounts, testimonials, newMembersThisWeek, guideEntries }
  },
  ['city-page-data'],
  { revalidate: 60, tags: ['home'] },
)

export default async function CityPage({ params }: Params) {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city) notFound()

  // A city that isn't live has no events, clubs or members to show. Rather
  // than render a page full of empty sections, it gets a holding page — the
  // same rule the city cards follow.
  if (city.status !== CITY_STATUS.Live) {
    return (
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
        <CityPageTracker slug={city.slug} status={city.status} />
        {/* The city's own photo, if one is set. A pre-launch page is a pitch —
            "this is where we're going next" lands far better with the place in
            front of you than with a paragraph of text. */}
        {city.heroImage && (
          <div className="relative aspect-[16/9] rounded-2xl overflow-hidden shadow-xl mb-10">
            <Image
              src={resolveImageUrl(city.heroImage)}
              alt={city.name}
              fill priority
              sizes="(max-width: 768px) calc(100vw - 32px), 768px"
              className="object-cover"
            />
          </div>
        )}
        <span className="inline-block px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold uppercase tracking-widest mb-6">
          {city.status === CITY_STATUS.Preparing ? 'Preparing' : 'Coming soon'}
        </span>
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900 mb-5">
          {/* The city's own name carries the brand amber in every heading on
              this page — amber-600 rather than the brand's amber-500, which is
              a button fill and clears only ~2.1:1 on white. Matches the
              handbook's city heading. */}
          Smileys is coming to <span className="text-amber-600">{city.name}.</span>
        </h1>
        <p className="text-lg text-gray-600 leading-relaxed mb-10">
          {city.description ?? `We're building the ${city.name} community now — founding members, hosts and the first clubs. Join the list and you'll be among the first in.`}
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <JoinCityButton slug={city.slug} name={city.name} live={false} />
          <Link href="/cities" className="btn-secondary text-base px-8 py-4">See our live cities</Link>
        </div>
      </section>
    )
  }

  const { events: cachedEvents, clubs, neighborhoodCounts, testimonials, newMembersThisWeek, guideEntries } = await getCityPageData(city.id, city.timezone)
  const hasGuide = guideEntries > 0

  // Guest redaction happens per-request, OUTSIDE the shared cache entry —
  // a session-dependent branch must never write into unstable_cache. Same
  // projection as GET /api/events.
  const session = await getSession()
  const events = session ? cachedEvents : cachedEvents.map(redactEventForGuest)

  // ── Visitors (phase 4: the cross-city loop's read side) ────────────────
  // Per-request like the redaction above: members see members-only visits,
  // guests only the public ones — a session-dependent set must never enter
  // the shared cache. Contact and email are never selected at all, so the
  // guest tier is safe by construction, not by stripping.
  // This city's clock, not Istanbul's — a visit whose last day is "today" here
  // must not drop out (or linger) because Istanbul already rolled over.
  const visitorsToday = todayInTz(city.timezone)
  const visitorWhere = {
    cityId: city.id, status: 'active', endsOn: { gte: visitorsToday },
    ...(session ? {} : { visibility: 'public' }),
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

  // Emoji and slug come from THIS city's registry, not Istanbul's constant —
  // an İzmir district would otherwise render Istanbul's pin and link to a slug
  // that resolves to nothing. A count for a neighborhood that's since been
  // deactivated has no row to render, so it drops out.
  const registry = await getNeighborhoodViews(city.id)
  const byEvents = neighborhoodCounts.flatMap(c => {
    const row = registry.find(n => n.name === c.neighborhood)
    return row ? [{ name: row.name, slug: row.slug, emoji: row.emoji, eventCount: c._count._all, vibe: row.vibe }] : []
  })
  // A young city has neighborhoods before it has events, and deriving this
  // section purely from event counts hid it entirely: Bodrum launched with 8
  // neighborhoods, 0 upcoming events, and therefore no way to browse them from
  // its own page. Fall back to the city's registry so the areas are still
  // discoverable — the cards drop the count rather than advertise "0 events".
  const topNeighborhoods = byEvents.length > 0
    ? byEvents
    : registry.slice(0, 6).map(n => ({ name: n.name, slug: n.slug, emoji: n.emoji, eventCount: 0, vibe: n.vibe }))
  const neighborhoodsHaveEvents = byEvents.length > 0

  // Prospect-facing surface: cancelled events break trust in a showcase slot,
  // and sold-out ones sink below the joinable ones.
  const liveEvents = events.filter(e => e.status !== 'cancelled')
  const tabEvents = [
    ...liveEvents.filter(e => !isSoldOut(e)),
    ...liveEvents.filter(isSoldOut),
  ]
  // The city's own week and weekend — this page had been computing them in
  // the founding city's terms, on a page whose entire subject is another city.
  const eventWindow = eventWindowFor(city.timezone)

  // Clubs with something scheduled first — alphabetical order would fill the
  // page with dormant clubs.
  const featuredClubs = [
    ...clubs.filter(c => c.nextEvent).sort((a, b) => a.nextEvent!.date.localeCompare(b.nextEvent!.date)),
    ...clubs.filter(c => !c.nextEvent).sort((a, b) => b.memberCount - a.memberCount),
  ].slice(0, 4)

  const stats = city.stats

  // Feed links route through /api/city/enter, which sets the view-city
  // cookie before landing — so "See what's on" from /izmir shows İzmir's
  // events, not the default city's. Plain <a> targets (route handler, not a
  // page), hence the explicit /app basePath.
  const enter = (to: 'events' | 'clubs' | 'directory' | 'neighborhoods' | 'guide' | 'handbook', n?: string) =>
    `/app/api/city/enter?city=${city.slug}&to=${to}${n ? `&n=${encodeURIComponent(n)}` : ''}`

  const isDefaultCity = city.slug === DEFAULT_CITY_SLUG

  return (
    <>
      <CityPageTracker slug={city.slug} status={city.status} />
      {/* Hero */}
      <section className="relative bg-gradient-to-b from-amber-50 via-white to-white overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(251,191,36,0.15),transparent)]" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 relative">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div>
              <Link href="/cities" className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-amber-700 hover:text-amber-800 mb-6">
                <span aria-hidden="true">←</span> All Smileys cities
              </Link>

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-gray-900 leading-[1.08] mb-6">
                Find your people in <span className="text-amber-600">{city.name}.</span>
              </h1>

              <p className="text-lg md:text-xl text-gray-600 max-w-2xl leading-relaxed mb-10">
                {city.description ?? `From social dinners to weekend trips and neighborhood clubs, Smileys brings people together in ${city.name} through curated experiences and lasting friendships.`}
              </p>

              <div className="lg:hidden relative aspect-[3/2] rounded-2xl overflow-hidden shadow-xl mb-10">
                <CityHeroImage city={city} sizes="(max-width: 639px) calc(100vw - 32px), calc(100vw - 48px)" />
              </div>

              <div className="flex flex-col sm:flex-row gap-4 mb-3">
                {/* Signed-in members get a one-tap join (their account already
                    exists — see components/JoinCityButton); guests fall through
                    to the application flow below. */}
                <JoinCityButton slug={city.slug} name={city.name} />
                <a href={enter('events')} className="btn-secondary text-base px-8 py-4">See what's on</a>
              </div>
              <p className="text-sm font-medium text-gray-700 mb-12">
                Free to join · Applications reviewed by hand within 24 hours · Pay only for events you attend
              </p>

              {/* Seeding = live but empty; "1 / 11 / 1" in hero type reads as
                  a dead community, not a young one. Stage-honest copy instead —
                  derived (lib/cityMaturity), so it flips back to real numbers
                  by itself the moment the city earns them. */}
              {stats && (stats.maturity === CITY_MATURITY.Seeding ? (
                <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-5 py-4">
                  <p className="text-sm font-bold text-amber-800 uppercase tracking-wider mb-1">Founding stage</p>
                  <p className="text-gray-700">
                    {stats.clubs > 0
                      ? <>{stats.clubs} club{stats.clubs === 1 ? '' : 's'} forming and the first events going on the calendar — the founding members shape everything here.</>
                      : <>The first clubs and events are being set up now — the founding members shape everything here.</>}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-x-6">
                  {[
                    { value: stats.members, label: 'Members' },
                    { value: stats.clubs,   label: 'Clubs' },
                    // "Upcoming events" wraps in a ~110px column on a 375px
                    // phone; "Upcoming" is what the homepage city card says too.
                    { value: stats.events,  label: 'Upcoming' },
                  ].map(s => (
                    <div key={s.label}>
                      <div className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight tabular-nums">
                        {s.value.toLocaleString('en-US')}
                      </div>
                      <div className="text-xs text-gray-600 mt-1 uppercase tracking-wider font-medium">{s.label}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="hidden lg:block relative h-[500px] rounded-2xl overflow-hidden shadow-xl">
              <CityHeroImage city={city} sizes="(max-width: 1024px) 0px, (max-width: 1344px) calc(50vw - 64px), 576px" />
            </div>
          </div>
        </div>
      </section>

      {/* Events — a live city with none yet gets an invitation, not a
          missing section (§30: never look broken, communicate opportunity). */}
      {tabEvents.length === 0 && (
        <section className="py-12 sm:py-16 bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="rounded-3xl border border-amber-100 bg-gradient-to-br from-amber-50 to-white p-8 sm:p-12 text-center">
              <h2 className="section-title mb-2">Events are coming soon</h2>
              <p className="text-gray-600 mb-6 max-w-xl mx-auto">
                Be one of the first to help build Smileys {city.name} — the first dinners, walks and meetups start with the first members.
              </p>
              <div className="flex justify-center">
                <JoinCityButton slug={city.slug} name={city.name} />
              </div>
            </div>
          </div>
        </section>
      )}
      {tabEvents.length > 0 && (
        <section className="py-12 sm:py-16 bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-6">
              <h2 className="section-title">What's happening in <span className="text-amber-600">{city.name}</span></h2>
              <p className="section-subtitle">Pick a day and see what's on.</p>
            </div>
            <EventTabs events={tabEvents} window={eventWindow} />
          </div>
        </section>
      )}

      {/* Clubs — same rule: an empty grid becomes a host invitation. */}
      {featuredClubs.length === 0 && (
        <section className="py-12 sm:py-16 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="rounded-3xl border border-gray-100 bg-gray-50 p-8 sm:p-12 text-center">
              <h2 className="section-title mb-2">Clubs are forming</h2>
              <p className="text-gray-600 mb-6 max-w-xl mx-auto">
                Have an activity you want to organize in {city.name}? The first clubs are started by members like you.
              </p>
              <Link href="/get-involved" className="btn-primary inline-flex">Become a host</Link>
            </div>
          </div>
        </section>
      )}
      {featuredClubs.length > 0 && (
        <section className="py-12 sm:py-16 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-end justify-between mb-8">
              <div>
                <h2 className="section-title">Find your people</h2>
                <p className="section-subtitle">Every interest covered — join as many as you like.</p>
              </div>
              <a href={enter('clubs')} className="hidden md:flex btn-ghost text-sm items-center gap-1">All clubs →</a>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {featuredClubs.map(club => <ClubCard key={club.id} club={club} hideEmptyNextEvent />)}
            </div>
            <div className="text-center mt-10 md:hidden">
              <a href={enter('clubs')} className="btn-secondary">All clubs</a>
            </div>
          </div>
        </section>
      )}

      {/* Neighborhoods — every city now. /neighborhoods and
          /neighborhoods/[slug] both resolve against the viewer's city, so an
          İzmir slug is a real page rather than the 404 this gate existed to
          avoid. Links route through /api/city/enter so arriving from /izmir
          sets the view-city cookie first — without it a member whose home city
          is Istanbul would land on the İzmir slug and 404 all over again. */}
      {topNeighborhoods.length > 0 && (
        <section className="py-12 sm:py-16 bg-gray-50 border-t border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-end justify-between mb-8">
              <div>
                <h2 className="section-title">Explore by neighborhood</h2>
                {/* Don't promise weekly events to a city that has none yet —
                    the same section serves both, so the subtitle follows the
                    data rather than the ambition. */}
                <p className="section-subtitle">
                  {neighborhoodsHaveEvents
                    ? `Events happening all across ${city.name}, every week.`
                    : `The areas Smileys covers in ${city.name} — see who's around and what's starting.`}
                </p>
              </div>
              <a href={enter('neighborhoods')} className="hidden md:flex btn-ghost text-sm items-center gap-1">All neighborhoods →</a>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {topNeighborhoods.map(n => (
                <a key={n.slug} href={enter('neighborhoods', n.slug)}
                  className="group flex flex-col items-center text-center gap-2 bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-amber-200 hover:-translate-y-0.5 transition-all duration-200">
                  <span className="text-3xl">{n.emoji}</span>
                  <span className="font-semibold text-sm text-gray-900 group-hover:text-amber-600 transition-colors leading-tight">{n.name}</span>
                  {/* Event count where there are events; the neighborhood's own
                      vibe line otherwise. "0 events" on every card reads as a
                      dead city, and a city this young is the one that can least
                      afford that first impression. */}
                  {n.eventCount > 0
                    ? <span className="text-xs text-amber-600 font-semibold">{n.eventCount} event{n.eventCount !== 1 ? 's' : ''}</span>
                    : n.vibe
                      ? <span className="text-xs text-gray-600 leading-snug">{n.vibe}</span>
                      : null}
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Visitors — who's coming to town, and the door to announcing your
          own trip. Renders even when empty for LIVE cities: the empty state
          IS the invitation, and the announce CTA is how the first visitor
          card ever appears. */}
      <section className="py-14 sm:py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h2 className="section-title">Visiting <span className="text-amber-600">{city.name}?</span></h2>
            <p className="section-subtitle max-w-2xl">
              {/* Four cards render and the rest are one click away for every
                  city now, so the total is an honest number again — it was
                  "4 of 12" while a second city had no way to reach them. */}
              {visitorTotal === 0
                ? 'Announce your trip and the community knows you\u2019re coming before you land.'
                : `${visitorTotal} traveler${visitorTotal === 1 ? ' is' : 's are'} announcing a trip right now \u2014 announce yours and arrive with plans.`}
            </p>
          </div>
          {visitors.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {visitors.map(v => (
                <div key={v.id} className="card p-5">
                  <p className="font-bold text-gray-900 truncate">{v.name.split(' ')[0]}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{v.fromCity ? `from ${v.fromCity}` : 'traveling'}</p>
                  <p className="text-xs font-semibold text-amber-600 mt-2">
                    {formatShortDate(v.startsOn)} – {formatShortDate(v.endsOn)}
                  </p>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-4 flex-wrap">
            <Link href={`/visiting/new?city=${city.slug}`} className="btn-primary px-6 py-3">
              Announce your visit
            </Link>
            {/* Every city now, not just the default one: /visiting follows
                ?city= (a4d00f3), so the rest of a second city's travelers are
                reachable rather than advertised and hidden. */}
            <Link
              href={isDefaultCity ? '/visiting' : `/visiting?city=${city.slug}`}
              className="text-sm font-bold text-amber-600 hover:underline"
            >
              See all visitors →
            </Link>
          </div>
        </div>
      </section>

      {/* Shown when the city HAS a guide, not when it is the default city.
          The old gate was written when /guide could only ever serve the default
          city's entries, so offering "the <city> guide" anywhere else would
          have handed the reader someone else's content — worse than no link.
          Both halves of that are now false: the guide reads per city, and the
          second city has a dozen entries of its own. All the gate still did was
          hide a real guide from the city it belongs to.

          Counting entries rather than naming a city also keeps it honest for
          city #3, which has none on day one and shouldn't be offered an empty
          guide. */}
      {hasGuide && (
        <section className="py-12 sm:py-16 bg-white border-t border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="rounded-3xl bg-gradient-to-br from-amber-50 to-white border border-amber-100 p-8 sm:p-12">
              <h2 className="section-title">Get to know <span className="text-amber-600">{city.name}</span></h2>
              <p className="section-subtitle max-w-2xl mb-8">
                Neighborhoods, where to go, things to do, coworking, nightlife and the local tips
                that take newcomers months to work out.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                {/* Through the city-enter endpoint, which sets the view city before
                    landing: /guide reads the viewer's city, so a plain link would
                    show a cookie-less visitor Istanbul's guide from Bodrum's page. */}
                <a href={enter('guide')} className="btn-primary">Read the {city.name} guide</a>
                {/* The Handbook (how the city works: transport cards, permits,
                    banking) is the practical sibling of the guide — the four
                    national articles apply to every city from day one, so this
                    link never lands on an empty shelf. */}
                <a href={enter('handbook')} className="btn-secondary">The {city.name} Handbook</a>
                <a href={enter('directory')} className="btn-secondary">Browse places</a>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Stories */}
      {/* No member-count gate here any more: the query itself is now the
          honest filter. A quote reaches this page only if it belongs to this
          city or was deliberately marked across-Smileys, so a brand-new city
          shows nothing until someone says something about it. */}
      {testimonials.length > 0 && (
        <section className="py-12 sm:py-16 bg-gray-50 border-t border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-8">
              <h2 className="section-title">Life happens offline</h2>
              <p className="section-subtitle">Real stories from real members.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {testimonials.map(t => (
                <div key={t.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <p className="text-sm text-gray-600 leading-relaxed mb-4 italic">"{t.quote}"</p>
                  <div className="flex items-center gap-3">
                    {t.photo ? (
                      <img src={resolveImageUrl(t.photo)} alt={t.memberName} className="w-11 h-11 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-11 h-11 rounded-full shrink-0 bg-amber-500 flex items-center justify-center text-white text-sm font-bold">
                        {t.memberName[0]}
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-bold text-gray-900">{t.memberName}</p>
                      {t.role && <p className="text-xs text-gray-400">{t.role}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Final CTA */}
      <section className="py-16 sm:py-20 bg-white border-t border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-gray-900 mb-4">
            Ready to find your people?
          </h2>
          <p className="text-lg text-gray-600 mb-8">
            {/* "Join Smileys" to someone already signed in is an invitation to
                apply to a community they're already in. */}
            {session
              ? `See what's on in ${city.name} this week.`
              : `Join Smileys and start building your social life in ${city.name}.`}
            {newMembersThisWeek > 0 && ` ${newMembersThisWeek} new member${newMembersThisWeek === 1 ? '' : 's'} joined this week.`}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            {/* Same component the hero uses, and for the same reason: it is the
                one place that knows whether the viewer is a guest (apply), a
                member of another city (join this one), or already in (a badge).
                This section owned a bare /apply link instead — exactly the bug
                JoinCityButton's comment describes, left behind when the hero
                was fixed. */}
            <JoinCityButton slug={city.slug} name={city.name} />
            <a href={enter('events')} className="btn-secondary text-base px-8 py-4">
              {session ? 'Browse events' : 'Browse events first'}
            </a>
          </div>
        </div>
      </section>
    </>
  )
}

// Falls back to the shared community photo when a city has no hero of its own,
// so a newly-live city is never a grey box.
function CityHeroImage({ city, sizes }: { city: { name: string; heroImage: string | null }; sizes: string }) {
  return (
    <Image
      src={city.heroImage ? resolveImageUrl(city.heroImage) : '/app/images/hero-istanbul.jpg'}
      alt={`Smileys members in ${city.name}`}
      fill
      priority
      fetchPriority="high"
      sizes={sizes}
      className="object-cover"
    />
  )
}
