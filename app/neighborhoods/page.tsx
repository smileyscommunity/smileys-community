import Link from 'next/link'
import { readFileSync } from 'fs'
import { join } from 'path'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { neighborhoodToSlug, NEIGHBORHOOD_META } from '@/lib/neighborhoods'
import { APP_URL } from '@/lib/env'
import { getSession } from '@/lib/session'

export const metadata = {
  alternates: { canonical: `${APP_URL}/neighborhoods` },
  title: 'Explore Istanbul Neighborhoods — Smileys Community',
  description: 'Find Smileys events happening near you. From Kadıköy to Beşiktaş, Cihangir to Ataşehir — discover social events across Istanbul by neighborhood.',
  openGraph: {
    title: 'Istanbul Neighborhoods — Smileys Community',
    description: 'Discover curated social events happening across Istanbul, organised by neighborhood.',
    url: 'https://smileyscommunity.com/neighborhoods',
  },
}
import { resolveImageUrl, avatarUrl } from '@/lib/data'
import NeighborhoodGrid, { type Group } from '@/components/NeighborhoodGrid'
import { loadContent } from '@/lib/content'

export const dynamic = 'force-dynamic'

const getNeighborhoodStats = unstable_cache(
  async (today: string) => Promise.all([
    prisma.event.groupBy({
      by: ['neighborhood'],
      where: { date: { gte: today } },
      _count: { _all: true },
    }),
    prisma.user.groupBy({
      by: ['neighborhood'],
      where: { neighborhood: { not: null }, status: { not: 'banned' } },
      _count: { _all: true },
    }),
    prisma.event.findMany({
      where: { date: { gte: today }, status: 'published' },
      select: { neighborhood: true, title: true, date: true, emoji: true },
      orderBy: { date: 'asc' },
      take: 300,
    }),
  ]),
  ['neighborhood-stats'],
  { revalidate: 300, tags: ['neighborhoods'] },
)

function getActivitySignal(eventCount: number, memberCount: number) {
  const score = eventCount * 3 + Math.round(memberCount / 6)
  if (score >= 9) return { label: 'Hot right now',  icon: '🔥', cls: 'bg-orange-50 text-orange-500' }
  if (score >= 5) return { label: 'Active',          icon: '⚡', cls: 'bg-blue-50 text-blue-500'    }
  if (score >= 2) return { label: 'Growing',         icon: '🌱', cls: 'bg-green-50 text-green-600'  }
  return               { label: 'Quiet this month', icon: '😴', cls: 'bg-gray-50 text-gray-400'    }
}

