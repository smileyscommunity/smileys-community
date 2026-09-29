import Link from 'next/link'
import ClubLink from '@/components/ClubLink'
import { getCommunityStats, approx } from '@/lib/communityStats'
import { APP_URL } from '@/lib/env'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { DEFAULT_CITY_SLUG } from '@/lib/city'
import { resolveImageUrl } from '@/lib/data'
import { loadContent } from '@/lib/content'
import { resolveCityForPage, cityQs, type CitySearch } from '@/lib/cityPageParam'
import { testimonialAuthorOk, TESTIMONIAL_SELECT, publicTestimonial } from '@/lib/testimonialQuery'
import { startedCutoff, shiftDay, formatDay } from '@/lib/cityTime'
import { WHY_PAGE_TAG } from '@/lib/cityPageCache'

// Everything here is per city (?city=, else the viewer's city — the same rule
// as /get-involved): this page used to be Istanbul's for everyone, including
// the Tbilisi applicant who followed "Read member stories" from the form.
const getWhyPageData = unstable_cache(
  async (cityId: string, tz: string) => {
    const { today, cutoffTime } = startedCutoff(tz)
    const [testimonials, photos, clubs, week, unlistable] = await Promise.all([
      // The city's own quotes first, then the across-Smileys ones, through
      // the same author gate and photo rule as the homepage and city pages.
      prisma.testimonial.findMany({
        where:   { active: true, AND: [{ OR: [{ cityId }, { cityId: null }] }, testimonialAuthorOk()] },
        orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
        select:  { ...TESTIMONIAL_SELECT, category: true },
      }).then(rows => rows.map(publicTestimonial).sort((x, y) => Number(y.cityId === cityId) - Number(x.cityId === cityId))),
      prisma.storyPhoto.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }, { createdAt: 'desc' }], take: 12, select: { id: true, url: true, caption: true, event: true } }),
      prisma.club.findMany({ where: { isActive: true, cityId }, orderBy: { memberCount: 'desc' }, take: 8, select: { id: true, name: true, emoji: true, bgColor: true, color: true, memberCount: true, slug: true } }),
      // "A week inside Smileys" is the city's real next seven days, not a
      // typed timetable: the old one promised a Monday movie night that
      // hadn't run in months. Same window and statuses as the public lists.
      prisma.event.findMany({
        where: {
          cityId, status: 'published',
          OR: [
            { date: { gt: today, lte: shiftDay(today, 6) } },
            { AND: [{ date: today }, { time: { gte: cutoffTime } }] },
          ],
        },
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
        take: 60,
        select: { id: true, title: true, date: true, hostId: true },
      }),
      prisma.user.findMany({ where: { OR: [{ status: 'banned' }, { suspendedUntil: { gt: new Date() } }] }, select: { id: true } }),
    ])
    // A banned or suspended host's events leave every public list (lib/db getEvents).
    const hidden = new Set(unlistable.map(u => u.id))
    const days: { date: string; events: { id: string; title: string }[] }[] = []
    for (let i = 0; i < 7; i++) days.push({ date: shiftDay(today, i), events: [] })
    for (const e of week) {
      if (hidden.has(e.hostId)) continue
      days.find(d => d.date === e.date)?.events.push({ id: e.id, title: e.title })
    }
    return { testimonials, photos, clubs, days }
  },
  ['why-page-v2'],
  { revalidate: 300, tags: [WHY_PAGE_TAG] },
)

// See app/about/page.tsx for why this is needed — a page-level `openGraph`
// block loses the root layout's default og:image, so this page shared with
// no preview at all on WhatsApp/iMessage/Twitter until this was added.
const ogImage = `${APP_URL}/api/og?${new URLSearchParams({
  title:   'Why Smileys?',
  eyebrow: 'Find your people',
  cta:     'Apply to join',
}).toString()}`

