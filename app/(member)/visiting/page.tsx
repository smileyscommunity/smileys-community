import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import type { Metadata } from 'next'
import VisitingClient from './VisitingClient'

// Cached 2-min — visitor announcements don't churn second-by-second.
// `today` is passed in so day-boundary rollover invalidates the
// cache entry (different cache key per day). The page used to read
// the session here just to pass viewerId to VisitingClient, which
// forced force-dynamic and blocked caching; that branch moved into
// the client (useAuth) so this server fetch can be cached.
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

export const metadata: Metadata = {
  title: 'Visiting Istanbul? Meet locals — Smileys Community',
  description: 'Tell Smileys members you\'re coming to Istanbul. Locals will reach out to grab coffee, share neighborhood tips, and welcome you in.',
  openGraph: {
    title: 'Visiting Istanbul? Meet locals — Smileys Community',
    description: 'Post your trip dates, see who else is in town, and connect with locals before you arrive.',
    url: 'https://smileyscommunity.com/visiting',
  },
}

export default async function VisitingPage() {
  const today         = new Date().toISOString().split('T')[0]
  const sixtyDaysOut  = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const [announcements, upcomingEvents, featuredLocals] = await Promise.all([
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

  const serialised = announcements.map(a => ({
    id:           a.id,
    name:         a.name,
    startsOn:     typeof a.startsOn === 'string' ? a.startsOn : new Date(a.startsOn).toISOString().split('T')[0],
    endsOn:       typeof a.endsOn   === 'string' ? a.endsOn   : new Date(a.endsOn).toISOString().split('T')[0],
    fromCity:     a.fromCity     ?? null,
    neighborhood: a.neighborhood ?? null,
    intro:        a.intro,
    contact:      a.contact      ?? null,
    email:        a.email        ?? null,
    interests:    (a.user?.interests ?? []) as string[],
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
          <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">
            <span aria-hidden="true">👋</span> Newcomers &amp; Visitors
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">
            Visiting Istanbul?
          </h1>
          <p className="text-base text-gray-600 mt-1 max-w-xl">
            Tell us when you&apos;re coming. Locals will reach out for coffee, tips, and intros before you arrive.
          </p>
          <Link href="/visiting/new"
            className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors shadow-sm">
            <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Post your visit
          </Link>
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
