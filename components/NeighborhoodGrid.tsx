'use client'

import { useEffect, useState } from 'react'
import NeighborhoodsMapView, { type MapPoint } from './NeighborhoodsMapView'
import Link from 'next/link'
import { neighborhoodImage, type NeighborhoodMeta } from '@/lib/neighborhoods'

interface ActivitySignal { label: string; icon: string; cls: string }

export interface NeighborhoodItem {
  name:          string
  slug:          string
  meta:          NeighborhoodMeta
  eventCount:    number
  memberCount:   number
  pickCount:     number
  activityScore: number
  isYours:       boolean
  signal:        ActivitySignal
  nextEvent:     { title: string; date: string; emoji: string } | null
}

export interface Group {
  label: string
  side:  string
  icon:  string
  color: string
  items: NeighborhoodItem[]
}

const SIDE_GRADIENT: Record<string, string> = {
  Central:  'from-amber-500 to-orange-400',
  European: 'from-blue-600 to-indigo-500',
  Asian:    'from-emerald-500 to-teal-400',
  Coastal:  'from-sky-500 to-blue-400',
  Islands:  'from-purple-500 to-fuchsia-400',
  Emerging: 'from-slate-600 to-gray-500',
}

const SIDE_SECTION: Record<string, { bg: string; border: string; cardBg: string; cardBorder: string }> = {
  Central:  { bg: 'bg-amber-50',   border: 'border-amber-100',  cardBg: 'bg-amber-50/60',   cardBorder: 'border-amber-100 hover:border-amber-300'   },
  European: { bg: 'bg-blue-50',    border: 'border-blue-100',   cardBg: 'bg-blue-50/60',    cardBorder: 'border-blue-100 hover:border-blue-300'     },
  Asian:    { bg: 'bg-emerald-50', border: 'border-emerald-100',cardBg: 'bg-emerald-50/60', cardBorder: 'border-emerald-100 hover:border-emerald-300'},
  Coastal:  { bg: 'bg-sky-50',     border: 'border-sky-100',    cardBg: 'bg-sky-50/60',     cardBorder: 'border-sky-100 hover:border-sky-300'       },
  Islands:  { bg: 'bg-purple-50',  border: 'border-purple-100', cardBg: 'bg-purple-50/60',  cardBorder: 'border-purple-100 hover:border-purple-300'  },
  Emerging: { bg: 'bg-slate-50',   border: 'border-slate-200',  cardBg: 'bg-slate-50/60',   cardBorder: 'border-slate-200 hover:border-slate-300'   },
}

