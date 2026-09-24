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
import { groupHubArticles, buildChecklist, utcOffsetLabel } from '@/lib/remoteWork'
import EventCard from '@/components/EventCard'
import JoinCityButton from '@/components/JoinCityButton'
import { clubHref } from '@/lib/clubLink'
import { pickArticle, REMOTE_WORK_LEGAL, ENTRY_RULES } from '@/lib/relocation'
import PhotoHero, { HERO_SECONDARY } from '@/components/PhotoHero'
import { getCityRemoteWorkHub } from '../data'

// /[city]/remote-work — the arrival path for someone who works remotely:
// where to work, where to live, the practical setup, and who to spend time
// with. It writes no content of its own. Every link lands on a page the city
// already has (a Handbook article, a club, an event), every section hides
// when the city has nothing to put in it, and the rules for both live in
// lib/remoteWork so they are tested rather than eyeballed.
//
// Canonical to itself in every city: unlike /events and /clubs there is no
// global page this could be a duplicate of.

interface Params { params: Promise<{ city: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city || city.status !== CITY_STATUS.Live) return {}
  const title = `Remote work in ${city.name} — Smileys Community`
  const description = `Working remotely from ${city.name}? Your first 72 hours: getting connected, choosing a neighbourhood, coworking sessions, money and transport — and people to spend time with.`
  const image = shareCover('events', city, title)
  const url = `${APP_URL}/${city.slug}/remote-work`
  return {
    title, description,
    alternates: { canonical: url },
    openGraph: { title, description, url, images: [image] },
    twitter: { card: image.twitterCard, title, description, images: [image.url] },
  }
}

