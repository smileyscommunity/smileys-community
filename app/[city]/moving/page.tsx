import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { redactEventForGuest, projectEventsForMember } from '@/lib/db'
import { getPublicCity } from '@/lib/cities'
import { CITY_STATUS } from '@/lib/cityStatus'
import { APP_URL } from '@/lib/env'
import { shareCover } from '@/lib/shareCover'
import { reviewLabel } from '@/lib/handbook-review'
import { getNeighborhoodViews } from '@/lib/neighborhoodsDb'
import { LIFE_STAGES, articlesForStage, movingTopics, pickNeighborhoods, includesHighStakes } from '@/lib/relocation'
import EventCard from '@/components/EventCard'
import JoinCityButton from '@/components/JoinCityButton'
import PhotoHero, { HERO_SECONDARY } from '@/components/PhotoHero'
import { getCityMovingHub, isDefaultCitySlug } from '../data'

// /[city]/moving — "Moving to <city>": the relocation path for someone
// building a life here. Like the remote-work hub beside it, it writes no
// advice of its own. The timeline and topic shelf are the city's published
// Handbook articles arranged by lib/relocation (the same stage rules the
// Handbook's /handbook/stage pages use); neighbourhoods, events and clubs are
// the city's live data. Anything the city lacks is left out, not promised.
//
// Canonical to itself in every city — there is no global duplicate.

interface Params { params: Promise<{ city: string }> }

// Timeline columns shown before "Once you're settled". Urgent help is not a
// moment in a move, so it gets its own box instead.
const TIMELINE_STAGES = LIFE_STAGES.filter(s => s.timeline !== null)
const ARTICLES_PER_STAGE = 3

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city || city.status !== CITY_STATUS.Live) return {}
  const title = `Moving to ${city.name} — Smileys Community`
  const description = `Relocating to ${city.name}? Residence permits, housing and neighbourhoods, banking, healthcare and transport from the Smileys Handbook — and a real community to meet once you arrive.`
  const image = shareCover('events', city, title)
  const url = `${APP_URL}/${city.slug}/moving`
  return {
    title, description,
    alternates: { canonical: url },
    openGraph: { title, description, url, images: [image] },
    twitter: { card: image.twitterCard, title, description, images: [image.url] },
  }
}