function fmt(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

// ── Featured card (large, gradient) ──────────────────────────────────────────
function FeaturedCard({ n }: { n: NeighborhoodItem }) {
  const gradient = SIDE_GRADIENT[n.meta.side] ?? 'from-amber-500 to-orange-400'
  const photo = neighborhoodImage(n.name)
  return (
    <Link href={`/neighborhoods/${n.slug}`}
      className="group relative rounded-2xl overflow-hidden shadow-md hover:shadow-xl hover:-translate-y-1 transition-all">
      {/* Photo background when one exists (dark overlay keeps the white
          text at AA); gradient otherwise. */}
      {photo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="" aria-hidden="true" loading="lazy"
            className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/45 to-black/25" />
        </>
      ) : (
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-90`} />
      )}
      {/* Large emoji watermark */}
      <div aria-hidden="true" className="absolute right-4 bottom-3 text-7xl opacity-20 select-none pointer-events-none leading-none">
        {n.meta.emoji}
      </div>

      <div className="relative p-5 flex flex-col gap-3 min-h-[160px]">
        {/* Top row: name left, date right */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span aria-hidden="true" className="text-2xl shrink-0">{n.meta.emoji}</span>
              <span className="text-lg font-extrabold text-white tracking-tight leading-tight truncate">{n.name}</span>
              {n.isYours && (
                <span className="text-[10px] font-bold bg-white/25 text-white px-1.5 py-0.5 rounded-full shrink-0">Your area</span>
              )}
            </div>
            <p className="text-xs text-white/70 leading-relaxed">{n.meta.vibe}</p>
          </div>
          {/* Date badge top-right — empty area */}
          {n.nextEvent && (
            <span className="shrink-0 text-[11px] font-bold bg-white/25 text-white px-2 py-0.5 rounded-full whitespace-nowrap">
              {fmt(n.nextEvent.date)}
            </span>
          )}
        </div>

        {/* Next event pill — title only, date moved to top */}
        {n.nextEvent && (
          <div className="inline-flex items-center gap-1.5 bg-white/20 backdrop-blur-sm text-white text-xs font-semibold px-2.5 py-1.5 rounded-xl self-start max-w-full">
            <span aria-hidden="true" className="shrink-0">{n.nextEvent.emoji}</span>
            <span className="truncate">{n.nextEvent.title}</span>
          </div>
        )}

        {/* Stats + signal */}
        <div className="mt-auto flex items-center gap-3 text-white/70 text-xs font-medium">
          <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/20 text-white">
            <span aria-hidden="true">{n.signal.icon}</span> {n.signal.label}
          </span>
          {n.eventCount > 0 && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {n.eventCount} upcoming
            </span>
          )}
          {n.memberCount > 0 && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {n.memberCount} locals
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

// ── Regular card ──────────────────────────────────────────────────────────────
function NeighborhoodCard({ n, cardBg, cardBorder }: { n: NeighborhoodItem; cardBg?: string; cardBorder?: string }) {
  const border = n.isYours ? 'border-amber-300 ring-1 ring-amber-200' : (cardBorder ?? 'border-gray-100 hover:border-gray-200')
  const bg     = cardBg ?? 'bg-white'

  const photo = neighborhoodImage(n.name)

  return (
    <Link href={`/neighborhoods/${n.slug}`}
      className={`group flex flex-col gap-3 ${bg} border rounded-2xl p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all overflow-hidden ${border}`}>
      {/* Photo banner — only for neighborhoods with real photography; the
          rest keep the emoji/gradient treatment rather than an empty slot.
          Negative margins bleed it to the card edges past the p-4. */}
      {photo && (
        <div className="-mx-4 -mt-4 h-28 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="" aria-hidden="true" loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        </div>
      )}
      <div className="flex items-start gap-3">
        <div aria-hidden="true" className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 bg-white/80 shadow-sm">
          {n.meta.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-sm text-gray-900 group-hover:text-amber-600 transition-colors truncate leading-tight">
              {n.name}
            </span>
            {n.isYours && (
              <span className="shrink-0 text-[10px] font-bold bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">
                Your area
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5 leading-relaxed line-clamp-1">{n.meta.vibe}</p>
        </div>
        <svg className="w-4 h-4 text-gray-300 group-hover:text-amber-400 shrink-0 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>

      {/* Next event */}
      {n.nextEvent && (
        <div className="flex items-center gap-1.5 text-xs text-gray-600 bg-white/70 rounded-lg px-2 py-1.5 min-w-0">
          <span aria-hidden="true" className="shrink-0">{n.nextEvent.emoji}</span>
          <span className="truncate font-medium text-gray-700">{n.nextEvent.title}</span>
          <span className="shrink-0 text-gray-400">· {fmt(n.nextEvent.date)}</span>
        </div>
      )}

      {/* Footer stats */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${n.signal.cls}`}>
          <span aria-hidden="true">{n.signal.icon}</span> {n.signal.label}
        </span>
        {n.eventCount > 0 && (
          <span className="text-[11px] font-semibold text-gray-600 bg-white/70 px-2 py-0.5 rounded-full">
            {n.eventCount} event{n.eventCount !== 1 ? 's' : ''}
          </span>
        )}
        {n.memberCount > 0 && (
          <span className="text-[11px] text-gray-400">
            {n.memberCount} local{n.memberCount !== 1 ? 's' : ''}
          </span>
        )}
        {n.pickCount > 0 && (
          <span className="text-[11px] text-gray-400">
            <span aria-hidden="true">❤️ </span>{n.pickCount} local pick{n.pickCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </Link>
  )
}

// ── Main grid ─────────────────────────────────────────────────────────────────
export default function NeighborhoodGrid({ groups, userNeighborhood }: { groups: Group[]; userNeighborhood?: string | null }) {
  const [query,      setQuery]      = useState('')
  const [activeSide, setActiveSide] = useState<string | null>(null)
  const [view,       setView]       = useState<'cards' | 'map'>('cards')
  const [sort,       setSort]       = useState<'active' | 'events' | null>(null)
  // The directory is 100+ neighborhoods. Showing all of them on arrival
  // buries the dozen that actually have people in them, so the default is a
  // ranked shortlist and the full grouped directory is one click away.
  const [showAll,    setShowAll]    = useState(false)

  // Deep link: /neighborhoods?side=Asian#explore (the Cross the Bosphorus
  // cards). Pre-select the side filter and expand past the shortlist so
  // the promise on the card — "explore this side" — is what actually
  // renders. Read on mount only; the chips own the state afterwards.
  useEffect(() => {
    const side = new URLSearchParams(window.location.search).get('side')
    if (side && groups.some(g => g.side === side)) {
      setActiveSide(side)
      setShowAll(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const q = query.toLowerCase().trim()

  const visibleGroups = activeSide ? groups.filter(g => g.side === activeSide) : groups
  const allItems      = visibleGroups.flatMap(g => g.items)
  const filtered      = q ? allItems.filter(n => n.name.toLowerCase().includes(q) || n.meta.vibe.toLowerCase().includes(q)) : null

  const totalEvents  = groups.flatMap(g => g.items).reduce((s, n) => s + n.eventCount,  0)
  const totalMembers = groups.flatMap(g => g.items).reduce((s, n) => s + n.memberCount, 0)

  // Ranked shortlist for the default view. "Events this week" is a filter
  // (drop the ones with nothing on), the others are orderings.
  const WEEK_AHEAD = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  const shortlist = (() => {
    let items = [...allItems]
    if (sort === 'events') items = items.filter(n => n.nextEvent && n.nextEvent.date <= WEEK_AHEAD)
    items.sort((a, b) =>
      sort === 'events'
        ? b.eventCount - a.eventCount
        : b.activityScore - a.activityScore || b.memberCount - a.memberCount)
    return items
  })()

  const mapPoints: MapPoint[] = allItems
    .filter(n => n.memberCount > 0 || n.eventCount > 0)
    .map(n => ({
      name: n.name, slug: n.slug,
      lat: n.meta.lat, lon: n.meta.lon,
      memberCount: n.memberCount, eventCount: n.eventCount,
    }))

  // Top 3 most active neighborhoods with upcoming events for featured
  // section — but a member's own neighborhood leads when set (reviewer
  // feedback: the page defaulted to Kadıköy for everyone). The activity
  // floor is waived for the member's own hood: "your" card is relevant
  // even in a quiet week.
  const featured = (() => {
    const all = groups.flatMap(g => g.items)
    const ranked = all
      .filter(n => n.activityScore >= 5 && n.eventCount > 0)
      .sort((a, b) => b.activityScore - a.activityScore)
    const mine = userNeighborhood ? all.find(n => n.name === userNeighborhood) : undefined
    if (!mine) return ranked.slice(0, 3)
    return [mine, ...ranked.filter(n => n.name !== mine.name)].slice(0, 3)
  })()

  return (
    <div className="space-y-8">
      {/* Stats + Search + Filter */}
      <div className="space-y-4">
        <div className="flex items-center gap-5 text-sm text-gray-600">
          <span><strong className="text-gray-900 font-bold">{groups.flatMap(g => g.items).length}</strong> neighborhoods</span>
          {totalEvents  > 0 && <span><strong className="text-gray-900 font-bold">{totalEvents}</strong> upcoming events</span>}
          {totalMembers > 0 && <span><strong className="text-gray-900 font-bold">{totalMembers}</strong> local members</span>}
        </div>

        <div className="relative max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search neighborhoods…"
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent" />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">✕</button>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setActiveSide(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              activeSide === null ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}>
            All areas
          </button>
          {groups.map(g => (
            <button key={g.side} onClick={() => setActiveSide(activeSide === g.side ? null : g.side)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                activeSide === g.side ? `${g.color} border-transparent` : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}>
              <span aria-hidden="true">{g.icon}</span>
              {g.label}
              <span className={`font-bold ${activeSide === g.side ? 'opacity-70' : 'text-gray-400'}`}>{g.items.length}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {([
            { key: 'active' as const, emoji: '⚡', text: 'Most active'     },
            { key: 'events' as const, emoji: '🎉', text: 'Events this week' },
          ]).map(o => (
            <button key={o.key} onClick={() => setSort(sort === o.key ? null : o.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                sort === o.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}>
              <span aria-hidden="true">{o.emoji}</span> {o.text}
            </button>
          ))}

          {/* Cards | Map. Map plots neighborhood centres only — see
              NeighborhoodsMapView for why no member data reaches it. */}
          <div className="ml-auto inline-flex rounded-full border border-gray-200 bg-white p-0.5">
            {([
              { key: 'cards' as const, label: 'Cards' },
              { key: 'map'   as const, label: 'Map'   },
            ]).map(v => (
              <button key={v.key} onClick={() => setView(v.key)}
                aria-pressed={view === v.key}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors ${
                  view === v.key ? 'bg-amber-500 text-white' : 'text-gray-600 hover:text-gray-900'
                }`}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Map replaces the results area entirely — the toggle is a view
          switch, not an extra panel to scroll past. */}
      {view === 'map' ? (
        <div>
          <NeighborhoodsMapView points={mapPoints} />
          <p className="text-xs text-gray-400 mt-3">
            Showing {mapPoints.length} neighborhoods with members or upcoming events.
            Markers are neighborhood centres — never a member&apos;s location.
          </p>
        </div>
      ) : filtered !== null ? (
        filtered.length === 0 ? (
          <div className="text-center py-16">
            <div aria-hidden="true" className="text-4xl mb-3">🔍</div>
            <p className="text-gray-600 text-sm">No neighborhoods match "{query}"</p>
          </div>
        ) : (
          <div>
            <p className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-5">
              {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(n => (
                <NeighborhoodCard key={n.slug} n={n}
                  cardBg={SIDE_SECTION[n.meta.side]?.cardBg}
                  cardBorder={SIDE_SECTION[n.meta.side]?.cardBorder} />
              ))}
            </div>
          </div>
        )
      ) : !showAll ? (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs font-bold text-gray-600 uppercase tracking-widest">
              {sort === 'events' ? 'Events this week' : 'Most active right now'}
            </span>
            <div className="flex-1 h-px bg-gray-100" />
          </div>
          {shortlist.length === 0 ? (
            <p className="text-sm text-gray-600 py-8">Nothing scheduled in the next week — try “Most active”.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {shortlist.slice(0, 9).map(n => (
                <NeighborhoodCard key={n.slug} n={n}
                  cardBg={SIDE_SECTION[n.meta.side]?.cardBg}
                  cardBorder={SIDE_SECTION[n.meta.side]?.cardBorder} />
              ))}
            </div>
          )}
          <button onClick={() => setShowAll(true)}
            className="mt-6 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl border border-gray-200 bg-white hover:border-amber-300 hover:text-amber-700 text-sm font-bold text-gray-700 transition-colors">
            Show all {allItems.length} neighborhoods ↓
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Featured section — most active, shown at the top */}
          {featured.length > 0 && !activeSide && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs font-bold text-gray-600 uppercase tracking-widest">Happening now</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {featured.map(n => <FeaturedCard key={n.slug} n={n} />)}
              </div>
            </div>
          )}

          {/* Grouped sections */}
          <div className="space-y-5">
            {visibleGroups.map(group => {
              const sec = SIDE_SECTION[group.side] ?? { bg: 'bg-gray-50', border: 'border-gray-100', cardBg: 'bg-white', cardBorder: 'border-gray-100 hover:border-gray-200' }
              return (
                <div key={group.side} className={`${sec.bg} border ${sec.border} rounded-2xl p-5`}>
                  <div className="flex items-center gap-3 mb-4">
                    <span aria-hidden="true" className={`w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0 shadow-sm ${group.color}`}>
                      {group.icon}
                    </span>
                    <h2 className="text-base font-bold text-gray-900 tracking-tight">{group.label}</h2>
                    <span className="text-xs text-gray-400 font-medium ml-auto">
                      {group.items.length} area{group.items.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {group.items.map(n => (
                      <NeighborhoodCard key={n.slug} n={n} cardBg={sec.cardBg} cardBorder={sec.cardBorder} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