export default async function CityRemoteWorkPage({ params }: Params) {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city) notFound()
  // A pre-launch city has no community to meet yet; its own page says so.
  if (city.status !== CITY_STATUS.Live) redirect(`/${city.slug}`)

  const hub = await getCityRemoteWorkHub(city.id, city.country ?? null)
  // Guest redaction is per-request, outside the shared cache — the rule every
  // city hub follows (see ../events/page.tsx).
  const session = await getSession()
  const events  = session ? await projectEventsForMember(hub.events, session) : hub.events.map(redactEventForGuest)

  const topics    = groupHubArticles(hub.articles, city.id)
  const checklist = buildChecklist({
    citySlug:         city.slug,
    topics,
    hasNeighborhoods: hub.neighborhoodCount > 0,
    hasWorkClubs:     hub.workClubs.length > 0,
    hasWorkEvents:    hub.hasWorkEvents,
    workMembersOnly:  hub.workMembersOnly,
    hasEvents:        events.length > 0,
  })
  const offset = utcOffsetLabel(city.timezone)
  // The legal note may only point at official sources if the guides it is
  // talking about actually cite some.
  const legalCitesSources = topics
    .filter(t => t.key === 'legal' || t.key === 'money')
    .some(t => t.articles.some(a => a.hasOfficialSources))
  const hasWorkAndMeet = hub.workClubs.length > 0 || events.length > 0
  // The guides that answer the legal question this page raises — linked
  // from its legal note, found by topic rather than slug (lib/relocation).
  const workLegalGuide = pickArticle(hub.articles, 'Residence & Legal', REMOTE_WORK_LEGAL, city.id)
  const entryGuide     = pickArticle(hub.articles, 'Residence & Legal', ENTRY_RULES, city.id)

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <PhotoHero kind="remote-work" city={city} alt={`Someone working on a laptop at a terrace café in ${city.name}, the water and the city behind`}>
        <Link href={`/${city.slug}`} className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-white/80 hover:text-white mb-6">
          <span aria-hidden="true">←</span> Smileys {city.name}
        </Link>
        <p className="text-xs font-bold tracking-[0.2em] uppercase text-amber-300 mb-4">Remote work in {city.name}</p>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.1] mb-5">
          Work remotely. <span className="text-amber-300">Belong locally.</span>
        </h1>
        <p className="text-base sm:text-lg text-white/90 max-w-xl leading-relaxed mb-6">
          {/* Names only what the city has: "coworking sessions" only while
              members are actually running them. */}
          Smileys brings practical arrival help{hub.hasWorkEvents ? ', member-run coworking sessions' : ''} and
          an offline community together — so within a few days you know where to work, where to live, what
          to set up, and who to spend time with.
        </p>
        <p className="text-sm text-white/80 mb-8">
          <span aria-hidden="true">🕒 </span>
          Local time in {city.name} is <span className="font-semibold text-white">{offset}</span>
          <span className="text-white/70"> ({city.timezone})</span>
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <JoinCityButton slug={city.slug} name={city.name} />
          <Link href={events.length > 0 ? '#work-and-meet' : `/${city.slug}/events`} className={HERO_SECONDARY}>
            See upcoming events
          </Link>
        </div>
      </PhotoHero>

      {/* ── Your first 72 hours ──────────────────────────────────────── */}
      <section id="first-72-hours" className="py-12 sm:py-16 bg-white border-t border-gray-100 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h2 className="section-title">Your first 72 hours</h2>
            <p className="section-subtitle max-w-2xl">Five things to sort out, in roughly this order. Each links to the page that answers it.</p>
          </div>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {checklist.map((step, i) => (
              <li key={step.key} className="bg-gray-50 border border-gray-100 rounded-2xl p-5 flex flex-col">
                <span aria-hidden="true" className="w-8 h-8 rounded-full bg-amber-500 text-white text-sm font-extrabold flex items-center justify-center mb-3">{i + 1}</span>
                <h3 className="font-bold text-gray-900 mb-1.5">{step.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed flex-1">{step.body}</p>
                {step.href && (
                  <Link href={step.href} className="mt-4 text-sm font-bold text-amber-700 hover:text-amber-800">
                    {step.cta} <span aria-hidden="true">→</span>
                  </Link>
                )}
                {step.more?.map(m => (
                  <Link key={m.href} href={m.href} className="mt-1.5 text-sm font-semibold text-amber-700 hover:text-amber-800">
                    {m.cta} <span aria-hidden="true">→</span>
                  </Link>
                ))}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Practical guides ─────────────────────────────────────────── */}
      {topics.length > 0 && (
        <section className="py-12 sm:py-16 bg-gray-50 border-t border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-8">
              <h2 className="section-title">The practical side</h2>
              <p className="section-subtitle max-w-2xl">From the Smileys Handbook.</p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {topics.map(topic => (
                <div key={topic.key} className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">{topic.title}</h3>
                  <ul className="space-y-3">
                    {topic.articles.map(a => {
                      // Only a review somebody actually did earns a date
                      // (lib/handbook-review) — unreviewed shows none.
                      const reviewed = reviewLabel(a)
                      return (
                        <li key={a.slug}>
                          <Link href={`/handbook/${a.slug}`} className="font-semibold text-gray-900 hover:text-amber-700 leading-snug">
                            {a.title}
                          </Link>
                          {(reviewed || a.hasOfficialSources) && (
                            <p className="text-xs text-gray-500 mt-0.5">
                              {[reviewed && !reviewed.stale ? reviewed.text : null, a.hasOfficialSources ? 'Links official sources' : null]
                                .filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
            <Link href={`/handbook?city=${city.slug}`} className="inline-block mt-8 text-sm font-bold text-amber-700 hover:text-amber-800">
              Browse the whole {city.name} handbook <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>
      )}

      {/* ── Work and meet people ─────────────────────────────────────── */}
      <section id="work-and-meet" className="py-12 sm:py-16 bg-white border-t border-gray-100 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h2 className="section-title">Work and meet people</h2>
            <p className="section-subtitle max-w-2xl">
              {hasWorkAndMeet
                ? 'Coworking sessions, remote-work clubs, and events marked first-timer friendly.'
                : `Coworking sessions and newcomer events in ${city.name} start with the first members who run them.`}
            </p>
          </div>

          {/* Said once, before the cards: every coworking session on the
              calendar is members-only, and a week-long visitor needs to know
              that before the 24–48h review, not at the RSVP button. */}
          {hub.workMembersOnly && (
            <p className="mb-6 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span aria-hidden="true">🔒 </span>
              Coworking sessions are for Smileys members. Joining is free, and applications are reviewed
              within 24–48 hours — so if you&apos;re only here for a week, apply before you arrive.
            </p>
          )}

          {hub.workClubs.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-10">
              {hub.workClubs.map(c => (
                // Club pages are members-only; guests go to this city's
                // application instead (lib/clubLink).
                <Link key={c.id} href={clubHref(c.slug, session ? 'member' : 'guest', city.slug)}
                  className="group bg-gray-50 border border-gray-100 rounded-2xl p-5 hover:border-amber-200 hover:shadow-md transition-all">
                  <div aria-hidden="true" className="text-2xl mb-2">{c.emoji}</div>
                  <h3 className="font-bold text-gray-900 group-hover:text-amber-700 transition-colors">{c.name}</h3>
                  {/* Members OF THIS CLUB in this city — never the Smileys
                      total or a WhatsApp figure (lib/communityStats). */}
                  {c.memberCount > 0 && (
                    <p className="text-xs font-semibold text-amber-700 mt-0.5">{c.memberCount} club member{c.memberCount === 1 ? '' : 's'}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-2">
                    {c.nextEvent ? `Next: ${c.nextEvent.title}` : 'No sessions scheduled yet'}
                  </p>
                  {!session && <p className="text-xs font-semibold text-amber-700 mt-2">Join Smileys to join this club →</p>}
                </Link>
              ))}
            </div>
          )}

          {events.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6" aria-describedby="recurring-note">
              {events.map(e => <EventCard key={e.id} event={e} timeZone={city.timezone} />)}
            </div>
          ) : (
            <p className="text-gray-600">
              Nothing coworking or newcomer-specific is scheduled right now.{' '}
              <Link href={`/${city.slug}/events`} className="font-semibold text-amber-700 hover:underline">See everything on in {city.name}</Link>.
            </p>
          )}
          {events.length > 0 && (
            <p id="recurring-note" className="mt-4 text-xs text-gray-500">Weekly sessions show their next date.</p>
          )}
          {events.length > 0 && (
            <Link href={`/${city.slug}/events`} className="inline-block mt-6 text-sm font-bold text-amber-700 hover:text-amber-800">
              See every upcoming event in {city.name} <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>
      </section>

      {/* ── Not legal or tax advice ──────────────────────────────────── */}
      <section className="bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <aside aria-labelledby="legal-note" className="max-w-3xl rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4">
            <h2 id="legal-note" className="text-sm font-bold text-gray-900 mb-1">Practical guidance, not legal or tax advice</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              The guides here are practical guidance. Visa, residence and tax rules depend on your
              nationality and circumstances, and they change.{' '}
              {legalCitesSources
                ? 'Check the official sources each guide links to, and a qualified adviser for your own situation, before you rely on them.'
                : 'Check with the relevant authority, and a qualified adviser for your own situation, before you rely on them.'}
            </p>
            {(workLegalGuide || entryGuide) && (
              <ul className="mt-3 space-y-1 text-sm">
                {workLegalGuide && (
                  <li>
                    <Link href={`/handbook/${workLegalGuide.slug}`} className="font-semibold text-amber-700 hover:text-amber-800">
                      Can I work remotely here? {workLegalGuide.title} <span aria-hidden="true">→</span>
                    </Link>
                  </li>
                )}
                {entryGuide && (
                  <li>
                    <Link href={`/handbook/${entryGuide.slug}`} className="font-semibold text-amber-700 hover:text-amber-800">
                      How long can I stay? {entryGuide.title} <span aria-hidden="true">→</span>
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </aside>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section className="py-14 sm:py-20 bg-gradient-to-b from-white to-amber-50 border-t border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-gray-900 mb-4">
            Land with people, not just a laptop.
          </h2>
          <p className="text-lg text-gray-600 mb-8">
            Joining is free. You only pay for events you choose, and the price is shown before you RSVP.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <JoinCityButton slug={city.slug} name={city.name} />
            <Link href={`/${city.slug}/events`} className="btn-secondary text-base px-8 py-4">See upcoming events</Link>
          </div>
        </div>
      </section>
    </>
  )
}
