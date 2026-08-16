'use client'

import { useState, useEffect, useMemo, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import EventCard from '@/components/EventCard'
import EventCardSkeleton from '@/components/EventCardSkeleton'
import Link from 'next/link'
import type { Event } from '@/lib/data'
import { vibeConfig, todayIstanbul } from '@/lib/data'
import { useAuth } from '@/contexts/AuthContext'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import InviteBanner from '@/components/InviteBanner'
import EventDiscovery from './EventDiscovery'

const EventMap = dynamic(() => import('@/components/EventMap'), { ssr: false })

type TimeFilter = 'All' | 'Today' | 'Tomorrow' | 'This week' | 'This weekend'
// §5 — time is the primary discovery model, so the chips lead with the
// nearest horizons. 'All' moves to the end: browsing everything is the
// fallback, not the default intent.
const TIME_FILTERS: TimeFilter[] = ['Today', 'Tomorrow', 'This week', 'This weekend', 'All']

interface TagItem  { id: string; name: string; emoji: string }
interface TagGroup { id: string; name: string; emoji: string; tags: TagItem[] }

interface HangoutSummary {
  id:           string
  neighborhood: string | null
}

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

import AdBannerStrip from '@/components/AdBannerStrip'

type Tab = 'upcoming' | 'past'

const PAGE_SIZE = 24

function AppEventsPageInner() {
  const { user, isLoggedIn } = useAuth()
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()

  // Filter state is mirrored to/from the URL so back/forward and refresh
  // preserve what the user picked, and a filtered events URL is shareable.
  // Initial values come from the URL; later changes get written back via
  // the effect below.
  const [events,       setEvents]       = useState<Event[]>([])
  const [groups,       setGroups]       = useState<TagGroup[]>([])
  const [attendance,   setAttendance]   = useState<Record<string, 'joined' | 'pending' | 'waitlisted'>>({})
  const [loading,      setLoading]      = useState(true)
  const [loadingMore,  setLoadingMore]  = useState(false)
  const [hasMore,      setHasMore]      = useState(false)
  const [offset,       setOffset]       = useState(0)
  const [tab,          setTab]          = useState<Tab>(() =>
    searchParams.get('tab') === 'past' ? 'past' : 'upcoming'
  )
  const [timeFilter,   setTimeFilter]   = useState<TimeFilter>(() => {
    const v = searchParams.get('time')
    return TIME_FILTERS.includes(v as TimeFilter) ? (v as TimeFilter) : 'All'
  })
  const [selectedTags, setSelectedTags] = useState<string[]>(() => {
    const v = searchParams.get('tags')
    return v ? v.split(',').filter(Boolean) : []
  })
  const [neighborhoodFilter, setNeighborhoodFilter] = useState<string>(() => searchParams.get('neighborhood') ?? '')
  const [goingOnly,    setGoingOnly]    = useState(() => searchParams.get('going') === '1')
  // CMS overrides land in this state on mount via /api/content. Defaults
  // are the fallback when the CMS hasn't been configured.
  const [hero, setHero] = useState({ badge: 'Istanbul', headline: "Events", subtitle: 'Find your next experience in Istanbul.' })
  // The city this calendar resolved to, from /api/events (the view-city
  // cookie makes it vary per viewer). Separate from `hero` so the CMS
  // fetch — whose copy is default-city-flavored — can't race it back to
  // Istanbul. Only a non-default city overrides the hero.
  const [viewCity, setViewCity] = useState<{ name: string; slug: string; isDefault: boolean; viewing?: boolean; homeName?: string | null } | null>(null)
  const cityHero = viewCity && !viewCity.isDefault ? viewCity : null

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [showMap,         setShowMap]         = useState(false)
  const [showFilterSheet, setShowFilterSheet] = useState(false)
  const [hangouts,        setHangouts]        = useState<HangoutSummary[]>([])

  // Mirror filter state to the URL on every change. Defaults are omitted
  // from the querystring so a "clean" URL means "all defaults".
  useEffect(() => {
    const params = new URLSearchParams()
    if (tab !== 'upcoming')        params.set('tab',          tab)
    if (timeFilter !== 'All')      params.set('time',         timeFilter)
    if (selectedTags.length > 0)   params.set('tags',         selectedTags.join(','))
    if (neighborhoodFilter)        params.set('neighborhood', neighborhoodFilter)
    if (goingOnly)                 params.set('going',        '1')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [tab, timeFilter, selectedTags, neighborhoodFilter, goingOnly, router, pathname])

  const canCreate = user.role === 'admin' || user.isClubHost
  const today = todayIstanbul()

  async function loadEvents(tab: Tab, reset = false) {
    const currentOffset = reset ? 0 : offset
    const upcoming = tab === 'upcoming' ? '1' : '0'
    const url = `/app/api/events?upcoming=${upcoming}&limit=${PAGE_SIZE}&offset=${currentOffset}`
    // Fail soft: a dropped fetch on a flaky mobile connection would otherwise
    // reject the caller's Promise.all with an uncaught "Load failed" (the #1
    // iOS error) and leave the load-more spinner stuck. Keep the current list.
    try {
      const data = await fetch(url, { credentials: 'include' }).then(r => r.json())
      const evts: Event[] = Array.isArray(data.events) ? data.events : []
      setEvents(prev => reset ? evts : [...prev, ...evts])
      setHasMore(data.hasMore ?? false)
      setOffset(currentOffset + evts.length)
      if (data.city) setViewCity(data.city)
    } catch { /* transient — user can pull-to-refresh or retry load-more */ }
  }

  // One-shot mount fetches that don't depend on tab: hero copy from the
  // CMS + live hangouts. Batched in a single Promise.all so React can
  // commit both setStates in one render instead of two sequential ones.
  // /api/hangouts is member-only — skip it for guests rather than eat a
  // 401 on every public-page load.
  useEffect(() => {
    Promise.all([
      fetch('/app/api/content').then(r => r.json()).catch(() => null),
      isLoggedIn
        ? fetch('/app/api/hangouts', { credentials: 'include' }).then(r => r.json()).catch(() => null)
        : Promise.resolve(null),
    ]).then(([content, hg]) => {
      if (content?.events)             setHero(h => ({ ...h, ...content.events }))
      if (Array.isArray(hg?.hangouts)) setHangouts(hg.hangouts)
    })
  }, [isLoggedIn])

  useEffect(() => {
    setLoading(true)
    // /api/events/attending is member-only — skip for guests rather than
    // 401 on every page load. Guests see an empty attendance map, which
    // collapses the "Going" filter to a no-op and renders cards without
    // the joined/pending pill.
    Promise.all([
      loadEvents(tab, true),
      fetch('/app/api/tags').then(r => r.json()).catch(() => []),
      isLoggedIn
        ? fetch('/app/api/events/attending', { credentials: 'include' }).then(r => r.json()).catch(() => [])
        : Promise.resolve([]),
    ]).then(([, grps, att]) => {
      setGroups(Array.isArray(grps) ? grps : [])
      if (Array.isArray(att)) {
        const map: Record<string, 'joined' | 'pending' | 'waitlisted'> = {}
        att.forEach((a: { eventId: string; status: string }) => {
          // /events/attending returns approved | pending | waitlisted —
          // the old two-way mapping mislabeled waitlisted as pending.
          map[a.eventId] = a.status === 'approved' ? 'joined'
                         : a.status === 'waitlisted' ? 'waitlisted'
                         : 'pending'
        })
        setAttendance(map)
      }
    }).finally(() => setLoading(false))
  }, [tab, isLoggedIn])

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

  // Apply every active filter EXCEPT neighborhood. This intermediate
  // result drives the per-neighborhood counts used to dim/disable chips
  // that have zero matches under the user's current filters — so picking
  // a vibe doesn't sneakily make a neighborhood look "empty" when it
  // really has events that just don't match the vibe.
  const filteredWithoutNeighborhood = useMemo(() => {
    let result = events

    if (timeFilter === 'Today') {
      const todayStr = todayIstanbul()
      result = result.filter(e => e.date === todayStr)
    } else if (timeFilter === 'Tomorrow') {
      // todayIstanbul(offsetDays) keeps this on the Istanbul calendar
      // day rather than the browser's.
      const tomorrowStr = todayIstanbul(1)
      result = result.filter(e => e.date === tomorrowStr)
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

    if (goingOnly) {
      result = result.filter(e => !!attendance[e.id])
    }

    return result
  }, [events, timeFilter, selectedTags, goingOnly, attendance])

  const filtered = useMemo(() => {
    return neighborhoodFilter
      ? filteredWithoutNeighborhood.filter(e => e.neighborhood === neighborhoodFilter)
      : filteredWithoutNeighborhood
  }, [filteredWithoutNeighborhood, neighborhoodFilter])

  // Partition the filtered list into a featured spotlight row + the
  // rest of the grid, so the grid stops reading as one uniform block.
  // Only applied on the upcoming tab — featured is forward-looking.
  // Capped at 4 so featured doesn't crowd out the main grid.
  const featuredFiltered = useMemo(
    () => tab === 'upcoming' ? filtered.filter(e => e.featured).slice(0, 4) : [],
    [filtered, tab]
  )
  const featuredIds = useMemo(() => new Set(featuredFiltered.map(e => e.id)), [featuredFiltered])
  const restFiltered = useMemo(
    () => featuredFiltered.length > 0 ? filtered.filter(e => !featuredIds.has(e.id)) : filtered,
    [filtered, featuredFiltered.length, featuredIds]
  )

  const hasActiveFilters = timeFilter !== 'All' || selectedTags.length > 0 || !!neighborhoodFilter || goingOnly

  // Number of filters active inside the sheet (going stays out of the
  // sheet — it's an inline one-tap toggle).
  const sheetFilterCount = (timeFilter !== 'All' ? 1 : 0) + selectedTags.length + (neighborhoodFilter ? 1 : 0)

  const neighborhoodOptions = useMemo(() => {
    const seen = new Set<string>()
    events.forEach(e => { if (e.neighborhood) seen.add(e.neighborhood) })
    return Array.from(seen).sort()
  }, [events])

  // Per-neighborhood counts under the other active filters. A chip with
  // 0 matches gets dimmed + disabled — the user sees the chip exists but
  // knows clicking it would empty the grid.
  const neighborhoodCounts = useMemo(() => {
    const counts = new Map<string, number>()
    filteredWithoutNeighborhood.forEach(e => {
      if (e.neighborhood) counts.set(e.neighborhood, (counts.get(e.neighborhood) ?? 0) + 1)
    })
    return counts
  }, [filteredWithoutNeighborhood])

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
              <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">🗓️ {cityHero ? cityHero.name : hero.badge}</span>
              {/* The view-city cookie lives a year — without a visible way
                  out, one click into another city pins every feed there. */}
              {viewCity?.viewing && viewCity.homeName && (
                // eslint-disable-next-line @next/next/no-html-link-for-pages -- route handler that must run server-side to clear the cookie; <Link> would client-navigate past it
                <a href="/app/api/city/enter?clear=1&to=events"
                  className="inline-flex items-center gap-1.5 ml-2 mb-3 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors">
                  ✕ Back to {viewCity.homeName}
                </a>
              )}
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">{hero.headline}</h1>
              <p className="text-base text-gray-600 mt-1">{cityHero ? `Find your next experience in ${cityHero.name}.` : hero.subtitle}</p>
            </div>
            <div className="flex items-center gap-3">
              {/* List / Map toggle — hidden on past-events tab since the
                  map only visualises upcoming locations. */}
              {tab === 'upcoming' && (
                <button
                  onClick={() => setShowMap(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors border ${
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

          {/* Active hangouts strip */}
          {hangouts.length > 0 && (
            <Link href="/hangouts" className="block mt-3 group">
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-3 hover:from-amber-100 hover:to-orange-100 transition-colors">
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                  <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">Live</span>
                </div>
                <p className="text-sm text-amber-900 flex-1 truncate">
                  <strong>{hangouts.length}</strong> hangout{hangouts.length !== 1 ? 's' : ''} happening now
                  {hangouts[0]?.neighborhood && (
                    <span className="text-amber-700 font-normal"> · starting in {hangouts[0].neighborhood}</span>
                  )}
                </p>
                <span className="text-xs font-bold text-amber-600 shrink-0 group-hover:translate-x-0.5 transition-transform">See all →</span>
              </div>
            </Link>
          )}

          {/* Upcoming / Past tabs */}
          <div className="flex items-center gap-2 pb-4 pt-2">
            {(['upcoming', 'past'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setTimeFilter('All'); setSelectedTags([]); setOffset(0); setGoingOnly(false) }}
                className={`px-4 py-2 text-sm font-semibold rounded-full transition-colors ${
                  tab === t
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-800'
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

          {/* §5 — time is the primary discovery model, so the chips sit
              directly under the header rather than buried in the filter
              sheet (where they still live for the advanced case).
              Horizontally scrollable on mobile. */}
          <div className="flex gap-2 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide" role="group" aria-label="Filter events by time">
            {TIME_FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setTimeFilter(f)}
                aria-pressed={timeFilter === f}
                className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold border whitespace-nowrap transition-all ${
                  timeFilter === f
                    ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300 hover:text-amber-600'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Filter trigger row — collapses time/neighborhood/vibes into one
            Filters button (sheet below) so the chrome stays one row tall
            on every viewport. Going stays inline because it's a single-tap
            commit/uncommit, not a filter-pick. */}
        {tab === 'upcoming' && (
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setGoingOnly(v => !v)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                goingOnly
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-600'
              }`}
            >
              ✓ Going
            </button>
            <button
              onClick={() => setShowFilterSheet(true)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                sheetFilterCount > 0
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-600'
              }`}
              aria-haspopup="dialog"
              aria-expanded={showFilterSheet}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filters
              {sheetFilterCount > 0 && (
                <span className="bg-white/30 text-white text-[10px] font-bold rounded-full min-w-4 h-4 px-1 flex items-center justify-center">
                  {sheetFilterCount}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Active filter chips. Was a framer-motion AnimatePresence; now
            a plain CSS `transition-all` on max-height + opacity + margin,
            since framer is overkill for "row of pills fades in/out".
            max-h-40 (160px) fits ~3 lines of wrapped chips; if you ever
            blow past that, the row clips silently rather than crashing.
            aria-hidden keeps the row out of the SR rotor when collapsed. */}
        {(() => {
          const visible = hasActiveFilters && tab === 'upcoming'
          return (
            <div
              aria-hidden={!visible}
              className={`overflow-hidden transition-all duration-200 ${
                visible ? 'max-h-40 opacity-100 mb-6' : 'max-h-0 opacity-0 mb-0'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide shrink-0">
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
            </div>
          )
        })()}

        {/* §55 — personalized rows lead: your next event, coming up, this
            weekend, from your clubs, near you, try something new. Hidden
            while a filter or the past tab is active: the member is
            answering a specific question then, not browsing. */}
        {tab === 'upcoming' && timeFilter === 'All' && selectedTags.length === 0
          && !neighborhoodFilter && !goingOnly && !showMap && (
          <EventDiscovery />
        )}

        {/* Everything below is the full feed — the layer beneath
            personalized discovery. */}
        {tab === 'upcoming' && timeFilter === 'All' && selectedTags.length === 0
          && !neighborhoodFilter && !goingOnly && !showMap && !loading && (
          <div className="mb-4 pt-2 border-t border-gray-100">
            <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-gray-900 mt-6">All upcoming events</h2>
            <p className="text-sm text-gray-600 mt-0.5">Everything on the calendar — filter by time, area or vibe above.</p>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => <EventCardSkeleton key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 max-w-sm mx-auto">
            <div className="text-6xl mb-4">{neighborhoodFilter && !selectedTags.length && timeFilter === 'All' ? '📍' : '🔍'}</div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">
              {timeFilter === 'Today' || timeFilter === 'Tomorrow'
                ? `Nothing scheduled ${timeFilter.toLowerCase()}.`
                : neighborhoodFilter && !selectedTags.length && timeFilter === 'All'
                ? `No events in ${neighborhoodFilter} right now`
                : 'No events match your filters'}
            </h2>
            {/* §61 — an empty day isn't a dead end: Istanbul isn't
                standing still, and Hangouts is the spontaneous layer. */}
            {(timeFilter === 'Today' || timeFilter === 'Tomorrow') && (
              <div className="mb-5">
                <p className="text-sm text-gray-600 mb-3">But {cityHero?.name ?? 'Istanbul'} isn&apos;t exactly standing still.</p>
                <Link href="/hangouts"
                  className="inline-block px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
                  See hangouts happening now →
                </Link>
              </div>
            )}
            {neighborhoodFilter && !selectedTags.length && timeFilter === 'All' && (
              <p className="text-sm text-gray-600 mb-4">Check back soon — new events are added regularly.</p>
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
                  className="flex items-center justify-between px-4 py-2.5 bg-amber-100 hover:bg-amber-200 border border-amber-200 rounded-xl text-sm text-amber-700 transition-colors">
                  <span>Remove <strong>"{timeFilter}"</strong> time filter</span>
                  <span className="text-amber-400">✕</span>
                </button>
              )}
              {selectedTags.map(tag => (
                <button key={tag} onClick={() => setSelectedTags(prev => prev.filter(t => t !== tag))}
                  className="flex items-center justify-between px-4 py-2.5 bg-amber-100 hover:bg-amber-200 border border-amber-200 rounded-xl text-sm text-amber-700 transition-colors">
                  <span>Remove <strong>"{tag}"</strong> tag</span>
                  <span className="text-amber-400">✕</span>
                </button>
              ))}
              {neighborhoodFilter && (
                <button onClick={() => setNeighborhoodFilter('')}
                  className="flex items-center justify-between px-4 py-2.5 bg-amber-100 hover:bg-amber-200 border border-amber-200 rounded-xl text-sm text-amber-700 transition-colors">
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
            {showMap && (
              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm mb-6" style={{ height: 480 }}>
                <EventMap
                  events={filtered}
                  selectedId={selectedEventId}
                  onSelect={id => setSelectedEventId(prev => prev === id ? null : id)}
                  attendance={attendance}
                />
              </div>
            )}

            {/* Featured spotlight row — only when there's at least one
                featured event matching the user's filters. Same EventCard
                so the visual language is consistent; what changes is the
                section label and the fact that featured events get
                surfaced above the main grid instead of being scattered
                inside it. */}
            {featuredFiltered.length > 0 && (
              <section className="mb-8">
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-bold text-amber-700 uppercase tracking-widest">★ Featured</h2>
                  <div className="flex-1 h-px bg-amber-200/60" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                  {featuredFiltered.map(event => (
                    <EventCard key={event.id} event={event} linkPrefix="/events" initialStatus={attendance[event.id] ?? null} />
                  ))}
                </div>
              </section>
            )}

            {/* Main card grid — excludes featured events when the spotlight
                row above is visible (no duplication). */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {restFiltered.map(event => (
                <EventCard key={event.id} event={event} linkPrefix="/events" initialStatus={attendance[event.id] ?? null} />
              ))}
            </div>

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

            {/* Invite banner — moved below "Load more" so it doesn't break
                the card-grid → load-more reading rhythm. Lives at the
                very bottom of the page now.
                Guests see an Apply CTA instead — they need to join Smileys
                first before they can invite anyone else. */}
            {events.length > 0 && (
              <div className="mt-10 px-1">
                {isLoggedIn ? (
                  <InviteBanner variant="strip" />
                ) : (
                  <Link href="/apply" className="group block">
                    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500 to-orange-400 px-5 py-4 flex items-center justify-between gap-4">
                      <div className="absolute -top-4 -right-4 w-24 h-24 rounded-full bg-white/10" />
                      <div className="absolute -bottom-6 right-12 w-16 h-16 rounded-full bg-white/10" />
                      <div className="relative z-10 flex items-center gap-3">
                        <span className="text-2xl">✨</span>
                        <div>
                          <p className="text-sm font-bold text-white leading-tight">Want to join these events?</p>
                          <p className="text-xs text-amber-100 mt-0.5">Apply to Smileys — it's free</p>
                        </div>
                      </div>
                      <span className="relative z-10 shrink-0 text-xs font-bold text-white bg-white/20 group-hover:bg-white/30 transition-colors px-3 py-1.5 rounded-full">
                        Apply →
                      </span>
                    </div>
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Filter sheet — bottom sheet on mobile (items-end), centered modal
          on desktop (sm:items-center). Changes apply live (no staged
          state), so closing the sheet just dismisses; the grid behind
          has already updated. */}
      {showFilterSheet && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Filter events"
        >
          <button
            type="button"
            onClick={() => setShowFilterSheet(false)}
            aria-label="Close filters"
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <div className="relative bg-white w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl shadow-xl">
            <div className="sticky top-0 bg-white flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Filters</h2>
              <button
                type="button"
                onClick={() => setShowFilterSheet(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                aria-label="Close filters"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-5 py-4 space-y-6">
              {/* Time */}
              <section>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Time</h3>
                <div className="flex flex-wrap gap-2">
                  {TIME_FILTERS.filter(f => f !== 'All').map(f => (
                    <button
                      key={f}
                      onClick={() => setTimeFilter(prev => prev === f ? 'All' : f)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        timeFilter === f
                          ? 'bg-amber-500 text-white border-amber-500'
                          : 'bg-white border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-600'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </section>

              {/* Neighborhood */}
              {neighborhoodOptions.length > 0 && (
                <section>
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Neighborhood</h3>
                  <div className="flex flex-wrap gap-2">
                    {neighborhoodOptions.map(n => {
                      const count    = neighborhoodCounts.get(n) ?? 0
                      const isActive = neighborhoodFilter === n
                      const isEmpty  = count === 0 && !isActive
                      return (
                        <button
                          key={n}
                          onClick={() => setNeighborhoodFilter(prev => prev === n ? '' : n)}
                          disabled={isEmpty}
                          title={isEmpty ? 'No events in this neighborhood under your current filters' : undefined}
                          className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                            isActive
                              ? 'bg-amber-500 text-white border-amber-500'
                              : isEmpty
                                ? 'bg-white border-gray-100 text-gray-300 cursor-not-allowed'
                                : 'bg-white border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-600'
                          }`}
                        >
                          <span className={isEmpty ? 'opacity-30' : 'opacity-70'}>📍</span>
                          {n}
                        </button>
                      )
                    })}
                  </div>
                </section>
              )}

              {/* Vibes — tag groups become subsections in the sheet (no
                  more nested dropdowns; the sheet has the room). */}
              {groups.length > 0 && (
                <section>
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Vibes</h3>
                  <div className="space-y-4">
                    {groups.map(group => (
                      <div key={group.id}>
                        <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                          <span>{group.emoji}</span>
                          <span>{group.name}</span>
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {group.tags.map(tag => {
                            const cfg    = vibeConfig[tag.name as keyof typeof vibeConfig]
                            const active = selectedTags.includes(tag.name)
                            return (
                              <button
                                key={tag.id}
                                onClick={() => toggleTag(tag.name)}
                                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                                  active
                                    ? cfg
                                      ? `${cfg.bg} ${cfg.text} ${cfg.border}`
                                      : 'bg-amber-100 text-amber-700 border-amber-400'
                                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                                }`}
                              >
                                <span>{tag.emoji}</span>
                                <span>{tag.name}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {sheetFilterCount > 0 && (
              <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex items-center justify-between">
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-sm text-gray-500 hover:text-gray-800 font-medium transition-colors"
                >
                  Clear all
                </button>
                <button
                  type="button"
                  onClick={() => setShowFilterSheet(false)}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
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
