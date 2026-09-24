import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { redactEventForGuest, projectEventsForMember } from '@/lib/db'
import { getPublicCity, DEFAULT_CITY_SLUG } from '@/lib/cities'
import { CITY_STATUS } from '@/lib/cityStatus'
import { APP_URL } from '@/lib/env'
import { shareCover } from '@/lib/shareCover'
import { audiencesFor, matchesAudience } from '@/lib/guide'
import { loadExperiences } from '@/lib/guideContent'
import { studentGuides, orderStudentAudiences, buildFirstWeek, eventsHref } from '@/lib/students'
import EventCard from '@/components/EventCard'
import JoinCityButton from '@/components/JoinCityButton'
import PhotoHero, { HERO_SECONDARY } from '@/components/PhotoHero'
import { getCityStudentHub } from '../data'

// /[city]/students — for Erasmus, exchange and international students here
// for a semester or a year. Like the remote-work and moving hubs it writes no
// content of its own: the first week, the semester and the practical side
// are all links to pages the city already has (Handbook, Guide, events,
// clubs), each section hides or says so when the city has nothing to put in
// it, and the rules for that live in lib/students so they are tested.
//
// It sits beside university orientation and student networks, not against
// them — and says so. Nothing here claims a student discount, a university
// partnership or an eligibility rule; none exists.

interface Params { params: Promise<{ city: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city || city.status !== CITY_STATUS.Live) return {}
  const title = `International students in ${city.name} — Erasmus, exchange & degree students | Smileys Community`
  const description = `Here for a semester or a year? Your first week in ${city.name}, the practical setup, first-timer-friendly events, regular activities and people beyond your campus.`
  const image = shareCover('events', city, title)
  const url = `${APP_URL}/${city.slug}/students`
  return {
    title, description,
    alternates: { canonical: url },
    openGraph: { title, description, url, images: [image] },
    twitter: { card: image.twitterCard, title, description, images: [image.url] },
  }
}

