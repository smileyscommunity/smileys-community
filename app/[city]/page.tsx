import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getEvents, getClubs } from '@/lib/db'
import EventCard from '@/components/EventCard'
import ClubCard from '@/components/ClubCard'
import { neighborhoodToSlug, getNeighborhoodMeta } from '@/lib/neighborhoods'
import { resolveImageUrl } from '@/lib/data'
import { getPublicCity } from '@/lib/cities'
import { CITY_STATUS } from '@/lib/cityStatus'
import { APP_URL } from '@/lib/env'

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

  const title = `Smileys ${city.name} — meet people, join clubs, discover events`
  const description = city.description
    ?? city.tagline
    ?? `Your international social life in ${city.name}. Events, clubs and community for people building a life abroad.`

  return {
    title,
    description,
    alternates: { canonical: `${APP_URL}/${city.slug}` },
    openGraph: { title, description, url: `${APP_URL}/${city.slug}` },
  }
}

const getCityPageData = unstable_cache(
  async (cityId: string) => {
    const today        = new Date().toISOString().split('T')[0]
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const [{ events }, clubs, neighborhoodCounts, testimonials, recentMembers] = await Promise.all([
      getEvents({ limit: 6, upcoming: true, cityId }),
      getClubs(cityId),
      prisma.event.groupBy({
        by: ['neighborhood'],
        where: { date: { gte: today }, cityId },
        _count: { _all: true },
        orderBy: { _count: { neighborhood: 'desc' } },
        take: 6,
      }),
      prisma.testimonial.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }], take: 3 }),
      prisma.user.findMany({
        where: { status: 'approved', role: 'member', joinedAt: { gte: sevenDaysAgo }, cityId },
        select: { name: true },
        orderBy: { joinedAt: 'desc' },
        take: 6,
      }),
    ])

    return { events, clubs, neighborhoodCounts, testimonials, recentMembers }
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
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-24 text-center">
        <span className="inline-block px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold uppercase tracking-widest mb-6">
          {city.status === CITY_STATUS.Preparing ? 'Preparing' : 'Coming soon'}
        </span>
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900 mb-5">
          Smileys is coming to {city.name}.
        </h1>
        <p className="text-lg text-gray-600 leading-relaxed mb-10">
          {city.description ?? `We're building the ${city.name} community now — founding members, hosts and the first clubs. Join the list and you'll be among the first in.`}
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href={`/apply?city=${city.slug}`} className="btn-primary text-base px-8 py-4">Get notified</Link>
          <Link href="/" className="btn-secondary text-base px-8 py-4">See our live cities</Link>
        </div>
      </section>
    )
  }

  const { events, clubs, neighborhoodCounts, testimonials, recentMembers } = await getCityPageData(city.id)

  const topNeighborhoods = neighborhoodCounts.map(c => ({
    name:       c.neighborhood,
    slug:       neighborhoodToSlug(c.neighborhood),
    eventCount: c._count._all,
    meta:       getNeighborhoodMeta(c.neighborhood),
  }))

  // Prospect-facing surface: cancelled events break trust in a showcase slot,
  // and sold-out ones only backfill so the joinable ones get the space.
  const liveEvents = events.filter(e => e.status !== 'cancelled')
  const soldOut = (e: (typeof events)[number]) => e.limitedSpots && e.spotsLeft <= 0
  const featuredEvents = [
    ...liveEvents.filter(e => !soldOut(e)),
    ...liveEvents.filter(soldOut),
  ].slice(0, 3)

  // Clubs with something scheduled first — alphabetical order would fill the
  // page with dormant clubs.
  const featuredClubs = [
    ...clubs.filter(c => c.nextEvent).sort((a, b) => a.nextEvent!.date.localeCompare(b.nextEvent!.date)),
    ...clubs.filter(c => !c.nextEvent).sort((a, b) => b.memberCount - a.memberCount),
  ].slice(0, 4)

  const stats = city.stats

  return (
    <>
      {/* Hero */}
      <section className="relative bg-gradient-to-b from-amber-50 via-white to-white overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(251,191,36,0.15),transparent)]" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 relative">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div>
              <Link href="/" className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-amber-700 hover:text-amber-800 mb-6">
                <span aria-hidden="true">←</span> All Smileys cities
              </Link>

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-gray-900 leading-[1.08] mb-6">
                Find your people in {city.name}.
              </h1>

              <p className="text-lg md:text-xl text-gray-600 max-w-2xl leading-relaxed mb-10">
                {city.description ?? `From social dinners to weekend trips and neighborhood clubs, Smileys brings people together in ${city.name} through curated experiences and lasting friendships.`}
              </p>

              <div className="lg:hidden relative aspect-[3/2] rounded-2xl overflow-hidden shadow-xl mb-10">
                <CityHeroImage city={city} sizes="(max-width: 639px) calc(100vw - 32px), calc(100vw - 48px)" />
              </div>

              <div className="flex flex-col sm:flex-row gap-4 mb-3">
                <Link href={`/apply?city=${city.slug}`} className="btn-primary text-base px-8 py-4">
                  Join Smileys {city.name}
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </Link>
                <Link href="/events" className="btn-secondary text-base px-8 py-4">See what's on</Link>
              </div>
              <p className="text-sm font-medium text-gray-700 mb-12">
                Free to join · Applications reviewed by hand within 24 hours · Pay only for events you attend
              </p>

              {stats && (
                <div className="grid grid-cols-3 gap-x-6">
                  {[
                    { value: stats.members, label: 'Members' },
                    { value: stats.clubs,   label: 'Clubs' },
                    { value: stats.events,  label: 'Upcoming events' },
                  ].map(s => (
                    <div key={s.label}>
                      <div className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight tabular-nums">
                        {s.value.toLocaleString('en-US')}
                      </div>
                      <div className="text-xs text-gray-600 mt-1 uppercase tracking-wider font-medium">{s.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="hidden lg:block relative h-[500px] rounded-2xl overflow-hidden shadow-xl">
              <CityHeroImage city={city} sizes="(max-width: 1024px) 0px, (max-width: 1344px) calc(50vw - 64px), 576px" />
            </div>
          </div>
        </div>
      </section>

      {/* Events */}
      {featuredEvents.length > 0 && (
        <section className="py-12 sm:py-16 bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-end justify-between mb-8">
              <div>
                <h2 className="section-title">What's happening in {city.name}</h2>
                <p className="section-subtitle">Hand-picked experiences for this week.</p>
              </div>
              <Link href="/events" className="hidden md:flex btn-ghost text-sm items-center gap-1">View all →</Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {featuredEvents.map(event => <EventCard key={event.id} event={event} linkPrefix="/events" />)}
            </div>
            <div className="text-center mt-10 md:hidden">
              <Link href="/events" className="btn-secondary">View all events</Link>
            </div>
          </div>
        </section>
      )}

      {/* Clubs */}
      {featuredClubs.length > 0 && (
        <section className="py-12 sm:py-16 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-end justify-between mb-8">
              <div>
                <h2 className="section-title">Find your people</h2>
                <p className="section-subtitle">Every interest covered — join as many as you like.</p>
              </div>
              <Link href="/clubs" className="hidden md:flex btn-ghost text-sm items-center gap-1">All clubs →</Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {featuredClubs.map(club => <ClubCard key={club.id} club={club} hideEmptyNextEvent />)}
            </div>
            <div className="text-center mt-10 md:hidden">
              <Link href="/clubs" className="btn-secondary">All clubs</Link>
            </div>
          </div>
        </section>
      )}

      {/* Neighborhoods */}
      {topNeighborhoods.length > 0 && (
        <section className="py-12 sm:py-16 bg-gray-50 border-t border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-end justify-between mb-8">
              <div>
                <h2 className="section-title">Explore by neighborhood</h2>
                <p className="section-subtitle">Events happening all across {city.name}, every week.</p>
              </div>
              <Link href="/neighborhoods" className="hidden md:flex btn-ghost text-sm items-center gap-1">All neighborhoods →</Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {topNeighborhoods.map(n => (
                <Link key={n.slug} href={`/neighborhoods/${n.slug}`}
                  className="group flex flex-col items-center text-center gap-2 bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-amber-200 hover:-translate-y-0.5 transition-all duration-200">
                  <span className="text-3xl">{n.meta.emoji}</span>
                  <span className="font-semibold text-sm text-gray-900 group-hover:text-amber-600 transition-colors leading-tight">{n.name}</span>
                  <span className="text-xs text-amber-600 font-semibold">{n.eventCount} event{n.eventCount !== 1 ? 's' : ''}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Guide */}
      <section className="py-12 sm:py-16 bg-white border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-3xl bg-gradient-to-br from-amber-50 to-white border border-amber-100 p-8 sm:p-12">
            <h2 className="section-title">Get to know {city.name}</h2>
            <p className="section-subtitle max-w-2xl mb-8">
              Neighborhoods, where to go, things to do, coworking, nightlife and the local tips
              that take newcomers months to work out.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/guide" className="btn-primary">Read the {city.name} guide</Link>
              <Link href="/directory" className="btn-secondary">Browse places</Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stories */}
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
            Join Smileys and start building your social life in {city.name}.
            {recentMembers.length > 0 && ` ${recentMembers.length} new members joined this week.`}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href={`/apply?city=${city.slug}`} className="btn-primary text-base px-8 py-4">Join Smileys</Link>
            <Link href="/events" className="btn-secondary text-base px-8 py-4">Browse events first</Link>
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
