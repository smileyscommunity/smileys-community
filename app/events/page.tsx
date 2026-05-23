'use client'

import { useState, useEffect, useMemo, useRef, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import EventCard from '@/components/EventCard'
import EventCardSkeleton from '@/components/EventCardSkeleton'
import Link from 'next/link'
import type { Event } from '@/lib/data'
import { vibeConfig, todayIstanbul } from '@/lib/data'
import { useAuth } from '@/contexts/AuthContext'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import InviteBanner from '@/components/InviteBanner'

const EventMap = dynamic(() => import('@/components/EventMap'), { ssr: false })

type TimeFilter = 'All' | 'Today' | 'This week' | 'This weekend'
const TIME_FILTERS: TimeFilter[] = ['All', 'Today', 'This week', 'This weekend']

interface TagItem  { id: string; name: string; emoji: string }
interface TagGroup { id: string; name: string; emoji: string; tags: TagItem[] }

function getWeekRange() {
  const now = new Date()
  const day = now.getDay()
  const mon = new Date(now)
  mon.setDate(now.getDate() - ((day + 6) % 7))
  mon.setHours(0, 0, 0, 0)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  sun.setHours(23, 59, 59, 999)
  return { start: mon, end: sun }
}

function getWeekendRange() {
  const now = new Date()
  const day = now.getDay()
  const sat = new Date(now)
  sat.setDate(now.getDate() + ((6 - day + 7) % 7))
  sat.setHours(0, 0, 0, 0)
  const sun = new Date(sat)
  sun.setDate(sat.getDate() + 1)
  sun.setHours(23, 59, 59, 999)
  return { start: sat, end: sun }
}

function GroupDropdown({
  group,
  selectedTags,
  onToggle,
}: {
  group: TagGroup
  selectedTags: string[]
  onToggle: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const activeCount = group.tags.filter(t => selectedTags.includes(t.name)).length

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border-2 transition-colors ${
          activeCount > 0
            ? 'bg-amber-500 text-white border-amber-500'
            : 'bg-white border-gray-200 text-gray-600 hover:border-amber-400 hover:text-amber-600'
        }`}
      >
        <span>{group.emoji}</span>
        <span>{group.name}</span>
        {activeCount > 0 && (
          <span className="bg-white/30 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">
            {activeCount}
          </span>
        )}
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 bg-white border border-gray-200 rounded-2xl shadow-lg p-3 z-20 min-w-[180px]">
          <div className="flex flex-col gap-1.5">
            {group.tags.map(tag => {
              const cfg = vibeConfig[tag.name as keyof typeof vibeConfig]
              const active = selectedTags.includes(tag.name)
              return (
                <button
                  key={tag.id}
                  onClick={() => { onToggle(tag.name); setOpen(false) }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold border transition-all text-left ${
                    active
                      ? cfg
                        ? `${cfg.bg} ${cfg.text} ${cfg.border} border`
                        : 'bg-amber-100 text-amber-700 border-amber-400'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <span>{tag.emoji}</span>
                  <span>{tag.name}</span>
                  {active && <span className="ml-auto text-xs">✓</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

import { neighborhoodToSlug } from '@/lib/neighborhoods'
import AdBannerStrip from '@/components/AdBannerStrip'

type Tab = 'upcoming' | 'past'

const PAGE_SIZE = 24

function AppEventsPageInner() {
  const { user, isLoggedIn } = useAuth()
  const searchParams = useSearchParams()
  const [events,       setEvents]       = useState<Event[]>([])
  const [groups,       setGroups]       = useState<TagGroup[]>([])
  const [attendance,   setAttendance]   = useState<Record<string, 'joined' | 'pending'>>({})
  const [loading,      setLoading]      = useState(true)
  const [loadingMore,  setLoadingMore]  = useState(false)
  const [hasMore,      setHasMore]      = useState(false)
  const [offset,       setOffset]       = useState(0)
  const [tab,               setTab]               = useState<Tab>('upcoming')
  const [timeFilter,        setTimeFilter]        = useState<TimeFilter>('All')
  const [selectedTags,      setSelectedTags]      = useState<string[]>([])
  const [neighborhoodFilter, setNeighborhoodFilter] = useState<string>(() => searchParams.get('neighborhood') ?? '')
  const [hero, setHero] = useState({ badge: 'Istanbul', headline: 'Events', subtitle: 'Find your next experience in Istanbul.' })

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [showMap,         setShowMap]         = useState(false)
  const [goingOnly,       setGoingOnly]       = useState(false)

  const canCreate = isLoggedIn && (user.role === 'admin' || user.isClubHost)
  const today = todayIstanbul()

  async function loadEvents(tab: Tab, reset = false) {
    const currentOffset = reset ? 0 : offset
    const upcoming = tab === 'upcoming' ? '1' : '0'
    const url = `/app/api/events?upcoming=${upcoming}&limit=${PAGE_SIZE}&offset=${currentOffset}`
    const data = await fetch(url, { credentials: 'include' }).then(r => r.json())
    const evts: Event[] = Array.isArray(data.events) ? data.events : []
    setEvents(prev => reset ? evts : [...prev, ...evts])
    setHasMore(data.hasMore ?? false)
    setOffset(currentOffset + evts.length)
  }

  useEffect(() => {
    fetch('/app/api/content').then(r => r.json()).then(d => {
      if (d.events) setHero(h => ({ ...h, ...d.events }))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      loadEvents(tab, true),
      fetch('/app/api/tags').then(r => r.json()),
      fetch('/app/api/events/attending', { credentials: 'include' }).then(r => r.json()),
    ]).then(([, grps, att]) => {
      setGroups(Array.isArray(grps) ? grps : [])
      if (Array.isArray(att)) {
        const map: Record<string, 'joined' | 'pending'> = {}
        att.forEach((a: { eventId: string; status: string }) => {
          map[a.eventId] = a.status === 'approved' ? 'joined' : 'pending'
        })
        setAttendance(map)
      }
    }).finally(() => setLoading(false))
  }, [tab])

  async function handleLoadMore() {
    setLoadingMore(true)
    await loadEvents(tab, false)
    setLoadingMore(false)
  }

  const reload = useCallback(async () => {
    setOffset(0)
    await loadEvents(tab, true)
  }, [tab])

  const { pullY, refreshing, progress } = usePullToRefresh(reload)

  function toggleTag(name: string) {
    setSelectedTags(prev =>
      prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name]
    )
  }

  function clearAll() {
    setTimeFilter('All')
    setSelectedTags([])
    setNeighborhoodFilter('')
  }

  const filtered = useMemo(() => {
    let result = [...events]

    if (timeFilter === 'Today') {
      const todayStr = todayIstanbul()
      result = result.filter(e => e.date === todayStr)
    } else if (timeFilter === 'This week') {
      const { start, end } = getWeekRange()
      result = result.filter(e => { const d = new Date(e.date); return d >= start && d <= end })
    } else if (timeFilter === 'This weekend') {
      const { start, end } = getWeekendRange()
      result = result.filter(e => { const d = new Date(e.date); return d >= start && d <= end })
    }

    if (selectedTags.length > 0) {
      result = result.filter(e => e.vibes.some(v => selectedTags.includes(v)))
    }

    if (neighborhoodFilter) {
      result = result.filter(e => e.neighborhood === neighborhoodFilter)
    }

    if (goingOnly) {
      result = result.filter(e => !!attendance[e.id])
    }

    return result
  }, [events, timeFilter, selectedTags, neighborhoodFilter, goingOnly, attendance])

  const hasActiveFilters = timeFilter !== 'All' || selectedTags.length > 0 || !!neighborhoodFilter || goingOnly

  const neighborhoodOptions = useMemo(() => {
    const seen = new Set<string>()
    events.forEach(e => { if (e.neighborhood) seen.add(e.neighborhood) })
    return Array.from(seen).sort()
  }, [events])

  return (
    <div className="min-h-screen bg-warm pb-20 md:pb-0">
      {/* Pull-to-refresh indicator */}
      <div
        className="flex items-center justify-center overflow-hidden transition-all duration-200"
        style={{ height: pullY > 0 || refreshing ? `${Math.max(pullY, refreshing ? 48 : 0)}px` : 0 }}
      >
        <div
          className={`w-8 h-8 rounded-full border-2 border-amber-500 border-t-transparent ${refreshing ? 'animate-spin' : ''}`}
          style={{ opacity: progress, transform: `rotate(${progress * 180}deg) scale(${0.5 + progress * 0.5})` }}
        />
      </div>

      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-0">
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">{hero.badge}</span>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">{hero.headline}</h1>
              <p className="text-base text-gray-500 mt-1">{hero.subtitle}</p>
            </div>
            <div className="flex items-center gap-3">
              {/* List / Map toggle — desktop only */}
              {tab === 'upcoming' && isLoggedIn && (
                <button
                  onClick={() => setShowMap(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-colors border ${
                    showMap ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:border-amber-400 hover:text-amber-600'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 13l4.553 2.276A1 1 0 0021 21.382V10.618a1 1 0 00-.553-.894L15 7m0 13V7m0 0L9 7" />
                  </svg>
                  {showMap ? 'Hide Map' : 'Map'}
                </button>
              )}
              {canCreate && (
                <Link
                  href={user.role === 'admin' ? '/admin/events/new' : '/host/events/new'}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create Event
                </Link>
              )}
            </div>
          </div>

          <AdBannerStrip page="events" />

          {/* Upcoming / Past tabs */}
          <div className="flex items-center gap-2 pb-4 pt-2">
            {(['upcoming', 'past'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setTimeFilter('All'); setSelectedTags([]); setOffset(0); setGoingOnly(false) }}
                className={`px-4 py-2 text-sm font-semibold rounded-full transition-colors ${
                  tab === t
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-800'
                }`}
              >
                {t === 'upcoming' ? 'Upcoming' : 'Past'}
              </button>
            ))}
            {!loading && filtered.length > 0 && (
              <span className="ml-auto text-xs text-gray-400 font-medium">
                {filtered.length} event{filtered.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Combined filter bar — only for upcoming */}
        {tab === 'upcoming' && (
          <div className="flex items-center gap-2 mb-3 overflow-x-auto scrollbar-none pb-1">
            {/* Going filter — logged in only */}
            {isLoggedIn && (
              <>
                <button
                  onClick={() => setGoingOnly(v => !v)}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    goingOnly
                      ? 'bg-green-500 text-white border-green-500'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-green-400 hover:text-green-600'
                  }`}
                >
                  ✓ Going
                </button>
                <span className="text-gray-200 shrink-0 select-none">|</span>
              </>
            )}
            {/* Time filters */}
            {TIME_FILTERS.filter(f => f !== 'All').map(f => (
              <button
                key={f}
                onClick={() => setTimeFilter(prev => prev === f ? 'All' : f)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  timeFilter === f
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-600'
                }`}
              >
                {f}
              </button>
            ))}

            {/* Divider */}
            {neighborhoodOptions.length > 0 && (
              <span className="text-gray-200 shrink-0 select-none">|</span>
            )}

            {/* Neighborhood filters */}
            {neighborhoodOptions.map(n => (
              <button
                key={n}
                onClick={() => setNeighborhoodFilter(prev => prev === n ? '' : n)}
                className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  neighborhoodFilter === n
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-600'
                }`}
              >
                <span className="opacity-70">📍</span>
                {n}
              </button>
            ))}
          </div>
        )}

        {/* Tag group dropdowns */}
        {groups.length > 0 && tab === 'upcoming' && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {groups.map(group => (
              <GroupDropdown
                key={group.id}
                group={group}
                selectedTags={selectedTags}
                onToggle={toggleTag}
              />
            ))}
          </div>
        )}

        {/* Active filter chips */}
        <AnimatePresence>
          {hasActiveFilters && tab === 'upcoming' && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide shrink-0">
                  Active filters:
                </span>

                {/* Time filter chip */}
                {timeFilter !== 'All' && (
                  <button
                    onClick={() => setTimeFilter('All')}
                    className="flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200 hover:bg-amber-200 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {timeFilter}
                    <svg className="w-3 h-3 ml-0.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}

                {/* Neighborhood chip */}
                {neighborhoodFilter && (
                  <button
                    onClick={() => setNeighborhoodFilter('')}
                    className="flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200 hover:bg-amber-200 transition-colors"
                  >
                    📍 {neighborhoodFilter}
                    <svg className="w-3 h-3 ml-0.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}

                {/* Vibe chips */}
                {selectedTags.map(tag => {
                  const cfg = vibeConfig[tag as keyof typeof vibeConfig]
                  return (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={`flex items-center gap-1 pl-2.5 pr-2 py-1 rounded-full text-xs font-semibold border hover:opacity-80 transition-opacity ${
                        cfg ? `${cfg.bg} ${cfg.text} ${cfg.border}` : 'bg-gray-100 text-gray-600 border-gray-300'
                      }`}
                    >
                      {cfg?.emoji} {tag}
                      <svg className="w-3 h-3 ml-0.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )
                })}

                <button
                  onClick={clearAll}
                  className="text-xs text-gray-400 hover:text-gray-700 font-medium transition-colors ml-1"
                >
                  Clear all
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => <EventCardSkeleton key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 max-w-sm mx-auto">
            <div className="text-6xl mb-4">{neighborhoodFilter && !selectedTags.length && timeFilter === 'All' ? '📍' : '🔍'}</div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              {neighborhoodFilter && !selectedTags.length && timeFilter === 'All'
                ? `No events in ${neighborhoodFilter} right now`
                : 'No events match your filters'}
            </h3>
            {neighborhoodFilter && !selectedTags.length && timeFilter === 'All' && (
              <p className="text-sm text-gray-500 mb-4">Check back soon — new events are added regularly.</p>
            )}
            <div className="flex flex-col gap-2 mb-6">
              {neighborhoodFilter && !selectedTags.length && timeFilter === 'All' && (
                <button onClick={() => setNeighborhoodFilter('')}
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors">
                  See all events
                </button>
              )}
              {timeFilter !== 'All' && (
                <button onClick={() => setTimeFilter('All')}
                  className="flex items-center justify-between px-4 py-2.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl text-sm text-amber-700 transition-colors">
                  <span>Remove <strong>"{timeFilter}"</strong> time filter</span>
                  <span className="text-amber-400">✕</span>
                </button>
              )}
              {selectedTags.map(tag => (
                <button key={tag} onClick={() => setSelectedTags(prev => prev.filter(t => t !== tag))}
                  className="flex items-center justify-between px-4 py-2.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl text-sm text-amber-700 transition-colors">
                  <span>Remove <strong>"{tag}"</strong> tag</span>
                  <span className="text-amber-400">✕</span>
                </button>
              ))}
              {neighborhoodFilter && (
                <button onClick={() => setNeighborhoodFilter('')}
                  className="flex items-center justify-between px-4 py-2.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl text-sm text-amber-700 transition-colors">
                  <span>Remove <strong>"{neighborhoodFilter}"</strong> neighborhood</span>
                  <span className="text-amber-400">✕</span>
                </button>
              )}
            </div>
            <button onClick={clearAll}
              className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold rounded-xl transition-colors">
              Clear all filters
            </button>
          </div>
        ) : (
          <>
            {/* Full-width map — toggled by Map button */}
            {isLoggedIn && showMap && (
              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm mb-6" style={{ height: 480 }}>
                <EventMap
                  events={filtered}
                  selectedId={selectedEventId}
                  onSelect={id => setSelectedEventId(prev => prev === id ? null : id)}
                  attendance={attendance}
                />
              </div>
            )}

            {/* Card grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {filtered.map(event => (
                <EventCard key={event.id} event={event} linkPrefix="/events" initialStatus={attendance[event.id] ?? null} />
              ))}
            </div>
            {isLoggedIn && events.length > 0 && (
              <div className="mt-8 px-1">
                <InviteBanner variant="strip" />
              </div>
            )}

            {hasMore && !loadingMore && filtered.length === events.length && (
              <div className="flex justify-center mt-10">
                <button
                  onClick={handleLoadMore}
                  className="px-8 py-3 rounded-2xl bg-white border-2 border-gray-200 text-gray-600 font-semibold text-sm hover:border-amber-400 hover:text-amber-600 transition-colors"
                >
                  Load more events
                </button>
              </div>
            )}
            {loadingMore && (
              <div className="flex justify-center mt-10">
                <div className="text-gray-400 text-sm">Loading…</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function AppEventsPage() {
  return (
    <Suspense>
      <AppEventsPageInner />
    </Suspense>
  )
}