export default async function CityMovingPage({ params }: Params) {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city) notFound()
  // A pre-launch city has no community or Handbook of its own yet.
  if (city.status !== CITY_STATUS.Live) redirect(`/${city.slug}`)

  const [hub, registry, session] = await Promise.all([
    getCityMovingHub(city.id, city.country ?? null, city.timezone),
    getNeighborhoodViews(city.id),
    getSession(),
  ])
  // Guest redaction per request, outside the shared cache (the hub rule).
  const events = session ? await projectEventsForMember(hub.events, session) : hub.events.map(redactEventForGuest)

  const cityQs = `?city=${city.slug}`
  const topics = movingTopics(hub.articles)
  const timeline = TIMELINE_STAGES
    .map(stage => ({ stage, articles: articlesForStage(stage, hub.articles, city.id) }))
  const urgent = articlesForStage(LIFE_STAGES.find(s => s.key === 'urgent')!, hub.articles, city.id)
  const neighborhoods = pickNeighborhoods(
    registry,
    new Map(hub.memberCounts.map(c => [c.neighborhood, c.count])),
    new Map(hub.eventCounts.map(c => [c.neighborhood, c.count])),
  )
  const showDisclaimer = includesHighStakes(hub.articles)
  // The city's own board and events live at /<city>/… except the default
  // city, whose canonical lists are the bare URLs (app/[city]/data.ts).
  const boardHref = isDefaultCitySlug(city.slug) ? '/board' : `/${city.slug}/board`
  const clubsHref = isDefaultCitySlug(city.slug) ? '/clubs' : `/${city.slug}/clubs`
  const eventsHref = `/${city.slug}/events`

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <PhotoHero kind="moving" city={city} alt={`Moving to ${city.name}`}>
        <Link href={`/${city.slug}`} className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-white/80 hover:text-white mb-6">
          <span aria-hidden="true">←</span> Smileys {city.name}
        </Link>
        <p className="text-xs font-bold tracking-[0.2em] uppercase text-amber-300 mb-4">Moving to {city.name}</p>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.1] mb-5">
          Make {city.name} <span className="text-amber-300">feel like home.</span>
        </h1>
        <p className="text-base sm:text-lg text-white/90 max-w-xl leading-relaxed mb-8">
          Smileys pairs practical local knowledge — the Handbook, written by members who went through
          it — with an in-person community, so you can sort out the paperwork, choose where to live,
          and build a real social life once you arrive.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <JoinCityButton slug={city.slug} name={city.name} />
          <Link href={`/handbook${cityQs}`} className={HERO_SECONDARY}>Read the Handbook</Link>
        </div>
      </PhotoHero>

      {/* ── Relocation timeline ──────────────────────────────────────── */}
      <section id="timeline" aria-labelledby="timeline-title" className="py-12 sm:py-16 bg-white border-t border-gray-100 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h2 id="timeline-title" className="section-title">Your move, step by step</h2>
            <p className="section-subtitle max-w-2xl">What to read, and when — from the Handbook guides {city.name} already has.</p>
          </div>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {timeline.map(({ stage, articles }, i) => (
              <li key={stage.key} className="bg-gray-50 border border-gray-100 rounded-2xl p-5 flex flex-col">
                <p className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-1">
                  <span aria-hidden="true">{i + 1} · </span>{stage.timeline}
                </p>
                <h3 className="font-bold text-gray-900 mb-2">{stage.label}</h3>
                <p className="text-sm text-gray-600 leading-relaxed mb-3">{stage.blurb}</p>
                {articles.length > 0 ? (
                  <>
                    <ul className="space-y-1.5 text-sm flex-1">
                      {articles.slice(0, ARTICLES_PER_STAGE).map(a => (
                        <li key={a.slug}>
                          <Link href={`/handbook/${a.slug}`} className="font-semibold text-gray-900 hover:text-amber-700">{a.title}</Link>
                        </li>
                      ))}
                    </ul>
                    <Link href={`/handbook/stage/${stage.key}${cityQs}`} className="mt-4 text-sm font-bold text-amber-700 hover:text-amber-800">
                      {articles.length > ARTICLES_PER_STAGE ? `All ${articles.length} guides` : 'Open this stage'} <span aria-hidden="true">→</span>
                    </Link>
                  </>
                ) : (
                  <p className="text-sm text-gray-500 flex-1">No {city.name} guide for this stage yet.</p>
                )}
              </li>
            ))}
            <li className="bg-amber-50 border border-amber-100 rounded-2xl p-5 flex flex-col">
              <p className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-1">
                <span aria-hidden="true">{timeline.length + 1} · </span>Once you&apos;re settled
              </p>
              <h3 className="font-bold text-gray-900 mb-2">Build your life here</h3>
              <p className="text-sm text-gray-600 leading-relaxed mb-3">Paperwork done — now the part that makes a city home: people.</p>
              <ul className="space-y-1.5 text-sm flex-1">
                <li><Link href="#build-your-life" className="font-semibold text-gray-900 hover:text-amber-700">Events, clubs and hosts</Link></li>
                <li><Link href={`/neighborhoods${cityQs}`} className="font-semibold text-gray-900 hover:text-amber-700">Your neighbourhood&apos;s people</Link></li>
                <li><Link href={boardHref} className="font-semibold text-gray-900 hover:text-amber-700">The community board</Link></li>
              </ul>
            </li>
          </ol>
          {urgent.length > 0 && (
            <aside aria-labelledby="urgent-title" className="mt-6 rounded-2xl border border-red-100 bg-red-50/60 p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
              <div className="flex-1">
                <h3 id="urgent-title" className="font-bold text-gray-900"><span aria-hidden="true">🆘 </span>Need help now?</h3>
                <p className="text-sm text-gray-700 mt-1">
                  {urgent.slice(0, 2).map((a, i) => (
                    <span key={a.slug}>
                      {i > 0 && ' · '}
                      <Link href={`/handbook/${a.slug}`} className="font-semibold text-red-800 hover:underline">{a.title}</Link>
                    </span>
                  ))}
                </p>
              </div>
              <Link href={`/handbook/stage/urgent${cityQs}`} className="shrink-0 text-sm font-bold text-red-800 hover:underline">
                All urgent-help guides <span aria-hidden="true">→</span>
              </Link>
            </aside>
          )}
        </div>
      </section>

      {/* ── Practical topics ─────────────────────────────────────────── */}
      {topics.length > 0 && (
        <section aria-labelledby="topics-title" className="py-12 sm:py-16 bg-gray-50 border-t border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-8">
              <h2 id="topics-title" className="section-title">The practical side</h2>
              <p className="section-subtitle max-w-2xl">
                Member-written guides from the {city.name} Handbook. Where a guide links official sources, those are the requirements; the rest is lived experience.
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {topics.map(t => {
                const lead = t.articles[0]
                const reviewed = reviewLabel(lead)
                return (
                  <Link key={t.category} href={`/handbook/category/${encodeURIComponent(t.category)}${cityQs}`}
                    className="group bg-white border border-gray-100 rounded-2xl shadow-sm p-5 hover:border-amber-200 hover:shadow-md transition-all">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h3 className="font-bold text-gray-900 group-hover:text-amber-700 transition-colors">{t.title}</h3>
                      <span className="shrink-0 text-xs font-semibold text-gray-500 tabular-nums">{t.articles.length} {t.articles.length === 1 ? 'guide' : 'guides'}</span>
                    </div>
                    <p className="text-sm text-gray-600 line-clamp-2">{lead.title}</p>
                    {(reviewed || lead.hasOfficialSources) && (
                      <p className="text-xs text-gray-500 mt-2">
                        {[reviewed && !reviewed.stale ? reviewed.text : null, lead.hasOfficialSources ? 'Links official sources' : null].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── Find your neighbourhood ──────────────────────────────────── */}
      {neighborhoods.length > 0 && (
        <section aria-labelledby="hoods-title" className="py-12 sm:py-16 bg-white border-t border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-8">
              <h2 id="hoods-title" className="section-title">Find your neighbourhood</h2>
              <p className="section-subtitle max-w-2xl">
                {hub.memberCounts.length > 0
                  ? `Where Smileys members in ${city.name} live, and where things are happening.`
                  : `Some of ${city.name}'s neighbourhoods to start with.`}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {neighborhoods.map(n => (
                <Link key={n.slug} href={`/neighborhoods/${n.slug}${cityQs}`}
                  className="group bg-gray-50 border border-gray-100 rounded-2xl p-5 hover:border-amber-200 hover:shadow-md transition-all">
                  <div className="flex items-center gap-2 mb-1">
                    <span aria-hidden="true" className="text-2xl">{n.emoji}</span>
                    <h3 className="font-bold text-gray-900 group-hover:text-amber-700 transition-colors">{n.name}</h3>
                  </div>
                  {n.vibe && <p className="text-sm text-gray-600 leading-relaxed line-clamp-2">{n.vibe}</p>}
                  {(n.members > 0 || n.events > 0) && (
                    <p className="text-xs font-semibold text-amber-700 mt-2">
                      {[
                        n.members > 0 ? `${n.members} Smileys member${n.members === 1 ? '' : 's'} live here` : null,
                        n.events > 0 ? `${n.events} upcoming event${n.events === 1 ? '' : 's'}` : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </Link>
              ))}
            </div>
            <Link href={`/neighborhoods${cityQs}`} className="inline-block mt-8 text-sm font-bold text-amber-700 hover:text-amber-800">
              Explore all {city.name} neighbourhoods <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>
      )}

      {/* ── Build your life here ─────────────────────────────────────── */}
      <section id="build-your-life" aria-labelledby="build-title" className="py-12 sm:py-16 bg-gray-50 border-t border-gray-100 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h2 id="build-title" className="section-title">Build your life here</h2>
            <p className="section-subtitle max-w-2xl">
              {events.length > 0
                ? 'Start with an event marked first-timer friendly — picked by the team as an easy one to come to on your own.'
                : `Events, clubs and hosts in ${city.name}.`}
            </p>
          </div>

          {/* For guests only, and only as true as the cards below: members-only
              is a per-event flag, so the note says "these" when every card
              carries it and points at the badge when only some do. Said up
              front because a newcomer planning a move needs the 24–48h review
              in the plan, not at the RSVP button. */}
          {!session && events.some(e => e.membersOnly) && (
            <p className="mb-6 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span aria-hidden="true">🔒 </span>
              {events.every(e => e.membersOnly)
                ? 'These events are for Smileys members.'
                : 'Events marked “Members only” are for Smileys members.'}{' '}
              Joining is free, and applications are reviewed within 24–48 hours.
            </p>
          )}

          {events.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
              {events.map(e => <EventCard key={e.id} event={e} timeZone={city.timezone} />)}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Link href={eventsHref} className="group bg-white border border-gray-100 rounded-2xl p-5 hover:border-amber-200 hover:shadow-md transition-all">
              <div aria-hidden="true" className="text-2xl mb-2">📅</div>
              <h3 className="font-bold text-gray-900 group-hover:text-amber-700">Upcoming events</h3>
              <p className="text-sm text-gray-600 mt-1">
                {hub.upcomingEventCount > 0 ? `${hub.upcomingEventCount} on the calendar in ${city.name}.` : `The ${city.name} calendar.`}
              </p>
            </Link>
            <Link href={clubsHref} className="group bg-white border border-gray-100 rounded-2xl p-5 hover:border-amber-200 hover:shadow-md transition-all">
              <div aria-hidden="true" className="text-2xl mb-2">🎭</div>
              <h3 className="font-bold text-gray-900 group-hover:text-amber-700">Clubs</h3>
              <p className="text-sm text-gray-600 mt-1">
                {hub.clubCount > 0 ? `${hub.clubCount} active club${hub.clubCount === 1 ? '' : 's'} — hiking, language, food, film and more.` : 'Interest groups that meet regularly.'}
              </p>
            </Link>
            <Link href="/hosts" className="group bg-white border border-gray-100 rounded-2xl p-5 hover:border-amber-200 hover:shadow-md transition-all">
              <div aria-hidden="true" className="text-2xl mb-2">🙋</div>
              <h3 className="font-bold text-gray-900 group-hover:text-amber-700">Meet the hosts</h3>
              <p className="text-sm text-gray-600 mt-1">The members who run events and clubs.</p>
            </Link>
            {session ? (
              <Link href="/hangouts" className="group bg-white border border-gray-100 rounded-2xl p-5 hover:border-amber-200 hover:shadow-md transition-all">
                <div aria-hidden="true" className="text-2xl mb-2">☕</div>
                <h3 className="font-bold text-gray-900 group-hover:text-amber-700">Hangouts</h3>
                <p className="text-sm text-gray-600 mt-1">Small, spontaneous plans from members nearby.</p>
              </Link>
            ) : (
              <Link href="/guidelines" className="group bg-white border border-gray-100 rounded-2xl p-5 hover:border-amber-200 hover:shadow-md transition-all">
                <div aria-hidden="true" className="text-2xl mb-2">🤝</div>
                <h3 className="font-bold text-gray-900 group-hover:text-amber-700">Community guidelines</h3>
                <p className="text-sm text-gray-600 mt-1">How members look after each other — worth reading before your first event.</p>
              </Link>
            )}
          </div>

          {/* Asking for recommendations. The board is where members already
              answer each other; this only points at it, and says plainly that
              an answer is one member's experience, not Smileys vouching for
              a doctor, a lawyer or a landlord. */}
          <div className="mt-10 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
            <h3 className="font-bold text-gray-900">Ask people who&apos;ve done it</h3>
            <p className="text-sm text-gray-600 mt-1 leading-relaxed">
              Flatmates, an English-speaking doctor, schools, a lawyer or accountant, a vet, a reliable
              handyman — members ask each other on the {city.name} community board.
            </p>
            <p className="text-xs text-gray-500 mt-2">Answers are members&apos; own experiences, not recommendations or endorsements by Smileys.</p>
            {/* Reading is public (the board hub); posting is members-only
                (app/(member)/board/new, and the API refuses a guest). */}
            {!session && (
              <p className="text-xs text-gray-500 mt-1">Anyone can read the board; posting a question needs a Smileys account.</p>
            )}
            <Link href={boardHref} className="inline-block mt-4 text-sm font-bold text-amber-700 hover:text-amber-800">
              Open the community board <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Disclaimer ───────────────────────────────────────────────── */}
      {showDisclaimer && (
        <section className="bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            <aside aria-labelledby="moving-disclaimer" className="max-w-3xl rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4">
              <h2 id="moving-disclaimer" className="text-sm font-bold text-gray-900 mb-1">Practical guidance, not professional advice</h2>
              <p className="text-sm text-gray-600 leading-relaxed">
                The Handbook shares members&apos; practical experience. It is not legal, immigration, tax or
                medical advice, and rules, fees and requirements change. Where a guide links official
                sources, confirm the current requirements there — or with a qualified adviser — before you act.
              </p>
            </aside>
          </div>
        </section>
      )}

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section className="py-14 sm:py-20 bg-gradient-to-b from-white to-amber-50 border-t border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-gray-900 mb-4">
            Arrive knowing people.
          </h2>
          <p className="text-lg text-gray-600 mb-8">
            Joining is free. You only pay for events you choose, and the price is shown before you RSVP.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
            <JoinCityButton slug={city.slug} name={city.name} />
            <Link href={`/handbook${cityQs}`} className="btn-secondary text-base px-6 py-4">Read the Handbook</Link>
            <Link href={`/neighborhoods${cityQs}`} className="btn-secondary text-base px-6 py-4">Explore neighbourhoods</Link>
            <Link href={eventsHref} className="btn-secondary text-base px-6 py-4">See upcoming events</Link>
          </div>
        </div>
      </section>
    </>
  )
}
