import Link from 'next/link'
import Image from 'next/image'
import { APP_URL } from '@/lib/env'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import { NEIGHBORHOOD_META, neighborhoodToSlug } from '@/lib/neighborhoods'
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
const getAnnouncements = unstable_cache(
  async (today: string, forMembers: boolean) => prisma.visitorAnnouncement.findMany({
    where: {
      status: 'active',
      endsOn: { gte: today },
      ...(forMembers ? {} : { visibility: 'public' }),
    },
    orderBy: { startsOn: 'asc' },
    take:    100,
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, interests: true } } },
  }),
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
// Uses the real hero photo (visiting-hero.jpg) instead of the generated
// title-card now that one exists. It's a static public/ asset, not an
// uploaded file, so it doesn't go through the /api/files resize route —
// pre-resized+compressed once to visiting-hero-og.jpg (1200x800, ~250KB)
// instead, since the 456KB original is over WhatsApp's ~300KB silent-drop
// threshold for og:image.
const ogImage = `${APP_URL}/images/visiting-hero-og.jpg`

export const metadata: Metadata = {
  alternates: { canonical: `${APP_URL}/visiting` },
  title: 'Visiting Istanbul? Meet locals — Smileys Community',
  description: 'Tell Smileys members you\'re coming to Istanbul. Locals will reach out to grab coffee, share neighborhood tips, and welcome you in.',
  openGraph: {
    title: 'Visiting Istanbul? Meet locals — Smileys Community',
    description: 'Post your trip dates, see who else is in town, and connect with locals before you arrive.',
    url: `${APP_URL}/visiting`,
    images: [{ url: ogImage, width: 1200, height: 800, alt: 'Visiting Istanbul? — Smileys Community' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Visiting Istanbul? Meet locals — Smileys Community',
    description: 'Post your trip dates, see who else is in town, and connect with locals before you arrive.',
    images: [ogImage],
  },
}

export default async function VisitingPage() {
  const today         = new Date().toISOString().split('T')[0]
  const sixtyDaysOut  = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  // Session resolves first because the announcement query's visibility
  // filter depends on it; the rest still run in parallel.
  const session = await getSession()

  const [announcements, upcomingEvents, featuredLocals, neighborhoodCounts] = await Promise.all([
    getAnnouncements(today, !!session),
    prisma.event.findMany({
      where:   { status: 'published', date: { gte: today, lte: sixtyDaysOut } },
      select:  {
        id: true, title: true, emoji: true, date: true, location: true, neighborhood: true,
        // Attendee count is filtered to approved RSVPs so the "N going"
        // figure matches what the event page itself shows.
        _count: { select: { attendees: { where: { status: 'approved' } } } },
      },
      orderBy: { date: 'asc' },
      take:    60,
    }),
    prisma.user.findMany({
      where:   { status: 'approved' },
      select:  { id: true, name: true, color: true, profilePhoto: true, neighborhood: true },
      orderBy: { goodHangouts: 'desc' },
      take:    5,
    }),
    prisma.user.groupBy({
      by:      ['neighborhood'],
      where:   { neighborhood: { not: null }, status: 'approved' },
      _count:  { _all: true },
    }),
  ])

  // This page is public (anonymous visitors are the point — it's a growth
  // surface like /guide and /handbook). Strip contact info for anyone
  // without a session, matching the exact same redaction already done in
  // GET /api/visitors — a signed-out request must never see a member's raw
  // contact/email, only that they exist and how to reach them (sign up).
  const isMember = !!session
  const serialised = announcements.map(a => ({
    id:           a.id,
    name:         a.name,
    startsOn:     typeof a.startsOn === 'string' ? a.startsOn : new Date(a.startsOn).toISOString().split('T')[0],
    endsOn:       typeof a.endsOn   === 'string' ? a.endsOn   : new Date(a.endsOn).toISOString().split('T')[0],
    fromCity:     a.fromCity     ?? null,
    neighborhood: a.neighborhood ?? null,
    intro:        a.intro,
    contact:      isMember ? (a.contact ?? null) : null,
    email:        isMember ? (a.email   ?? null) : null,
    interests:    (a.user?.interests ?? []) as string[],
    travelerType: a.travelerType ?? null,
    languages:    a.languages,
    lookingFor:   a.lookingFor,
    user:         a.user ? { id: a.user.id, name: a.user.name, color: a.user.color, profilePhoto: a.user.profilePhoto } : null,
  }))

  const cityCount = new Set(serialised.map(a => a.fromCity).filter(Boolean)).size

  // The viewer's own active visit, when they have one — drives the
  // date-matched events and neighborhood picks below. Without it those
  // sections fall back to a generic prompt rather than guessing.
  const viewerVisit = session ? serialised.find(a => a.user?.id === session.id) ?? null : null

  const eventsDuringVisit = viewerVisit
    ? upcomingEvents.filter(e => e.date >= viewerVisit.startsOn && e.date <= viewerVisit.endsOn).slice(0, 6)
    : []

  // §20 of the hangouts plan — spontaneous plans surfaced to visitors.
  // Members only (hangouts are member content); date-matched to the
  // viewer's own visit when they've posted one, otherwise just what's
  // active or imminent. Server-side, so no client fetch/401 dance.
  const hangoutsDuringVisit = session ? await prisma.hangout.findMany({
    where: {
      status: 'active',
      endsAt: { gte: new Date() },
      ...(viewerVisit ? { startsAt: { lte: new Date(viewerVisit.endsOn + 'T23:59:59+03:00') } } : {}),
    },
    select: {
      id: true, title: true, activity: true, neighborhood: true, startsAt: true, maxPeople: true,
      user: { select: { name: true } },
      _count: { select: { joins: true } },
    },
    orderBy: { startsAt: 'asc' },
    take: 4,
  }) : []

  // Their neighborhood leads when known, then the busiest ones fill the row.
  const memberCountFor = (n: string) =>
    neighborhoodCounts.find(c => c.neighborhood === n)?._count._all ?? 0

  const neighborhoodPicks = [
    ...(viewerVisit?.neighborhood ? [viewerVisit.neighborhood] : []),
    ...Object.keys(NEIGHBORHOOD_META)
      .filter(n => n !== viewerVisit?.neighborhood)
      .sort((a, b) => memberCountFor(b) - memberCountFor(a)),
  ].slice(0, 4).map(name => ({
    name,
    meta:    NEIGHBORHOOD_META[name],
    members: memberCountFor(name),
  }))

  const fmtEventDate = (d: string) => {
    const [y, m, day] = d.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, day))
      .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
      .toUpperCase()
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Hero — full-bleed cinematic photo with the copy overlaid. The
          gradient is what makes white text legible over a bright sunset
          photo: without it the headline sits on the blown-out sky at the
          horizon and drops well below AA. Kept opaque enough at the
          bottom that the CTAs never land on the busy boat/crowd detail. */}
      <section className="relative h-[500px] sm:h-[560px] lg:h-[620px] w-full overflow-hidden">
        <Image
          src="/app/images/visiting-hero.jpg"
          alt="Four Smileys members at an Istanbul viewpoint at sunset, one pointing across the Bosphorus toward a domed mosque, beside a signpost pointing to Galata Tower, Sultanahmet, and Hagia Sophia"
          fill
          priority
          fetchPriority="high"
          sizes="100vw"
          className="object-cover object-center"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/30" />
        <div className="absolute inset-0 flex items-center">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
            <div className="max-w-2xl">
              <p className="text-xs font-bold tracking-[0.2em] uppercase text-amber-300 mb-4">
                Visiting Istanbul
              </p>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.1]">
                Your Istanbul starts before you arrive.
              </h1>
              <p className="text-base sm:text-lg text-white/90 mt-5 leading-relaxed max-w-xl">
                Tell us when you&apos;re coming. Smileys members in Istanbul can reach out with
                local tips, coffee invitations, introductions and plans before you arrive.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                {/* Posting is member-only (anonymous posting was tried and
                    reverted — see app/(member)/visiting/new/page.tsx), so a
                    logged-out visitor is sent to /apply rather than into a
                    form that would just bounce them to login. */}
                <Link href={isMember ? '/visiting/new' : '/apply'}
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-amber-500 hover:bg-amber-600 text-white text-base font-bold rounded-xl transition-colors shadow-lg">
                  Tell Us You&apos;re Coming
                  <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </Link>
                <a href="#visitors"
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 border border-white/50 hover:bg-white/10 text-white text-base font-semibold rounded-xl transition-colors backdrop-blur-sm">
                  See Who&apos;s Visiting
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
              { icon: '☕', title: 'Meet a Local',      body: 'Grab a coffee, drink or meal with someone already living in Istanbul.' },
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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Full container width (not max-w-3xl) so the visitor cards can
            lay out 3-up on desktop; the handbook cross-link below keeps
            its own reading width so it doesn't stretch into a banner. */}
        <div id="visitors" className="scroll-mt-20">

        <VisitingClient announcements={serialised} events={upcomingEvents} cityCount={cityCount} featuredLocals={featuredLocals} />

        {/* Cross-link to /handbook — visitors landing here are the exact
            audience for the long-form survival reads. Closes the loop
            with /handbook (and /guide) which both link back here as
            "Visiting first?". Soft grey card so it doesn't compete
            with the post-CTA. */}
        <Link href="/handbook"
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
      <section className="bg-gray-50 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">
            Know where you&apos;re staying?
          </h2>
          <p className="text-gray-600 mt-2 mb-8">Discover your neighborhood before you arrive.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {neighborhoodPicks.map(n => (
              <Link key={n.name} href={`/neighborhoods/${neighborhoodToSlug(n.name)}`}
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
          <Link href="/neighborhoods" className="inline-block mt-8 text-sm font-bold text-amber-600 hover:underline">
            Explore all Istanbul neighborhoods →
          </Link>
        </div>
      </section>

      {/* ── Events during your visit ──
          Personalised only when the viewer has posted their own dates;
          otherwise it prompts for them rather than showing a generic list
          that quietly pretends to be matched to a trip. */}
      <section className="bg-white border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">
            What&apos;s happening while you&apos;re here
          </h2>
          {viewerVisit ? (
            eventsDuringVisit.length > 0 ? (
              <>
                <p className="text-gray-600 mt-2 mb-8">
                  Events between {viewerVisit.startsOn} and {viewerVisit.endsOn}.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {eventsDuringVisit.map(e => (
                    <Link key={e.id} href={`/events/${e.id}`}
                      className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-amber-200 transition-all group">
                      <p className="text-xs font-bold tracking-wide text-amber-600">{fmtEventDate(e.date)}</p>
                      <h3 className="font-bold text-gray-900 mt-1.5 leading-snug">
                        <span aria-hidden="true">{e.emoji} </span>{e.title}
                      </h3>
                      <p className="text-xs text-gray-500 mt-2">
                        <span aria-hidden="true">📍 </span>{e.neighborhood || e.location}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        <span aria-hidden="true">👥 </span>{e._count.attendees} going
                      </p>
                      <span className="inline-block text-xs font-bold text-gray-700 mt-3 group-hover:text-amber-600 transition-colors">
                        View event →
                      </span>
                    </Link>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-gray-600 mt-2">
                Nothing scheduled between {viewerVisit.startsOn} and {viewerVisit.endsOn} yet — new events go up every week.
              </p>
            )
          ) : (
            <div className="mt-4">
              <p className="text-gray-600 mb-5">Add your travel dates to see what&apos;s happening during your stay.</p>
              <Link href={isMember ? '/visiting/new' : '/apply'}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
                Add my dates
              </Link>
            </div>
          )}
        </div>
      </section>

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
                    🕐 {new Date(hg.startsAt).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Istanbul' })}
                    {hg.neighborhood && <> · 📍 {hg.neighborhood}</>}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {hg.user.name.split(' ')[0]} · 👥 {hg._count.joins + 1} going
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

      {/* ── Already in Istanbul? ── */}
      <section className="bg-amber-50 border-t border-amber-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <div className="max-w-3xl">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">Already in Istanbul?</h2>
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

      {/* Social proof (§10 of the brief) is deliberately absent: the only
          testimonials on record are general Smileys ones, not from visitors
          who used this feature. Dressing those up as visit stories would be
          fabrication, so the section stays out until real ones exist. */}

      {/* ── Final CTA ── */}
      <section className="bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Don&apos;t just visit Istanbul.<br />Know someone here.
          </h2>
          <p className="text-gray-300 mt-5 max-w-xl mx-auto leading-relaxed">
            Tell the community you&apos;re coming and start making connections before you arrive.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href={isMember ? '/visiting/new' : '/apply'}
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-amber-500 hover:bg-amber-600 text-white text-base font-bold rounded-xl transition-colors">
              Tell Us You&apos;re Coming
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

      <StickyVisitCta hasPosted={!!viewerVisit} />
    </div>
  )
}