export default async function CityStudentsPage({ params }: Params) {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city) notFound()
  // A pre-launch city has no events or members to meet yet; its page says so.
  if (city.status !== CITY_STATUS.Live) redirect(`/${city.slug}`)

  const [hub, experiences, session] = await Promise.all([
    getCityStudentHub(city.id, city.slug, city.country ?? null),
    loadExperiences(city.id),
    getSession(),
  ])
  // Guest redaction is per request, outside the shared cache (../events/page.tsx).
  const project = async (events: typeof hub.firstEvents) =>
    session ? projectEventsForMember(events, session) : events.map(redactEventForGuest)
  const [firstEvents, regularEvents] = await Promise.all([project(hub.firstEvents), project(hub.regularEvents)])

  const guides    = studentGuides(hub.articles, city.id)
  const guide     = (key: string) => guides.find(g => g.key === key)?.article ?? null
  const audiences = orderStudentAudiences(
    audiencesFor(city.slug).map(a => ({ ...a, count: experiences.filter(e => matchesAudience(e, a)).length })),
  )
  const firstWeek = buildFirstWeek({
    citySlug:         city.slug,
    cityName:         city.name,
    guides,
    audiences,
    hasFirstEvents:   firstEvents.length > 0,
    hasRegular:       regularEvents.length > 0,
    hasNeighborhoods: hub.neighborhoodCount > 0,
    hasClubs:         hub.clubCount > 0,
  })
  const isDefault   = city.slug === DEFAULT_CITY_SLUG
  const guideQs     = (value: string) => `/guide?for=${value}${isDefault ? '' : `&city=${city.slug}`}`
  const budget      = audiences.find(a => a.value === 'budget')
  const firstFilter = hub.filterLinks.find(l => l.key === 'first')
  const entry       = guide('entry')
  const residence   = guide('residence')
  const airport     = guide('airport')

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <PhotoHero kind="students" city={city} alt={`International students in ${city.name}`}>
        <Link href={`/${city.slug}`} className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-white/80 hover:text-white mb-6">
          <span aria-hidden="true">←</span> Smileys {city.name}
        </Link>
        <p className="text-xs font-bold tracking-[0.2em] uppercase text-amber-300 mb-4">International &amp; Erasmus students in {city.name}</p>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.1] mb-5">
          You&apos;re here. <span className="text-amber-300">Now make it count.</span>
        </h1>
        <p className="text-base sm:text-lg text-white/90 max-w-xl leading-relaxed mb-8">
          Smileys helps international students experience {city.name}, meet people outside their campus and build a
          social life early — alongside members from all over the world and locals.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <JoinCityButton slug={city.slug} name={city.name} from="students" />
          <Link href={firstEvents.length > 0 ? '#first-event' : eventsHref(city.slug)} className={HERO_SECONDARY}>
            {firstEvents.length > 0 ? 'See first-timer events' : 'See upcoming events'}
          </Link>
        </div>
        <p className="mt-6 text-sm text-white/75 max-w-xl">
          Not instead of your university&apos;s orientation or student network — alongside it, for the people and plans
          beyond campus.
        </p>
      </PhotoHero>

      {/* ── Your first week ──────────────────────────────────────────── */}
      <section id="first-week" aria-labelledby="first-week-title" className="py-12 sm:py-16 bg-white border-t border-gray-100 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h2 id="first-week-title" className="section-title">Your first week in {city.name}</h2>
            <p className="section-subtitle max-w-2xl">Five steps, roughly in this order — save this page before you fly.</p>
          </div>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {firstWeek.map((step, i) => (
              <li key={step.key} className="bg-gray-50 border border-gray-100 rounded-2xl p-5 flex flex-col">
                <span aria-hidden="true" className="w-8 h-8 rounded-full bg-amber-500 text-white text-sm font-extrabold flex items-center justify-center mb-3">{i + 1}</span>
                <h3 className="font-bold text-gray-900 mb-1.5">{step.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed flex-1">{step.body}</p>
                {step.links.map(l => (
                  <Link key={l.href} href={l.href} className="mt-2 text-sm font-bold text-amber-700 hover:text-amber-800">
                    {l.label} <span aria-hidden="true">→</span>
                  </Link>
                ))}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Your semester ────────────────────────────────────────────── */}
      <section aria-labelledby="semester-title" className="py-12 sm:py-16 bg-gray-50 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h2 id="semester-title" className="section-title">Your semester, stage by stage</h2>
            <p className="section-subtitle max-w-2xl">A semester goes faster than it looks from week one. What to do when.</p>
          </div>
          <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                key: 'before', emoji: '🧳', title: 'Before arrival',
                body: 'Check how long you can stay, and ask your university’s international office what your programme needs for a residence permit. Applying to Smileys now means you’re in before you land — reviews take 24–48 hours.',
                links: [
                  ...(entry ? [{ href: `/handbook/${entry.slug}`, label: 'Entry rules and stay limits' }] : []),
                  ...(residence ? [{ href: `/handbook/${residence.slug}`, label: 'How residence permits work' }] : []),
                  ...(hub.story ? [{ href: `/posts/${hub.story.slug}`, label: 'Read: Erasmus in ' + city.name }] : []),
                ],
              },
              {
                key: 'welcome', emoji: '👋', title: 'Welcome week',
                body: 'Get in from the airport, get a SIM and a transport card, and go to one event on your own.',
                links: [
                  ...(airport ? [{ href: `/handbook/${airport.slug}`, label: 'From the airport' }] : []),
                  { href: '#first-week', label: 'Your first week, step by step' },
                ],
              },
              {
                key: 'month', emoji: '📅', title: 'First month',
                body: 'Go back to something you liked the first time. Join a club or a weekly activity — the faces you see every week become your friends.',
                links: [
                  ...(regularEvents.length > 0 ? [{ href: '#regular', label: 'Regular activities' }] : []),
                  ...(hub.clubCount > 0 ? [{ href: `/${city.slug}/clubs`, label: `${city.name} clubs` }] : []),
                ],
              },
              {
                key: 'most', emoji: '🌊', title: 'Make the most of it',
                body: `Try the parts of ${city.name} that aren’t on the first-week list, and bring a classmate to something new.`,
                links: audiences
                  .filter(a => a.value === 'slow' || a.value === 'curious')
                  .map(a => ({ href: guideQs(a.value), label: a.label })),
              },
            ].map(s => (
              <li key={s.key} className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 flex flex-col">
                <div aria-hidden="true" className="text-2xl mb-2">{s.emoji}</div>
                <h3 className="font-bold text-gray-900 mb-1.5">{s.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed flex-1">{s.body}</p>
                {s.links.map(l => (
                  <Link key={l.href} href={l.href} className="mt-2 text-sm font-bold text-amber-700 hover:text-amber-800">
                    {l.label} <span aria-hidden="true">→</span>
                  </Link>
                ))}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Your first event ─────────────────────────────────────────── */}
      <section id="first-event" aria-labelledby="first-event-title" className="py-12 sm:py-16 bg-white border-t border-gray-100 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-6">
            <h2 id="first-event-title" className="section-title">Your first event</h2>
            <p className="section-subtitle max-w-2xl">
              {firstEvents.length > 0
                ? 'Events the team picked as an easy first one to come to on your own. Each card shows the price, where it is and who’s going.'
                : `Nothing is marked first-timer friendly right now — here is everything on in ${city.name}.`}
            </p>
          </div>

          {/* The calendar's own filters, offered only when something matches
              (lib/students eventFilterLinks) — with how many. */}
          {hub.filterLinks.length > 0 && (
            <ul className="flex flex-wrap gap-2 mb-8" aria-label="Browse upcoming events by">
              {hub.filterLinks.map(l => (
                <li key={l.key}>
                  <Link href={l.href}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:border-amber-300 hover:text-amber-700 transition-colors">
                    <span aria-hidden="true">{l.emoji}</span>{l.label}
                    <span className="text-xs font-normal text-gray-500">{l.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {firstEvents.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {firstEvents.map(e => <EventCard key={e.id} event={e} timeZone={city.timezone} />)}
            </div>
          ) : (
            <Link href={eventsHref(city.slug)} className="text-sm font-bold text-amber-700 hover:text-amber-800">
              See every upcoming event in {city.name} <span aria-hidden="true">→</span>
            </Link>
          )}
          {firstEvents.length > 0 && (
            <Link href={firstFilter ? firstFilter.href : eventsHref(city.slug)} className="inline-block mt-6 text-sm font-bold text-amber-700 hover:text-amber-800">
              {firstFilter && firstFilter.count > firstEvents.length ? `All ${firstFilter.count} first-timer friendly events` : `Everything on in ${city.name}`} <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>
      </section>

      {/* ── Regular activities ───────────────────────────────────────── */}
      {regularEvents.length > 0 && (
        <section id="regular" aria-labelledby="regular-title" className="py-12 sm:py-16 bg-gray-50 border-t border-gray-100 scroll-mt-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-8">
              <h2 id="regular-title" className="section-title">Something every week</h2>
              <p className="section-subtitle max-w-2xl">Regular activities members run — showing each one&apos;s next date. Going back is how you get to know people.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {regularEvents.map(e => <EventCard key={e.id} event={e} timeZone={city.timezone} />)}
            </div>
            {hub.clubCount > 0 && (
              <Link href={`/${city.slug}/clubs`} className="inline-block mt-6 text-sm font-bold text-amber-700 hover:text-amber-800">
                Browse all {hub.clubCount} {city.name} clubs <span aria-hidden="true">→</span>
              </Link>
            )}
          </div>
        </section>
      )}

      {/* ── Explore the city ─────────────────────────────────────────── */}
      {audiences.length > 0 && (
        <section id="explore" aria-labelledby="explore-title" className="py-12 sm:py-16 bg-white border-t border-gray-100 scroll-mt-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-6">
              <h2 id="explore-title" className="section-title">Explore {city.name}{budget ? ' on a budget' : ''}</h2>
              <p className="section-subtitle max-w-2xl">Experiences from the {city.name} Guide, by what you&apos;re in the mood for.</p>
            </div>
            <ul className="flex flex-wrap gap-2">
              {audiences.map(a => (
                <li key={a.value}>
                  <Link href={guideQs(a.value)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:border-amber-300 hover:text-amber-700 transition-colors">
                    <span aria-hidden="true">{a.emoji}</span>{a.label}
                    <span className="text-xs font-normal text-gray-500">{a.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-6 text-sm font-bold">
              {budget && (
                <Link href={guideQs('budget')} className="text-amber-700 hover:text-amber-800">
                  Explore {city.name} on a budget <span aria-hidden="true">→</span>
                </Link>
              )}
              {hub.neighborhoodCount > 0 && (
                <Link href={`/neighborhoods${isDefault ? '' : `?city=${city.slug}`}`} className="text-amber-700 hover:text-amber-800">
                  Find your neighbourhood <span aria-hidden="true">→</span>
                </Link>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── The practical side ───────────────────────────────────────── */}
      {guides.length > 0 && (
        <section aria-labelledby="practical-title" className="py-12 sm:py-16 bg-gray-50 border-t border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-8">
              <h2 id="practical-title" className="section-title">The practical side</h2>
              <p className="section-subtitle max-w-2xl">From the {city.name} Handbook.</p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {guides.map(g => (
                <li key={g.key}>
                  <Link href={`/handbook/${g.article.slug}`}
                    className="block h-full bg-white border border-gray-100 rounded-2xl p-4 hover:border-amber-200 hover:shadow-md transition-all group">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-500">{g.label}</p>
                    <p className="font-semibold text-gray-900 group-hover:text-amber-700 transition-colors leading-snug mt-1">{g.article.title}</p>
                    {g.article.hasOfficialSources && <p className="text-xs text-gray-500 mt-1">Links official sources</p>}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-6 max-w-3xl text-sm text-gray-600 leading-relaxed">
              Practical guidance, not legal advice. Residence permits and other paperwork depend on your nationality and
              your programme, and the rules change — your university&apos;s international office and the official sources
              each guide links to are where to confirm your own case.
            </p>
          </div>
        </section>
      )}

      {/* ── Before you join ──────────────────────────────────────────── */}
      <section aria-labelledby="join-title" className="py-12 sm:py-16 bg-white border-t border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 id="join-title" className="section-title">Before you join</h2>
          <ul className="mt-6 space-y-3 text-sm text-gray-700 leading-relaxed">
            <li><span aria-hidden="true">🎓 </span>International students — Erasmus, exchange or a full degree — are welcome. You apply like anyone else, with no university details asked.</li>
            <li><span aria-hidden="true">👀 </span><strong>Anyone can browse</strong> this page, the events calendar, the Guide and the Handbook. <strong>Members</strong> can RSVP, join clubs and meet other members; some events are for members only, and their cards say so.</li>
            <li><span aria-hidden="true">🆓 </span>Joining is free. You only pay for events you choose, and the price is on every event before you RSVP.</li>
            <li><span aria-hidden="true">✍️ </span>A person reads every application, within 24–48 hours — it keeps events safe to walk into on your own. The form explains why it asks for each detail, and your phone number is never shown publicly. <Link href="/privacy" className="font-semibold text-amber-700 hover:underline">Privacy policy</Link>.</li>
          </ul>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section className="py-14 sm:py-20 bg-gradient-to-b from-white to-amber-50 border-t border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-gray-900 mb-4">
            Meet people beyond campus.
          </h2>
          <p className="text-lg text-gray-600 mb-8">
            Make your semester in {city.name} more than lectures.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <JoinCityButton slug={city.slug} name={city.name} from="students" />
            {budget
              ? <Link href={guideQs('budget')} className="btn-secondary text-base px-8 py-4">Explore {city.name} on a budget</Link>
              : <Link href={eventsHref(city.slug)} className="btn-secondary text-base px-8 py-4">See upcoming events</Link>}
          </div>
        </div>
      </section>
    </>
  )
}