export default async function NeighborhoodsPage() {
  const c = loadContent()
  const nh = c.neighborhoods ?? {}
  const today = new Date().toISOString().split('T')[0]

  const [session, [eventCounts, memberCounts, nextEventsRaw]] = await Promise.all([
    getSession(),
    getNeighborhoodStats(today),
  ])

  // First upcoming event per neighborhood
  const nextEventMap: Record<string, { title: string; date: string; emoji: string }> = {}
  for (const e of nextEventsRaw) {
    if (e.neighborhood && !nextEventMap[e.neighborhood]) {
      nextEventMap[e.neighborhood] = { title: e.title, date: e.date, emoji: e.emoji }
    }
  }

  const userNeighborhood = session?.neighborhood ?? null

  let adBanner: { active: boolean; type: string; headline: string; subtitle: string; emoji: string; link: string; cta: string } | null = null
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'banners.json'), 'utf-8'))
    const b = raw?.neighborhoods
    if (b?.active && b?.headline) adBanner = b
  } catch { /* no banner */ }

  const neighborhoods = Object.entries(NEIGHBORHOOD_META).map(([name, meta]) => {
    const eventCount  = eventCounts.find(e => e.neighborhood === name)?._count._all  ?? 0
    const memberCount = memberCounts.find(m => m.neighborhood === name)?._count._all ?? 0
    const activityScore = eventCount * 3 + Math.round(memberCount / 6)
    return {
      name,
      slug: neighborhoodToSlug(name),
      meta,
      eventCount,
      memberCount,
      activityScore,
      isYours:   name === userNeighborhood,
      signal:    getActivitySignal(eventCount, memberCount),
      nextEvent: nextEventMap[name] ?? null,
    }
  })

  const sortGroup = (items: typeof neighborhoods) =>
    [...items].sort((a, b) => {
      if (a.isYours && !b.isYours) return -1
      if (b.isYours && !a.isYours) return 1
      const scoreA = a.eventCount * 3 + Math.round(a.memberCount / 6)
      const scoreB = b.eventCount * 3 + Math.round(b.memberCount / 6)
      return scoreB - scoreA
    })

  const groups: Group[] = [
    { label: 'Central Hubs', side: 'Central',  icon: '🌟', color: 'bg-amber-100 text-amber-700',  items: sortGroup(neighborhoods.filter(n => n.meta.side === 'Central'))  },
    { label: 'European Side', side: 'European', icon: '🇹🇷', color: 'bg-blue-100 text-blue-700',   items: sortGroup(neighborhoods.filter(n => n.meta.side === 'European')) },
    { label: 'Asian Side',    side: 'Asian',    icon: '🌏', color: 'bg-green-100 text-green-700',  items: sortGroup(neighborhoods.filter(n => n.meta.side === 'Asian'))    },
    { label: 'Coastal',       side: 'Coastal',  icon: '🌊', color: 'bg-sky-100 text-sky-700',      items: sortGroup(neighborhoods.filter(n => n.meta.side === 'Coastal'))  },
    { label: 'Islands',       side: 'Islands',  icon: '🏝️', color: 'bg-purple-100 text-purple-700', items: sortGroup(neighborhoods.filter(n => n.meta.side === 'Islands'))  },
    { label: 'Emerging',      side: 'Emerging', icon: '🚀', color: 'bg-slate-100 text-slate-700',  items: sortGroup(neighborhoods.filter(n => n.meta.side === 'Emerging')) },
  ].filter(g => g.items.length > 0)

  let yourNeighborhoodMembers: { id: string; name: string; color: string; profilePhoto: string | null }[] = []
  if (userNeighborhood) {
    yourNeighborhoodMembers = await prisma.user.findMany({
      where:   { neighborhood: userNeighborhood, status: { not: 'banned' } },
      select:  { id: true, name: true, color: true, profilePhoto: true },
      take:    5,
      orderBy: { joinedAt: 'desc' },
    })
  }

  return (
    <main>
      {/* Hero */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-8">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold tracking-wide uppercase mb-5">
            {nh.badge ?? '📍 Explore by neighborhood'}
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900 mb-3">
            {nh.headline ?? 'Find events near you'}
          </h1>
          <p className="text-base text-gray-600 max-w-2xl leading-relaxed">
            {nh.subtitle ?? "Smileys events happen all across Istanbul. Pick a neighborhood and see what's coming up."}
          </p>
        </div>
      </section>

      {/* Your neighborhood banner */}
      {userNeighborhood && NEIGHBORHOOD_META[userNeighborhood] && (
        <div className="bg-amber-50 border-b border-amber-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{NEIGHBORHOOD_META[userNeighborhood].emoji}</span>
              <div>
                <div className="text-xs font-bold text-amber-600 uppercase tracking-wide">Your neighborhood</div>
                <div className="font-bold text-gray-900">{userNeighborhood}</div>
              </div>
              {yourNeighborhoodMembers.length > 0 && (
                <div className="flex items-center gap-2 ml-2">
                  <div className="flex -space-x-1.5">
                    {yourNeighborhoodMembers.slice(0, 4).map(m => (
                      m.profilePhoto ? (
                        <img key={m.id} src={avatarUrl(m.profilePhoto, 64)} alt={m.name} loading="lazy" decoding="async"
                          className="w-7 h-7 rounded-full border-2 border-white object-cover" />
                      ) : (
                        <div key={m.id}
                          className="w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-white text-[9px] font-bold"
                          style={{ backgroundColor: m.color }}>
                          {m.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                        </div>
                      )
                    ))}
                  </div>
                  <span className="text-xs text-gray-600">
                    {memberCounts.find(m => m.neighborhood === userNeighborhood)?._count._all ?? 0} locals
                  </span>
                </div>
              )}
            </div>
            <Link href={`/neighborhoods/${neighborhoodToSlug(userNeighborhood)}`}
              className="px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors shrink-0">
              See your area →
            </Link>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-16">
        {adBanner && (
          <div className={`mb-6 ${adBanner.link ? '' : ''}`}>
            {adBanner.link ? (
              <a href={adBanner.link} target="_blank" rel="noopener noreferrer" className="block group">
                {adBanner.type === 'strip' ? (
                  <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                    <span className="text-lg shrink-0">{adBanner.emoji}</span>
                    <p className="flex-1 text-sm font-semibold text-amber-900 truncate">{adBanner.headline}</p>
                    {adBanner.cta && <span className="text-xs font-bold text-amber-600 shrink-0">{adBanner.cta} →</span>}
                  </div>
                ) : adBanner.type === 'promo' ? (
                  <div className="flex items-center gap-3 bg-gradient-to-r from-amber-500 to-orange-400 rounded-2xl px-4 py-3 relative overflow-hidden">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-amber-100 uppercase tracking-widest mb-0.5">From Smileys</p>
                      <p className="text-sm font-bold text-white truncate">{adBanner.headline}</p>
                      {adBanner.subtitle && <p className="text-xs text-amber-100 truncate">{adBanner.subtitle}</p>}
                    </div>
                    <div className="shrink-0 w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-2xl">{adBanner.emoji}</div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 bg-gradient-to-r from-gray-900 to-gray-700 rounded-2xl px-4 py-3 overflow-hidden relative group">
                    <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_80%_50%,#f59e0b_0%,transparent_60%)]" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-0.5">Sponsored</p>
                      <p className="text-sm font-bold text-white truncate group-hover:text-amber-300 transition-colors">{adBanner.headline}</p>
                      {adBanner.subtitle && <p className="text-xs text-gray-400 truncate">{adBanner.subtitle}</p>}
                    </div>
                    <div className="shrink-0 w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-2xl">{adBanner.emoji}</div>
                  </div>
                )}
              </a>
            ) : adBanner.type === 'strip' ? (
              <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                <span className="text-lg shrink-0">{adBanner.emoji}</span>
                <p className="flex-1 text-sm font-semibold text-amber-900 truncate">{adBanner.headline}</p>
                {adBanner.cta && <span className="text-xs font-bold text-amber-600 shrink-0">{adBanner.cta} →</span>}
              </div>
            ) : adBanner.type === 'promo' ? (
              <div className="flex items-center gap-3 bg-gradient-to-r from-amber-500 to-orange-400 rounded-2xl px-4 py-3 relative overflow-hidden">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-amber-100 uppercase tracking-widest mb-0.5">From Smileys</p>
                  <p className="text-sm font-bold text-white truncate">{adBanner.headline}</p>
                  {adBanner.subtitle && <p className="text-xs text-amber-100 truncate">{adBanner.subtitle}</p>}
                </div>
                <div className="shrink-0 w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-2xl">{adBanner.emoji}</div>
              </div>
            ) : (
              <div className="flex items-center gap-3 bg-gradient-to-r from-gray-900 to-gray-700 rounded-2xl px-4 py-3 overflow-hidden relative">
                <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_80%_50%,#f59e0b_0%,transparent_60%)]" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-0.5">Sponsored</p>
                  <p className="text-sm font-bold text-white truncate">{adBanner.headline}</p>
                  {adBanner.subtitle && <p className="text-xs text-gray-400 truncate">{adBanner.subtitle}</p>}
                </div>
                <div className="shrink-0 w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-2xl">{adBanner.emoji}</div>
              </div>
            )}
          </div>
        )}
        <NeighborhoodGrid groups={groups} />

        {/* Leaderboard — top neighborhoods this month */}
        {(() => {
          const top5 = [...neighborhoods]
            .filter(n => n.eventCount > 0 || n.memberCount > 0)
            .sort((a, b) => b.activityScore - a.activityScore)
            .slice(0, 5)
          const maxScore = top5[0]?.activityScore ?? 1
          if (top5.length < 2) return null
          return (
            <div className="mt-8 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-4">🏆 Most active neighborhoods</h2>
              <div className="space-y-3">
                {top5.map((n, i) => (
                  <Link key={n.name} href={`/neighborhoods/${n.slug}`}
                    className="flex items-center gap-3 hover:opacity-80 transition-opacity group">
                    <span className="text-xs font-bold text-gray-400 w-5 text-center shrink-0">#{i + 1}</span>
                    <span className="text-lg shrink-0">{n.meta.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-gray-900 group-hover:text-amber-600 transition-colors truncate">{n.name}</span>
                        <span className="text-xs text-gray-400 shrink-0 ml-2">{n.eventCount} events · {n.memberCount} locals</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-400 rounded-full" style={{ width: `${(n.activityScore / maxScore) * 100}%` }} />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )
        })()}
      </div>
    </main>
  )
}