export const metadata = {
  alternates: { canonical: `${APP_URL}/why` },
  title: 'Why Smileys? — Find Your People',
  description: 'A new city can feel crowded and still lonely. Smileys is the curated social community for globally minded people building a real social life.',
  openGraph: {
    title: 'Why Smileys? — Find Your People',
    description: 'A curated real-life social ecosystem for globally minded people.',
    url: `${APP_URL}/why`,
    images: [{ url: ogImage, width: 1200, height: 630, alt: 'Why Smileys? — Find Your People' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Why Smileys? — Find Your People',
    description: 'A curated real-life social ecosystem for globally minded people.',
    images: [ogImage],
  },
}


const CAT_PILL: Record<string, string> = {
  general:  'bg-gray-100 text-gray-600',
  friends:  'bg-green-100 text-green-700',
  expat:    'bg-blue-100 text-blue-700',
  business: 'bg-purple-100 text-purple-700',
  travel:   'bg-amber-100 text-amber-700',
}
const CAT_LABEL: Record<string, string> = {
  general:  'Member',
  friends:  'Made close friends',
  expat:    'New in town',
  business: 'Found business partners',
  travel:   'Found travel buddies',
}

const DIFFERENTIATORS = [
  { icon: '🔍', title: 'Curated membership', body: 'Every person is personally reviewed before they join. The result is a network you can actually trust.' },
  { icon: '🤝', title: 'Real-life first',    body: 'We\'re not a chat group or a feed. We\'re built around shared experiences that create lasting bonds.' },
  { icon: '🏛️', title: 'Interest-based circles', body: 'Sailing. Jazz. Language exchange. Hiking. Business. Whatever you\'re into, there\'s a club for it.' },
  { icon: '📅', title: 'A steady rhythm',    body: 'Events come round again and again, so the people you meet once become people you keep seeing.' },
  { icon: '🌍', title: 'International & local', body: 'Expats, nomads, locals, travelers — one network. The mix is what makes it interesting.' },
  { icon: '🛡️', title: 'Protected culture', body: 'Clear community rules, a report button on every profile, and a team that acts on what it hears.' },
]

const WHO = ['Expats', 'Digital nomads', 'Travelers', 'Entrepreneurs', 'Creatives', 'Remote workers', 'Language learners', 'Globally minded locals', 'People new to the city', 'People rebuilding their circle']

const PHILOSOPHY = [
  'Real friendships still matter.',
  'Circles should feel intentional — not accidental.',
  'A city becomes yours when you have people in it.',
  'The best experiences are shared ones.',
]

export default async function WhyPage({ searchParams }: { searchParams?: Promise<CitySearch> }) {
  const { city, cityId } = await resolveCityForPage(searchParams)
  const qs = cityQs(city.slug)
  const { testimonials, photos: dbPhotos, clubs, days } = await getWhyPageData(cityId, city.timezone)
  const weekEvents = days.reduce((n, d) => n + d.events.length, 0)

  // Measured, platform-wide numbers only. The shared editorial rows carried
  // "4,000+ total WhatsApp reach" into a page that says "We're not a chat
  // group", and "1,000+ events" that nothing measures.
  const [s, liveCities] = await Promise.all([
    getCommunityStats(),
    prisma.city.count({ where: { status: 'live' } }),
  ])
  const stats = [
    { value: approx(s.members), label: 'Members across Smileys' },
    { value: approx(s.events),  label: 'Events on Smileys' },
    { value: approx(s.clubs),   label: 'Active clubs' },
    { value: String(liveCities), label: liveCities === 1 ? 'City live' : 'Cities live' },
  ]

  // The admin's hero copy is written for the default city ("Istanbul can
  // feel crowded…"); every other city gets the neutral version with its name.
  const c   = loadContent()
  const own = city.slug === DEFAULT_CITY_SLUG ? (c.why ?? {}) : {}
  const why = {
    headline: own.headline?.trim() || 'A new city can feel crowded — and still lonely.',
    tagline:  own.tagline?.trim()  || `A curated real-life social community for globally minded people in ${city.name}.`,
    subtitle: own.subtitle?.trim() || 'People arrive all the time looking for connection, friendship, and a circle they actually belong to. But most platforms feel random, transactional, or exhausting.',
    closing:  own.closing?.trim()  || 'Smileys was built to change that.',
  }

  return (
    <main className="bg-white overflow-x-hidden">

      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase mb-8">
            <span aria-hidden="true">😊</span> Smileys {city.name}
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight leading-tight mb-4">
            {why.headline}
          </h1>
          <p className="text-base font-semibold text-amber-600 mb-6">
            {why.tagline}
          </p>
          <p className="text-base text-gray-600 max-w-2xl leading-relaxed mb-5">
            {why.subtitle}
          </p>
          <p className="text-base text-gray-900 font-semibold max-w-2xl leading-relaxed mb-10">
            {why.closing}
          </p>
          {/* flex-col + default stretch makes both buttons the same
              width on mobile, matching the About/homepage hero CTA pair. */}
          <div className="flex flex-col sm:flex-row gap-4">
            <Link href={`/apply${qs}`} className="btn-primary text-base px-8 py-4">
              Apply to join
              <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
            <Link href={`/events${qs}`} className="btn-secondary text-base px-8 py-4">Browse events</Link>
          </div>
        </div>
      </section>

      {/* ── STATS ────────────────────────────────────────────── */}
      <section className="bg-amber-500">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-10">
          {/* dl/dt/dd so SRs read this as a definition list, matching the
              About page's identical stat band. value-then-label visually via
              flex-col-reverse, dt-before-dd in source order as the spec
              requires. Also fixes the value size previously going
              4xl → md:3xl → lg:4xl (shrinking then growing back). */}
          {/* Dark text on the amber band: white and amber-100 read at about 2:1. */}
          <dl className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-10 sm:gap-6 text-center text-amber-950">
            {stats.map(s => (
              <div key={s.label} className="flex flex-col-reverse gap-1">
                <dt className="text-amber-950 text-sm uppercase tracking-wider">{s.label}</dt>
                <dd className="text-4xl md:text-5xl font-extrabold">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── WHAT MAKES US DIFFERENT ──────────────────────────── */}
      <section className="py-24 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-14">
            <h2 className="section-title mb-4">
              Not just another group.
            </h2>
            <p className="text-lg text-gray-600 max-w-xl">
              There are plenty of WhatsApp chats, Meetup pages, and nightlife groups. Here's why people choose Smileys instead.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {DIFFERENTIATORS.map(d => (
              <div key={d.title} className="bg-white rounded-2xl p-7 border border-gray-100 shadow-sm">
                <div aria-hidden="true" className="text-2xl mb-4">{d.icon}</div>
                <h3 className="font-bold text-gray-900 mb-2">{d.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{d.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── A WEEK INSIDE SMILEYS ────────────────────────────── */}
      {/* The city's actual next seven days (getWhyPageData). A city with
          nothing on the calendar yet shows no timetable rather than a
          borrowed one. */}
      {weekEvents > 0 && (
        <section className="py-24 bg-gray-50 border-y border-gray-100">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-14">
              <h2 className="section-title mb-4">The next seven days in {city.name}</h2>
              <p className="text-gray-600 max-w-xl">What&apos;s actually on the calendar, straight from the events page.</p>
            </div>
            <ul className="space-y-3">
              {days.map(d => (
                <li key={d.date} className="flex items-start gap-5 bg-white border border-gray-100 rounded-2xl px-5 py-4">
                  <div className="shrink-0 w-16 pt-0.5">
                    <p className="text-xs font-bold text-amber-700 tracking-widest uppercase">{formatDay(d.date, { weekday: 'short' })}</p>
                    <p className="text-xs text-gray-500">{formatDay(d.date, { day: 'numeric', month: 'short' })}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    {d.events.length === 0 ? (
                      <p className="text-sm text-gray-500">Nothing yet</p>
                    ) : (
                      <ul className="space-y-1">
                        {d.events.slice(0, 3).map(e => (
                          // Titles usually carry their own emoji ("💬 Let's Get
                          // Social"); the event's emoji field beside it doubled it.
                          <li key={e.id} className="text-sm">
                            <Link href={`/events/${e.id}`} className="font-semibold text-gray-900 hover:text-amber-700 hover:underline">{e.title}</Link>
                          </li>
                        ))}
                        {d.events.length > 3 && (
                          <li className="text-xs text-gray-500">and {d.events.length - 3} more</li>
                        )}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-center mt-6">
              <Link href={`/events${qs}`} className="inline-flex items-center min-h-[44px] px-2 text-sm font-semibold text-amber-600 hover:underline">
                See all events in {city.name} <span aria-hidden="true">&nbsp;→</span>
              </Link>
            </p>
          </div>
        </section>
      )}

      {/* ── MORE THAN EVENTS ─────────────────────────────────── */}
      <section className="py-24 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
            <div>
              <h2 className="section-title mb-6">
                More than events.<br />
                <span className="text-amber-500">A real social ecosystem.</span>
              </h2>
              <p className="text-gray-600 leading-relaxed mb-8">
                The events are just the entry point. What actually happens is something deeper — people find their circle, build a life in a new city, collaborate, travel together, and stay in touch long after the event ends.
              </p>
              <ul className="space-y-3">
                {[
                  'Finding your people in a new city',
                  'Building friendships that last beyond one meeting',
                  'Discovering the city\'s hidden sides with locals',
                  'Feeling like you actually belong somewhere',
                  'Creating a social life that grows with you',
                ].map(item => (
                  <li key={item} className="flex items-start gap-3">
                    <span aria-hidden="true" className="text-amber-500 font-bold shrink-0 mt-0.5">→</span>
                    <span className="text-gray-700 text-sm leading-snug">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { emoji: '🏔️', label: 'Adventure & outdoors' },
                { emoji: '🍷', label: 'Food & dining'        },
                { emoji: '🎨', label: 'Arts & culture'       },
                { emoji: '💼', label: 'Professional network'  },
                { emoji: '🌊', label: 'Water & sailing'      },
                { emoji: '📚', label: 'Learning & growth'    },
              ].map(c => (
                <div key={c.label} className="bg-gray-50 rounded-2xl p-4 text-center border border-gray-100 hover:border-amber-200 transition-colors">
                  <div aria-hidden="true" className="text-3xl mb-2">{c.emoji}</div>
                  <p className="text-xs font-semibold text-gray-600">{c.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CLUBS SHOWCASE ───────────────────────────────────── */}
      {clubs.length > 0 && (
        <section className="py-24 bg-gray-50">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-12">
              <h2 className="section-title mb-4">Your next obsession is already here.</h2>
              <p className="text-gray-600 max-w-xl">Interest-based circles for every personality. Join one. Join five. Build your Smileys world.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {clubs.map(c => (
                <ClubLink key={c.id} slug={c.slug} citySlug={city.slug}
                  className="rounded-2xl p-4 text-center hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 border border-white/60"
                  style={{ backgroundColor: c.bgColor || '#fef3c7' }}>
                  <div aria-hidden="true" className="text-3xl mb-2">{c.emoji}</div>
                  <p className="text-sm font-bold text-gray-900 leading-snug">{c.name}</p>
                  {/* A founding city's clubs start at zero — no "0 members" badge. */}
                  {c.memberCount > 0 && (
                    <p className="text-xs mt-1" style={{ color: c.color || '#92400e' }}>{c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}</p>
                  )}
                </ClubLink>
              ))}
            </div>
            <div className="text-center mt-8">
              <Link href={`/${city.slug}/clubs`} className="inline-flex items-center min-h-[44px] px-2 text-sm font-semibold text-amber-600 hover:underline">
                See all clubs in {city.name} <span aria-hidden="true">&nbsp;→</span>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ── TESTIMONIALS ─────────────────────────────────────── */}
      {/* No invented fallback: with no active quotes the section is simply
          absent. The old one filled in six made-up members under
          "Real members. No scripts." */}
      {testimonials.length > 0 && (
      <section className="py-24 bg-gray-50 border-y border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-14">
            <h2 className="section-title mb-4">In their own words.</h2>
            <p className="text-gray-600 max-w-xl">What members have told us about Smileys.</p>
          </div>
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-5 space-y-5">
            {testimonials.map(t => {
              const catLabel = CAT_LABEL[t.category] ?? 'Member'
              const catCls   = CAT_PILL[t.category]  ?? 'bg-gray-100 text-gray-600'
              return (
                <figure key={t.id} className="break-inside-avoid bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:border-amber-200 transition-colors">
                  <p aria-hidden="true" className="text-amber-500 text-3xl leading-none mb-3 font-serif">&ldquo;</p>
                  <blockquote className="text-sm text-gray-700 leading-relaxed mb-4">{t.quote}</blockquote>
                  <figcaption className="flex items-center gap-2.5 pt-3 border-t border-gray-100">
                    {t.photo ? (
                      <img src={resolveImageUrl(t.photo)} alt=""
                        className="w-9 h-9 rounded-full object-cover shrink-0" />
                    ) : (
                      <div aria-hidden="true" className="w-9 h-9 rounded-full shrink-0 bg-amber-100 flex items-center justify-center text-amber-800 text-xs font-bold">
                        {t.memberName[0]}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-900">{t.memberName}</p>
                      {t.role && <p className="text-xs text-gray-400">{t.role}</p>}
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${catCls}`}>{catLabel}</span>
                  </figcaption>
                </figure>
              )
            })}
          </div>
        </div>
      </section>
      )}

      {/* ── EVENT PHOTOS ─────────────────────────────────────── */}
      {dbPhotos.length > 0 && (
        <section className="py-24 bg-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-12">
              <h2 className="section-title mb-4">Life inside Smileys.</h2>
              <p className="text-gray-600 max-w-xl">A glimpse of the moments, experiences, and memories our members create every week.</p>
            </div>
            <div className="columns-2 sm:columns-3 lg:columns-4 gap-3 space-y-3">
              {dbPhotos.map(p => (
                <div key={p.id} className="break-inside-avoid relative rounded-2xl overflow-hidden group">
                  <img src={resolveImageUrl(p.url)} alt={p.caption ?? 'Smileys event'} loading="lazy"
                    className="w-full object-cover" />
                  {(p.caption || p.event) && (
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                      {p.caption && <p className="text-xs text-white font-medium">{p.caption}</p>}
                      {p.event   && <p className="text-xs text-amber-300">{p.event}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── WHO JOINS ────────────────────────────────────────── */}
      <section className="py-24 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="section-title mb-4">Who's in the room?</h2>
          <p className="text-gray-600 max-w-xl mx-auto mb-10">Smileys attracts a specific kind of person — curious, open, and genuinely interested in more than surface-level interaction.</p>
          <ul className="flex flex-wrap justify-center gap-3">
            {WHO.map(w => (
              <li key={w} className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-full text-sm font-medium text-gray-700">
                {w}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────── */}
      <section className="py-24 bg-amber-50 border-y border-amber-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-14">
            <h2 className="section-title mb-4">How it works.</h2>
            <p className="text-gray-600 max-w-xl">Simple. Human. Intentional.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              { step: '01', icon: '📝', title: 'Apply',     desc: 'Fill out a short application. We review every profile personally to keep the quality high.' },
              { step: '02', icon: '✅', title: 'Get approved', desc: 'Once approved, you get full access — events, clubs, members, and everything in between.' },
              { step: '03', icon: '🤝', title: 'Show up',   desc: 'Attend an event. Join a club. Meet someone. Your circle starts with a single yes.' },
            ].map(s => (
              <div key={s.step} className="text-center">
                <div aria-hidden="true" className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white border border-amber-200 shadow-sm text-2xl mb-4">
                  {s.icon}
                </div>
                <div className="step-label mb-1">{s.step}</div>
                <h3 className="text-lg font-extrabold text-gray-900 mb-2">{s.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ──────────────────────────────────────────── */}
      {/* Applying and event pages both stay silent on cost until after
          approval — a curious visitor had no way to find this out short of
          finishing a 5-step application. Numbers here are the real current
          shape of pricing (checked against live event data), described
          qualitatively rather than as a stat that'll go stale next week. */}
      <section className="py-24 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-14">
            <h2 className="section-title mb-4">What does it cost?</h2>
            <p className="text-gray-600 max-w-xl">No membership fee. No surprises.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: '💛', title: 'Free to apply',        desc: 'Applying and getting approved costs nothing — no membership fee, ever.' },
              { icon: '🎉', title: 'Most events are free',  desc: 'The majority of our events have no cost at all. Just RSVP and show up.' },
              { icon: '🎟️', title: 'Paid events, upfront',  desc: 'When an event has a cost — venue, food, an activity — the price is shown clearly before you RSVP.' },
              { icon: '🏛️', title: 'Clubs are always free', desc: 'Every interest-based club is free to join. No exceptions.' },
            ].map(s => (
              <div key={s.title} className="text-center sm:text-left">
                <div aria-hidden="true" className="text-3xl mb-3">{s.icon}</div>
                <h3 className="font-bold text-gray-900 mb-2">{s.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PHILOSOPHY ───────────────────────────────────────── */}
      <section className="py-24 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="section-title mb-12">What we believe.</h2>
          <div className="space-y-6">
            {PHILOSOPHY.map((p, i) => (
              <div key={i} className="flex items-center gap-4 text-left">
                <div aria-hidden="true" className="w-8 h-8 rounded-full bg-amber-100 text-amber-800 font-bold text-sm flex items-center justify-center shrink-0">
                  {i + 1}
                </div>
                <p className="text-lg text-gray-800 font-medium">{p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TRUST SIGNALS ────────────────────────────────────── */}
      <section className="py-16 bg-gray-50 border-y border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
            {[
              { icon: '🔒', title: 'Screened community',   desc: 'Every application is personally reviewed. No random strangers.' },
              { icon: '⭐', title: 'Hosts you can see',     desc: 'Events are run by hosts from the community. You can see who they are before you go.' },
              { icon: '✅', title: 'Real profiles',         desc: 'Everyone applies with their real name and a photo, and our team reviews it before they join.' },
            ].map(s => (
              <div key={s.title}>
                <div aria-hidden="true" className="text-3xl mb-3">{s.icon}</div>
                <h3 className="font-bold text-gray-900 mb-2">{s.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────── */}
      <section className="py-28 bg-amber-500 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, #ffffff 0%, transparent 50%), radial-gradient(circle at 70% 50%, #92400e 0%, transparent 50%)' }} />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          {/* Text is dark on the amber: white, amber-100 and amber-200 read at
              about 2:1. The two buttons keep their own colours. */}
          <p className="text-amber-950 text-sm font-bold tracking-widest uppercase mb-4">The feeling you're looking for</p>
          <h2 className="text-4xl sm:text-5xl font-extrabold text-amber-950 tracking-tight mb-5">
            <span aria-hidden="true">😊 </span>Ready to feel at home?
          </h2>
          <p className="text-amber-950 text-lg mb-3 max-w-xl mx-auto leading-relaxed">
            Not another endless group chat.<br />
            Not another networking event you forget tomorrow.
          </p>
          <p className="text-amber-950 text-xl font-bold mb-10">
            A place to actually belong.
          </p>
          {/* flex-col + default stretch matches the hero CTA pair's mobile
              stacking fix — this footer CTA had the same two-different-widths
              issue on narrow screens that the hero already fixed. */}
          <div className="flex flex-col sm:flex-row sm:justify-center gap-4">
            <Link href={`/apply${qs}`} className="btn-white">
              Apply to join
              <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
            <Link href={`/events${qs}`} className="btn-outline-white">Browse events first</Link>
          </div>
        </div>
      </section>

    </main>
  )
}
