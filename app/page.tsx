import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getEvents, getClubs } from '@/lib/db'
import { getSession } from '@/lib/session'
import EventCard from '@/components/EventCard'
import ClubCard from '@/components/ClubCard'
import { neighborhoodToSlug, getNeighborhoodMeta } from '@/lib/neighborhoods'
import { resolveImageUrl, todayIstanbul } from '@/lib/data'
import { loadContent } from '@/lib/content'
import ActivityTicker from '@/components/ActivityTicker'

export const dynamic = 'force-dynamic'

const steps = [
  {
    step: '01',
    title: 'Discover',
    description: "Browse upcoming events and clubs curated for Istanbul's social scene.",
    emoji: '🔍',
  },
  {
    step: '02',
    title: 'Join',
    description: 'Reserve your spot in seconds. No complicated sign-ups or waiting lists.',
    emoji: '✅',
  },
  {
    step: '03',
    title: 'Connect',
    description: 'Show up, meet people, and build genuine friendships that last.',
    emoji: '🤝',
  },
]

export default async function HomePage() {
  const session = await getSession()
  if (session) {
    if (session.role === 'admin') redirect('/admin')
    else redirect('/dashboard')
  }

  const today = new Date().toISOString().split('T')[0]
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [{ events }, clubs, neighborhoodCounts, testimonials, recentMembers, totalRsvps] = await Promise.all([
    getEvents({ limit: 3, upcoming: true }),
    getClubs(),
    prisma.event.groupBy({
      by: ['neighborhood'],
      where: { date: { gte: today } },
      _count: { _all: true },
      orderBy: { _count: { neighborhood: 'desc' } },
      take: 6,
    }),
    prisma.testimonial.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }], take: 3 }),
    prisma.user.findMany({
      where: { status: 'approved', role: 'member', joinedAt: { gte: sevenDaysAgo } },
      select: { name: true, nationality: true },
      orderBy: { joinedAt: 'desc' },
      take: 6,
    }),
    prisma.eventAttendee.count({
      where: {
        status: 'approved',
        event: { status: 'published', date: { gte: today }, membersOnly: false },
      },
    }),
  ])

  const topNeighborhoods = neighborhoodCounts.map(c => ({
    name:       c.neighborhood,
    slug:       neighborhoodToSlug(c.neighborhood),
    eventCount: c._count._all,
    meta:       getNeighborhoodMeta(c.neighborhood),
  }))

  const featuredEvents = events
  const featuredClubs  = clubs.slice(0, 4)

  const tickerItems: { emoji: string; text: string }[] = [
    ...recentMembers.map(m => ({
      emoji: '🌱',
      text: `${m.name.split(' ')[0]} just joined`,
    })),
    ...(totalRsvps > 0 ? [{ emoji: '🎟️', text: `${totalRsvps} RSVPs for upcoming events` }] : []),
    { emoji: '✦', text: 'Applications reviewed by hand' },
    { emoji: '📍', text: 'Based in Istanbul' },
    { emoji: '🤝', text: 'Real friendships, not followers' },
    { emoji: '🔒', text: 'Members only community' },
  ]

  const c     = loadContent()
  const home  = c.home ?? {}
  const stats = c.stats ?? [
    { value: '4,000+', label: 'Community members'  },
    { value: '500+',   label: 'Experiences hosted' },
    { value: '120+',   label: 'Active clubs'         },
    { value: 'Weekly', label: 'Curated events'      },
  ]

  return (
    <>
      {/* Hero */}
      <section className="relative bg-gradient-to-b from-amber-50 via-white to-white overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(251,191,36,0.15),transparent)]" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24 relative">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">

            {/* Text column */}
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-amber-200 text-amber-700 rounded-full text-xs font-semibold tracking-widest uppercase mb-8">
                Curated Social Community
              </div>

              <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-gray-900 leading-[1.08] mb-6">
                {home.headline ?? 'Find your people in Istanbul.'}
              </h1>

              <p className="text-xl md:text-2xl text-gray-600 max-w-2xl leading-relaxed mb-10">
                {home.subtitle ?? 'From social dinners to sailing trips and neighborhood clubs, Smileys brings people together through curated experiences and lasting friendships.'}
              </p>

              <div className="flex flex-col sm:flex-row gap-4 mb-16">
                <Link href="/apply" className="btn-primary text-base px-8 py-4">
                  Apply to join
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </Link>
                <Link href="/clubs" className="btn-secondary text-base px-8 py-4">
                  Browse clubs
                </Link>
              </div>

              {/* Mobile/tablet hero image — desktop sees the side image, so hide at lg+ */}
              <div className="lg:hidden relative aspect-[3/2] rounded-2xl overflow-hidden shadow-xl mb-12">
                <Image
                  src="/images/hero-istanbul.jpg"
                  alt="Friends gathered on an Istanbul rooftop at sunset"
                  fill
                  unoptimized
                  sizes="100vw"
                  className="object-cover"
                />
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-8">
                {stats.map((stat: { value: string; label: string }) => (
                  <div key={stat.label}>
                    <div className="text-3xl md:text-4xl font-extrabold text-gray-900 tracking-tight">{stat.value}</div>
                    <div className="text-sm text-gray-600 mt-1 uppercase tracking-wider font-medium">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Hero image — `unoptimized` because Next's image optimizer
                returns an empty response for public/ assets when basePath
                is set (next.js#45888). The image only renders at lg+ via
                hidden lg:block, so the unoptimized 533KB JPEG cost is
                desktop-only. */}
            <div className="hidden lg:block relative h-[520px] rounded-2xl overflow-hidden shadow-xl">
              <Image
                src="/images/hero-istanbul.jpg"
                alt="Friends gathered on an Istanbul rooftop at sunset"
                fill
                priority
                unoptimized
                sizes="(max-width: 1024px) 0px, 50vw"
                className="object-cover"
              />
            </div>

          </div>
        </div>
      </section>

      {/* Live activity ticker */}
      <ActivityTicker items={tickerItems} />

      {/* How it works */}
      <section className="py-12 sm:py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-10">
            <h2 className="section-title">How Smileys works</h2>
            <p className="section-subtitle max-w-xl">Three simple steps to transform your social life in Istanbul.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {steps.map((s) => (
              <div key={s.step} className="text-center p-8 rounded-2xl bg-slate-50 hover:bg-slate-100 transition-colors duration-300 group">
                <div className="w-16 h-16 rounded-2xl bg-white shadow-card flex items-center justify-center mx-auto mb-5 text-3xl group-hover:scale-110 transition-transform duration-300">
                  {s.emoji}
                </div>
                <span className="step-label">Step {s.step}</span>
                <h3 className="text-xl font-bold text-gray-900 mt-2 mb-3">{s.title}</h3>
                <p className="text-gray-600 leading-relaxed text-sm">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Events */}
      <section className="py-12 sm:py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between mb-8">
            <div>
              <h2 className="section-title">Upcoming events</h2>
              <p className="section-subtitle">Hand-picked experiences for this week.</p>
            </div>
            <Link href="/events" className="hidden md:flex btn-ghost text-sm items-center gap-1">
              View all
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {featuredEvents.map((event) => (
              <EventCard key={event.id} event={event} linkPrefix="/events" />
            ))}
          </div>
          <div className="text-center mt-10 md:hidden">
            <Link href="/events" className="btn-secondary">View all events</Link>
          </div>
        </div>
      </section>

      {/* Featured Clubs */}
      <section className="py-12 sm:py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between mb-8">
            <div>
              <h2 className="section-title">Our clubs</h2>
              <p className="section-subtitle">Find your community. Every interest covered.</p>
            </div>
            <Link href="/clubs" className="hidden md:flex btn-ghost text-sm items-center gap-1">
              All clubs
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {featuredClubs.map((club) => (
              <ClubCard key={club.id} club={club} />
            ))}
          </div>
          <div className="text-center mt-10 md:hidden">
            <Link href="/clubs" className="btn-secondary">All clubs</Link>
          </div>
        </div>
      </section>

      {/* Neighborhoods */}
      {topNeighborhoods.length > 0 && (
        <section className="py-12 sm:py-16 bg-gray-50 border-t border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-end justify-between mb-8">
              <div>
                <h2 className="section-title">Explore by neighborhood</h2>
                <p className="section-subtitle">Events happening all across Istanbul, every week.</p>
              </div>
              <Link href="/neighborhoods" className="hidden md:flex btn-ghost text-sm items-center gap-1">
                All neighborhoods
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
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
            <div className="mt-6 text-center md:hidden">
              <Link href="/neighborhoods" className="text-sm text-amber-600 font-semibold hover:underline">
                View all neighborhoods →
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Testimonial strip */}
      {testimonials.length > 0 && (
        <section className="py-12 sm:py-16 bg-white border-t border-gray-100">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">What members say</h2>
                <p className="text-sm text-gray-600 mt-1">Real stories from real people</p>
              </div>
              <Link href="/why" className="text-sm font-semibold text-amber-600 hover:underline">
                Read all stories →
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {testimonials.map(t => (
                <div key={t.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <p className="text-sm text-gray-600 leading-relaxed mb-4 italic">"{t.quote}"</p>
                  <div className="flex items-center gap-3">
                    {t.photo ? (
                      <img src={resolveImageUrl(t.photo)} alt={t.memberName}
                        className="w-11 h-11 rounded-full object-cover shrink-0" />
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

    </>
  )
}
