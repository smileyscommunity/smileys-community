import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getEvents, redactEventForGuest } from '@/lib/db'
import { getSession } from '@/lib/session'
import EventTabs from '@/components/EventTabs'
import CityCard from '@/components/CityCard'
import { resolveImageUrl, istanbulEventWindow } from '@/lib/data'
import { getPublicCities, getDefaultCityId, CITY_STATUS } from '@/lib/cities'
import { CITY_MATURITY } from '@/lib/cityMaturity'
import { APP_URL } from '@/lib/env'
import { loadContent } from '@/lib/content'
import { absoluteOgImage } from '@/lib/og'
import { isSoldOut } from '@/lib/soldOut'

// ── The global landing page ─────────────────────────────────────────────────
// Smileys is not a website about Istanbul; Istanbul is the first Smileys city.
// That distinction drives this whole file: nothing below hard-codes a city
// name, a city count, or a city list. Everything comes from getPublicCities(),
// so activating Athens in the admin makes Athens appear here — card, nav entry,
// expansion list — with no code change.
//
// The two failure modes this page is deliberately steering between:
//   · Looking like an Istanbul-only site (which is what we're replacing)
//   · Looking like we already operate in ten cities (which would be a lie)
// Hence: real statistics for live cities only, no invented launch dates, and
// copy that says "growing city by city" rather than implying a network that
// doesn't exist yet.

// Built per request so the share image is the hero the admin actually set. A
// link to the global landing page previewed the generated card titled
// "Smileys Community — Istanbul", which is the one message this page exists to
// stop sending.
export async function generateMetadata(): Promise<Metadata> {
  const home    = loadContent().home ?? {}
  const ogImage = absoluteOgImage(home.heroImage)
  const title   = 'Smileys — your people, in every city you land in'
  const description =
    'Meet people, join clubs and discover experiences wherever your international life takes you. Smileys is a network of local communities, growing city by city.'

  return {
    title,
    description,
    alternates: { canonical: APP_URL },
    openGraph: {
      title, description, url: APP_URL,
      ...(ogImage ? { images: [{ url: ogImage, width: 1200, height: 630, alt: 'Smileys Community' }] } : {}),
    },
    ...(ogImage ? { twitter: { card: 'summary_large_image' as const, images: [ogImage] } } : {}),
  }
}

const getLandingData = unstable_cache(
  async () => {
    // Events on the global page come from the default city today, because it's
    // the only live one. When a second city goes live this becomes a city
    // filter rather than a different query — the shape already supports it.
    const cityId = await getDefaultCityId()

    const [{ events: rawEvents }, testimonials, memberCount, stories] = await Promise.all([
      // Wide enough for the tabs to filter across a month; the page is
      // cached for 60s, so one fetch beats a request per tab.
      getEvents({ limit: 24, upcoming: true, cityId }),
      prisma.testimonial.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }], take: 3 }),
      prisma.user.count({ where: { status: 'approved' } }),
      // Community write-ups — member and host stories, already public at
      // /posts/<slug>. Handbook articles are excluded: they're practical
      // reference ("how to get a residence permit"), not community life.
      prisma.post.findMany({
        where:   { status: 'published', kind: 'community' },
        orderBy: { publishedAt: 'desc' },
        take:    3,
        select:  { id: true, slug: true, title: true, excerpt: true, coverImage: true, publishedAt: true },
      }),
    ])

    // This page redirects every session away (see HomePage), so the viewer
    // is a guest BY CONSTRUCTION — redact inside the cache, unconditionally.
    // Same projection as GET /api/events: no exact address/GPS, no chat or
    // meeting links, no payment contact, no attendee identities.
    const events = rawEvents.map(redactEventForGuest)
    return { events, testimonials, memberCount, stories }
  },
  ['global-landing-data'],
  { revalidate: 60, tags: ['home'] },
)

