import Link from 'next/link'
import Image from 'next/image'
import { APP_URL } from '@/lib/env'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import VisitingClient from './VisitingClient'

// Cached 2-min — visitor announcements don't churn second-by-second.
// `today` is passed in so day-boundary rollover invalidates the
// cache entry (different cache key per day). Session-independent by
// design (see redaction below) so this stays a single shared cache
// entry per day instead of forking per viewer.
const getAnnouncements = unstable_cache(
  async (today: string) => prisma.visitorAnnouncement.findMany({
    where:   { status: 'active', endsOn: { gte: today } },
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
const ogImage = `${APP_URL}/api/og?${new URLSearchParams({
  title:   'Visiting Istanbul?',
  eyebrow: 'Meet locals before you arrive',
  cta:     'Post your visit',
}).toString()}`

export const metadata: Metadata = {
  alternates: { canonical: `${APP_URL}/visiting` },
  title: 'Visiting Istanbul? Meet locals — Smileys Community',
  description: 'Tell Smileys members you\'re coming to Istanbul. Locals will reach out to grab coffee, share neighborhood tips, and welcome you in.',
  openGraph: {
    title: 'Visiting Istanbul? Meet locals — Smileys Community',
    description: 'Post your trip dates, see who else is in town, and connect with locals before you arrive.',
    url: `${APP_URL}/visiting`,
    images: [{ url: ogImage, width: 1200, height: 630, alt: 'Visiting Istanbul? — Smileys Community' }],
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

  const [session, announcements, upcomingEvents, featuredLocals] = await Promise.all([
    getSession(),
    getAnnouncements(today),
    prisma.event.findMany({
      where:   { status: 'published', date: { gte: today, lte: sixtyDaysOut } },
      select:  { id: true, title: true, emoji: true, date: true },
      orderBy: { date: 'asc' },
      take:    60,
    }),
    prisma.user.findMany({
      where:   { status: 'approved' },
      select:  { id: true, name: true, color: true, profilePhoto: true, neighborhood: true },
      orderBy: { goodHangouts: 'desc' },
      take:    5,
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

  return (
    <div className="min-h-screen bg-white">
      {/* Hero — typographic, pill eyebrow + h1 to match the rest of
          the public surfaces (/guide, /about, /handbook, /posts).
          The previous icon-on-left layout was the odd one out. */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-8">
          {/* Two-column on desktop, stacked on mobile — the copy and both
              CTAs stay above the fold on a phone, with the photo below
              rather than pushing the "post your visit" action off-screen. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
            <div>
              <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">
                <span aria-hidden="true">👋</span> Newcomers &amp; Visitors
              </span>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">
                Visiting Istanbul?
              </h1>
              <p className="text-base text-gray-600 mt-1 max-w-xl">
                Tell us when you&apos;re coming. Locals will reach out for coffee, tips, and introductions before you arrive.
              </p>
              <p className="text-base text-gray-900 font-semibold mt-3 max-w-xl">
                Arrive with connections, not as a stranger.
              </p>
              {/* Posting requires membership (anonymous posting was tried
                  and reverted — see app/(member)/visiting/new/page.tsx),
                  so there's no second CTA competing with signup here: this
                  page browses publicly for SEO/reach, but "Apply to join"
                  is the only real path forward for a non-member. */}
              <div className="mt-6">
                <Link href="/apply"
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors shadow-sm">
                  Apply to join Smileys
                  <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </Link>
              </div>
              <p className="text-xs text-gray-400 mt-3">
                Members get the full community — clubs, events, and everyone else here. Posting your own visit is a member feature too.
              </p>
            </div>
            {/* aspect-[3/2] matches the source file exactly, so object-cover
                never actually crops — the signpost and the group at the
                bottom edge both survive at every breakpoint. */}
            <div className="relative aspect-[3/2] rounded-2xl overflow-hidden shadow-xl">
              <Image
                src="/app/images/visiting-hero.jpg"
                alt="Four Smileys members at an Istanbul viewpoint at sunset, one pointing across the Bosphorus toward a domed mosque, beside a signpost pointing to Galata Tower, Sultanahmet, and Hagia Sophia"
                fill
                priority
                fetchPriority="high"
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="max-w-3xl">

        {/* Cross-link to /handbook — visitors landing here are the exact
            audience for the long-form survival reads. Closes the loop
            with /handbook (and /guide) which both link back here as
            "Visiting first?". Soft grey card so it doesn't compete
            with the post-CTA. */}
        <VisitingClient announcements={serialised} events={upcomingEvents} cityCount={cityCount} featuredLocals={featuredLocals} />

        <Link href="/handbook"
          className="block mt-8 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-2xl px-5 py-4 transition-colors group">
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
    </div>
  )
}
