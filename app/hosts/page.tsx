import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId, getCityConfig } from '@/lib/city'
import { todayInTz, DEFAULT_TZ } from '@/lib/cityTime'
import { avatarUrl, BLUR_PLACEHOLDER } from '@/lib/data'
import { APP_URL } from '@/lib/env'

// Meet the Hosts (multi-city phase 2.1) — the people who make events happen,
// as a public surface. Hosts are semi-public figures in the product already
// (every public event card names its host with photo), so this page shows
// exactly that tier of information and nothing more: name, photo, the clubs
// they host, and how much they host. No bio, no contact, no quality metrics —
// wouldReturnRate is a moderation diagnostic, not a leaderboard (see
// EventSurvey's schema comment), and a public ranking would corrupt it.
//
// Doubles as the host-recruitment funnel: the "Become a host" CTA is the
// pathway a launching city needs filled before it can go live.

export const metadata: Metadata = {
  title: 'Meet the Hosts — Smileys Community',
  description: 'The members who host Smileys events and run its clubs — the people who make the community happen.',
  alternates: { canonical: `${APP_URL}/hosts` },
}

const getHostsData = unstable_cache(
  async (cityId: string) => {
    const today = todayInTz(DEFAULT_TZ)

    // Two ways in: hosting a club, or a city-level host grant. Union them —
    // most hosts have both, and either alone still belongs on this page.
    const [clubHostRows, cityHostRows] = await Promise.all([
      prisma.clubMembership.findMany({
        where: {
          role: 'host', status: 'approved',
          club: { isActive: true, cityId },
          user: { status: 'approved', hiddenFromMembers: false },
        },
        select: {
          userId: true,
          club: { select: { id: true, name: true, slug: true, emoji: true } },
          user: { select: { id: true, name: true, color: true, profilePhoto: true } },
        },
      }),
      prisma.cityHost.findMany({
        where: {
          cityId, status: 'approved', revokedAt: null,
          user: { status: 'approved', hiddenFromMembers: false },
        },
        select: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
      }),
    ])

    const hosts = new Map<string, {
      id: string; name: string; color: string; profilePhoto: string | null
      clubs: { id: string; name: string; slug: string; emoji: string }[]
    }>()
    for (const row of clubHostRows) {
      const h = hosts.get(row.userId) ?? { ...row.user, clubs: [] }
      h.clubs.push(row.club)
      hosts.set(row.userId, h)
    }
    for (const row of cityHostRows) {
      if (!hosts.has(row.user.id)) hosts.set(row.user.id, { ...row.user, clubs: [] })
    }
    if (hosts.size === 0) return []

    const hostIds = [...hosts.keys()]
    const [upcoming, past] = await Promise.all([
      prisma.event.groupBy({
        by: ['hostId'],
        where: { hostId: { in: hostIds }, cityId, status: 'published', date: { gte: today } },
        _count: { _all: true },
      }),
      prisma.event.groupBy({
        by: ['hostId'],
        where: { hostId: { in: hostIds }, cityId, status: { in: ['published', 'archived'] }, date: { lt: today } },
        _count: { _all: true },
      }),
    ])
    const up = new Map(upcoming.map(r => [r.hostId, r._count._all]))
    const pa = new Map(past.map(r => [r.hostId, r._count._all]))

    return [...hosts.values()]
      .map(h => ({ ...h, upcomingCount: up.get(h.id) ?? 0, hostedCount: pa.get(h.id) ?? 0 }))
      // Active hosts lead: something to join beats a long memory. Ties break
      // on track record, then name so the order is stable.
      .sort((a, b) => (b.upcomingCount - a.upcomingCount) || (b.hostedCount - a.hostedCount) || a.name.localeCompare(b.name))
  },
  ['hosts-page-data'],
  { revalidate: 300, tags: ['hosts'] },
)

export default async function HostsPage() {
  const session = await getSession()
  const cityId = await resolveCityId(session)
  const [hosts, city] = await Promise.all([getHostsData(cityId), getCityConfig(cityId)])

  const cityName = city.name

  return (
    <div className="min-h-screen bg-warm pb-20">
      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-10 pb-8">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-2">Smileys {cityName}</p>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">Meet the Hosts</h1>
          <p className="text-base text-gray-600 mt-2 max-w-2xl">
            A host isn&apos;t just an event organizer — they&apos;re the reason a room full of strangers
            turns into a community. These are the members who make {cityName} happen.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-8">
        {hosts.length === 0 ? (
          <div className="text-center py-16">
            <span aria-hidden="true" className="text-4xl block mb-3">🎤</span>
            <p className="font-semibold text-gray-900 mb-1">No hosts here yet</p>
            <p className="text-sm text-gray-600">This city is still finding its first hosts — maybe that&apos;s you?</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {hosts.map(h => (
              <div key={h.id} className="card p-5 flex flex-col">
                <div className="flex items-center gap-3 mb-3">
                  {h.profilePhoto ? (
                    <Image
                      src={avatarUrl(h.profilePhoto, 96)}
                      alt={h.name}
                      width={56} height={56}
                      placeholder="blur" blurDataURL={BLUR_PLACEHOLDER}
                      className="w-14 h-14 rounded-full object-cover"
                    />
                  ) : (
                    <div
                      className="w-14 h-14 rounded-full flex items-center justify-center text-white text-lg font-bold"
                      style={{ backgroundColor: h.color }}
                    >
                      {h.name.charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 truncate">{h.name}</p>
                    <p className="text-xs text-gray-500">
                      {h.upcomingCount > 0
                        ? `${h.upcomingCount} upcoming event${h.upcomingCount === 1 ? '' : 's'}`
                        : h.hostedCount > 0
                          ? `${h.hostedCount} event${h.hostedCount === 1 ? '' : 's'} hosted`
                          : 'Host'}
                    </p>
                  </div>
                </div>
                {h.clubs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-auto">
                    {h.clubs.slice(0, 3).map(c => (
                      <Link key={c.id} href={`/clubs/${c.slug}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold bg-gray-50 hover:bg-amber-50 border border-gray-100 rounded-full px-2.5 py-1 text-gray-700 transition-colors">
                        <span aria-hidden="true">{c.emoji}</span> {c.name}
                      </Link>
                    ))}
                    {h.clubs.length > 3 && (
                      <span className="text-xs text-gray-400 self-center">+{h.clubs.length - 3} more</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Become a host ── */}
        <div className="mt-12 bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl p-8 text-center text-white">
          <h2 className="text-2xl font-extrabold mb-2">Could you be a host?</h2>
          <p className="text-amber-50 max-w-xl mx-auto mb-6">
            Hosts get support, visibility and the best seat in the house: watching people you
            brought together become friends. No experience needed — just care.
          </p>
          <Link href="/get-involved"
            className="inline-flex items-center gap-2 bg-white text-amber-600 font-bold px-8 py-3.5 rounded-xl hover:bg-amber-50 transition-colors">
            Become a host
            <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  )
}