const WHY = [
  { emoji: '👋', title: 'Meet people',      body: 'Discover people who share your interests, your stage of life and your sense of humour.' },
  { emoji: '🎭', title: 'Join clubs',       body: 'Communities built around activities and passions — sailing, theatre, hiking, food, film, language.' },
  { emoji: '📅', title: 'Discover events',  body: 'From dinners and nightlife to sailing, theatre, sports and workshops. Something on every week.' },
  { emoji: '📍', title: 'Explore your neighborhood', body: 'Find people and plans near where you actually live, not across town.' },
  { emoji: '✨', title: 'Discover experiences', body: 'Go beyond group chats and see the city together — the whole point is offline.' },
  { emoji: '🌍', title: 'Stay connected across cities', body: 'Your Smileys profile travels with you when you visit another Smileys city.' },
]

export default async function HomePage() {
  const session = await getSession()
  if (session) {
    // Everyone lands on the member dashboard, admins included. The logo is the
    // universal "take me home" control, and sending admins to /admin made it
    // the one control that couldn't get them home — there was no route back to
    // their own member view without typing the URL. /admin is a tap away in the
    // Me sheet and the header, and an admin who can't easily see what members
    // see stops noticing what members hit.
    redirect('/dashboard')
  }

  // Hero copy and image are admin-editable at /admin/content → Home. Defaults
  // below are the shipped copy, so clearing a field restores it rather than
  // leaving the hero blank.
  const home = loadContent().home ?? {}
  const heroImage = home.heroImage || '/app/images/hero-istanbul.jpg'
  const heroAlt   = 'Smileys members together at a community dinner'

  const [cities, { events, testimonials, memberCount, stories }] = await Promise.all([
    getPublicCities(),
    getLandingData(),
  ])

  // "Live" on the hero is a promise about the EXPERIENCE, not the ops flag:
  // a status-live city whose community is still seeding can't deliver
  // events-and-people yet, and counting it reads as a false claim ("LIVE IN
  // 2 CITIES" while the second had one member). Only self-sustaining live
  // cities count; founding-stage live cities ride the "on the way" number,
  // which corrects itself as each city matures — no flag to remember to
  // flip. Falls back to raw status if no city qualifies, so the hero never
  // says "Live in 0 cities".
  const statusLive  = cities.filter(c => c.status === CITY_STATUS.Live)
  const mature      = statusLive.filter(c => c.stats?.maturity === CITY_MATURITY.SelfSustaining)
  const liveCities  = mature.length > 0 ? mature : statusLive
  const otherCities = cities.filter(c => !liveCities.includes(c))
  const flagship    = liveCities[0] ?? null

  // Cancelled events break trust in a showcase slot; sold-out ones sink to the
  // bottom so joinable ones get the space. Order is preserved within each group,
  // and the tabs filter over the result.
  const liveEvents = events.filter(e => e.status !== 'cancelled')
  const tabEvents = [
    ...liveEvents.filter(e => !isSoldOut(e)),
    ...liveEvents.filter(isSoldOut),
  ]
  const eventWindow = istanbulEventWindow()

  // Primary CTA names the flagship city when there is exactly one live city
  // ("Explore Istanbul"), and becomes "Find your city" once there are more.
  // No copy change needed at launch — the page grows into it.
  const singleCity = liveCities.length === 1 && flagship

  // The status pill is the only thing above the fold that can say Smileys is
  // more than one city — the city grid proving it sits below. With the CTA
  // reading "Explore Istanbul" right under it, a visitor who leaves in three
  // seconds saw an Istanbul website. So the pill carries the rest of the
  // network and links down to it, which beats spending a third button on it.
  const eyebrow = singleCity ? `Live in ${flagship.name}` : `Live in ${liveCities.length} cities`
  const onTheWay = otherCities.length > 0 ? ` · ${otherCities.length} more on the way` : ''

  return (
    <>
      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative bg-gradient-to-b from-amber-50 via-white to-white overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(251,191,36,0.15),transparent)]" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 relative">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div>
              {onTheWay ? (
                <Link
                  href="#cities"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors text-xs font-bold tracking-widest uppercase mb-8"
                >
                  <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {eyebrow}{onTheWay}
                  <span aria-hidden="true">↓</span>
                </Link>
              ) : (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase mb-8">
                  <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {eyebrow}
                </div>
              )}

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-gray-900 leading-[1.08] mb-6">
                {home.headline || 'Your people, in every city you land in.'}
              </h1>

              <p className="text-lg md:text-xl text-gray-600 max-w-2xl leading-relaxed mb-10">
                {home.subtitle || 'Meet people, join local communities, and make real plans in the cities you call home.'}
              </p>

              <div className="lg:hidden relative aspect-[3/2] rounded-2xl overflow-hidden shadow-xl mb-10">
                <Image
                  src={resolveImageUrl(heroImage)}
                  alt={heroAlt}
                  fill priority fetchPriority="high"
                  sizes="(max-width: 639px) calc(100vw - 32px), calc(100vw - 48px)"
                  className="object-cover"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-4 mb-3">
                {singleCity ? (
                  <Link href={`/${flagship.slug}`} className="btn-primary text-base px-8 py-4">
                    Explore {flagship.name}
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </Link>
                ) : (
                  <Link href="#cities" className="btn-primary text-base px-8 py-4">Find your city</Link>
                )}
                <Link href="/apply" className="btn-secondary text-base px-8 py-4">Join Smileys</Link>
              </div>
              {/* Third action, deliberately not a third button: the city grid
                  is worth reaching, not worth competing with Join. */}
              {singleCity && otherCities.length > 0 && (
                <p className="mb-3">
                  <Link href="#cities" className="text-sm font-semibold text-amber-700 hover:text-amber-800 transition-colors">
                    See all Smileys cities →
                  </Link>
                </p>
              )}
              <p className="text-sm font-medium text-gray-700">
                Free to join · Applications reviewed by hand within 24 hours · Pay only for events you attend
              </p>
            </div>

            <div className="hidden lg:block relative h-[500px] rounded-2xl overflow-hidden shadow-xl">
              <Image
                src={resolveImageUrl(heroImage)}
                alt={heroAlt}
                fill priority fetchPriority="high"
                sizes="(max-width: 1024px) 0px, (max-width: 1344px) calc(50vw - 64px), 576px"
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Happening this week ────────────────────────────────────────── */}
      {/* Directly under the hero on purpose: people don't join "social
          infrastructure", they join a dinner next Thursday. The concrete
          product goes first; the philosophy sections now argue for something
          the visitor has already seen. */}
      {tabEvents.length > 0 && (
        <section className="py-14 sm:py-20 bg-gray-50 border-t border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-6">
              <h2 className="section-title">
                {singleCity ? `Happening in ${flagship.name} this week` : 'Happening this week'}
              </h2>
              <p className="section-subtitle">
                {singleCity ? 'Real plans, real people — walk into any of them.' : 'Coming up across the network.'}
              </p>
            </div>
            {/* A city filter joins these tabs once a second city is live. */}
            <EventTabs events={tabEvents} window={eventWindow} />
          </div>
        </section>
      )}

      {/* ── Choose your city ───────────────────────────────────────────── */}
      <section id="cities" className="py-14 sm:py-20 bg-white scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-10">
            <h2 className="section-title">Find your Smileys city</h2>
            <p className="section-subtitle max-w-2xl">
              Every Smileys city is its own local community — its own members, clubs, events and hosts.
              One account gets you into all of them.
            </p>
          </div>

          {/* Live cities lead, at full size. One live city gets a wide card
              rather than a lonely third of a row. */}
          <div className={`grid gap-6 ${liveCities.length === 1 ? 'lg:grid-cols-2' : 'md:grid-cols-2 lg:grid-cols-3'}`}>
            {liveCities.map((c, i) => (
              <CityCard key={c.id} city={c} featured={liveCities.length === 1 && i === 0} />
            ))}
          </div>

          {otherCities.length > 0 && (
            <div className="mt-12 pt-10 border-t border-gray-100">
              <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-6">On the way</h3>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {otherCities.map(c => <CityCard key={c.id} city={c} />)}
              </div>
            </div>
          )}

          {/* Deliberately vague: no dates, no city names we haven't committed
              to. An invented launch date is a promise someone has to keep. */}
          <p className="mt-10 text-sm text-gray-500">
            More cities are coming. Somewhere you'd like to see Smileys?{' '}
            <Link href="/contact" className="font-semibold text-amber-600 hover:underline">Tell us where.</Link>
          </p>
        </div>
      </section>

      {/* ── Why Smileys ────────────────────────────────────────────────── */}
      <section className="py-14 sm:py-20 bg-gray-50 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-10">
            <h2 className="section-title">More than a community. Your social infrastructure.</h2>
            <p className="section-subtitle max-w-2xl">
              Moving somewhere new shouldn't mean starting your social life from zero every time.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {WHY.map(w => (
              <div key={w.title} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                <div className="text-3xl mb-4">{w.emoji}</div>
                <h3 className="font-bold text-gray-900 mb-2">{w.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{w.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How membership works ───────────────────────────────────────── */}
      {/* Pricing up front: free-to-join / pay-per-event lived only in the
          FAQ and a tagline, so visitors assumed a subscription. */}
      <section className="py-14 sm:py-20 bg-white border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-10">
            <h2 className="section-title">How membership works</h2>
            <p className="section-subtitle max-w-2xl">
              No subscription, no membership fee. Here&apos;s the whole deal.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                emoji: '🆓',
                title: 'Joining is free',
                body:  'Apply in about five minutes. We review every application by hand within 24–48 hours — we look for vibe alignment, not credentials.',
              },
              {
                emoji: '🎟️',
                title: 'You only pay for events you choose',
                body:  'Many hangouts are free. Some curated events and experiences have a ticket price set by the host, shown clearly before you RSVP.',
              },
              {
                emoji: '🔑',
                title: 'Everything opens up once you’re in',
                body:  'Browse clubs, RSVP to events, join club walls, and use your city’s guide, handbook, and community boards.',
              },
            ].map(w => (
              <div key={w.title} className="bg-gray-50 rounded-2xl border border-gray-100 shadow-sm p-6">
                <div className="text-3xl mb-4">{w.emoji}</div>
                <h3 className="font-bold text-gray-900 mb-2">{w.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{w.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Visiting ───────────────────────────────────────────────────── */}
      <section className="py-14 sm:py-20 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">Visiting another city?</h2>
              <p className="text-lg text-gray-300 leading-relaxed mb-6">
                Your Smileys community travels with you. Tell us you're coming and you'll see local
                members, events, clubs and places before you land — so you arrive with plans, not a map.
              </p>
              <Link href="/visiting" className="btn-primary text-base px-8 py-4">I'm visiting</Link>
            </div>
            <div className="rounded-2xl bg-white/5 border border-white/10 p-6 sm:p-8">
              <p className="text-sm uppercase tracking-widest text-amber-400 font-bold mb-4">How it works</p>
              <ol className="space-y-4 text-sm text-gray-300">
                <li className="flex gap-3"><span className="font-bold text-white shrink-0">1.</span> Post your dates and where you're headed.</li>
                <li className="flex gap-3"><span className="font-bold text-white shrink-0">2.</span> Local members see you're coming and reach out.</li>
                <li className="flex gap-3"><span className="font-bold text-white shrink-0">3.</span> Join events and club nights while you're there.</li>
              </ol>
              <p className="text-xs text-gray-500 mt-6">
                Gets better with every city we launch — one account, every community.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Guides ─────────────────────────────────────────────────────── */}
      <section className="py-14 sm:py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h2 className="section-title">Get to know your city</h2>
            <p className="section-subtitle max-w-2xl">
              Neighborhoods, where to go, things to do, coworking, nightlife, day trips and the
              local knowledge that normally takes a year to pick up.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {liveCities.map(c => (
              <Link key={c.id} href="/guide" className="group card p-6 hover:-translate-y-1 transition-transform duration-300">
                <div className="text-2xl mb-3">📖</div>
                <h3 className="font-bold text-gray-900 mb-1 group-hover:text-amber-600 transition-colors">
                  The {c.name} guide
                </h3>
                <p className="text-sm text-gray-600">
                  Neighborhoods, food, nightlife, coworking and practical life admin.
                </p>
              </Link>
            ))}
            <Link href="/handbook" className="group card p-6 hover:-translate-y-1 transition-transform duration-300">
              <div className="text-2xl mb-3">🧭</div>
              <h3 className="font-bold text-gray-900 mb-1 group-hover:text-amber-600 transition-colors">The handbook</h3>
              <p className="text-sm text-gray-600">Residence permits, banking, healthcare and the rest of moving-country admin.</p>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Community stories ──────────────────────────────────────────── */}
      {(testimonials.length > 0 || stories.length > 0) && (
        <section className="py-14 sm:py-20 bg-gray-50 border-t border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-8">
              <h2 className="section-title">Life happens offline</h2>
              <p className="section-subtitle">Real stories from real members.</p>
            </div>

            {/* Written pieces first — a member or host telling their own story
                carries further than a pull-quote. */}
            {stories.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
                {stories.map(p => (
                  <Link key={p.id} href={`/posts/${p.slug}`} className="group card overflow-hidden hover:-translate-y-1 transition-transform duration-300">
                    {p.coverImage && (
                      <div className="relative aspect-[16/9]">
                        <Image src={resolveImageUrl(p.coverImage)} alt="" fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover" />
                      </div>
                    )}
                    <div className="p-5">
                      <h3 className="font-bold text-gray-900 mb-1.5 group-hover:text-amber-600 transition-colors line-clamp-2">{p.title}</h3>
                      {p.excerpt && <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">{p.excerpt}</p>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
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

            {stories.length > 0 && (
              <div className="mt-8">
                <Link href="/posts" className="btn-ghost text-sm">Read more from the community →</Link>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── One community, growing city by city ────────────────────────── */}
      <section className="py-14 sm:py-20 bg-white border-t border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-gray-900 mb-4">
            One community. Growing city by city.
          </h2>
          <p className="text-lg text-gray-600 leading-relaxed mb-10">
            Smileys started in Istanbul. We're building a global network of local communities where
            international people can meet, connect and build a social life together.
          </p>

          {/* The network as it actually is — live cities marked, everything
              else honestly labelled. */}
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm">
            {cities.map(c => (
              <span key={c.id} className="inline-flex items-center gap-2">
                <span aria-hidden="true" className={`w-2 h-2 rounded-full ${c.status === CITY_STATUS.Live ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                <span className={c.status === CITY_STATUS.Live ? 'font-bold text-gray-900' : 'text-gray-500'}>{c.name}</span>
                {c.status !== CITY_STATUS.Live && (
                  <span className="text-xs text-gray-400 uppercase tracking-wide">soon</span>
                )}
              </span>
            ))}
          </div>
          <p className="mt-6 text-sm text-gray-500">
            {memberCount.toLocaleString('en-US')} members and counting.
          </p>
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────────── */}
      <section className="py-16 sm:py-24 bg-gradient-to-b from-white to-amber-50 border-t border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-gray-900 mb-4">
            Ready to find your people?
          </h2>
          <p className="text-lg text-gray-600 mb-8">
            {singleCity
              ? `Join Smileys and start building your social life in ${flagship.name}.`
              : 'Join Smileys and start building your social life wherever you are.'}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/apply" className="btn-primary text-base px-8 py-4">Join Smileys</Link>
            {singleCity && (
              <Link href={`/${flagship.slug}`} className="btn-secondary text-base px-8 py-4">
                Explore {flagship.name}
              </Link>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
