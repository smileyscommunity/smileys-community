'use client'

import { useEffect, useState, useRef, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { loadFailure } from '@/lib/admin/useAdminLoad'

// Post-event survey dashboard. Lives in the Events section of the
// sidebar — surveys are per-event feedback, not moderation actions.
// Auto-filed anomaly Reports continue to live under /admin/moderation
// (Reports tab + "From surveys" filter) where they're triaged.
//
// Two views:
//   - responses (default): per-response stream, useful for triage and
//     reading anomaly notes verbatim.
//   - events: aggregated per event — "this event got N responses,
//     X% would-return, Y anomalies". Mirror of the host-quality card
//     on /admin/users/[id] but event-centric.
//
// Filters: anomaly-only, date range (presets + custom), free-text
// search on anomalyNote, host filter (only hosts with at least one
// surveyed event). Load-more via cursor on createdAt.
//
// CSV export downloads the full filtered response set (capped at
// 5000 server-side). userId never leaves the server — anonymity wedge.

interface HostOption  { id: string; name: string; color: string; profilePhoto: string | null }

interface SurveyResponse {
  id: string; createdAt: string; anomaly: boolean; anomalyNote: string | null; wouldReturn: boolean
  returnDeclineReason: string | null
  event: { id: string; title: string; emoji: string; date: string; hostId: string | null }
}

interface EventAggregate {
  event:             { id: string; title: string; emoji: string; date: string; hostId: string | null }
  responses:         number
  wouldReturnRate:   number | null
  anomalyCount:      number
  eligibleAttendees: number
  responseRate:      number | null
}

interface Last30  { responses: number; wouldReturnRate: number | null; anomalyRate: number | null; anomalies: number; rateTrendPp: number | null }
interface AllTime { responses: number; anomalies: number }

type ViewKey = 'responses' | 'events'

export default function AdminFeedbackPage() {
  return <Suspense><InnerPage /></Suspense>
}

function InnerPage() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()

  // Filter state — initialised from URL so reload + deep links land
  // on the same view.
  const [view,        setView]        = useState<ViewKey>(searchParams.get('view') === 'events' ? 'events' : 'responses')
  const [anomalyOnly, setAnomalyOnly] = useState(searchParams.get('anomalyOnly') === '1')
  const [fromDate,    setFromDate]    = useState(searchParams.get('from')   ?? '')
  const [toDate,      setToDate]      = useState(searchParams.get('to')     ?? '')
  const [searchQ,     setSearchQ]     = useState(searchParams.get('q')      ?? '')
  const [hostId,      setHostId]      = useState(searchParams.get('hostId') ?? '')
  // Debounced search so typing doesn't spam the API.
  const [debouncedQ, setDebouncedQ] = useState(searchParams.get('q') ?? '')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchQ.trim()), 250)
    return () => clearTimeout(t)
  }, [searchQ])

  // Data state.
  const [last30,      setLast30]      = useState<Last30  | null>(null)
  const [allTime,     setAllTime]     = useState<AllTime | null>(null)
  const [hosts,       setHosts]       = useState<HostOption[]>([])
  const [responses,   setResponses]   = useState<SurveyResponse[]>([])
  const [eventsAgg,   setEventsAgg]   = useState<EventAggregate[]>([])
  const [hasMore,     setHasMore]     = useState(false)
  // A failed query used to leave the primer ("no feedback yet") on screen.
  const [loadError,   setLoadError]   = useState<string | null>(null)
  const [nextCursor,  setNextCursor]  = useState<string | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [, setTick] = useState(0)
  // One-off lookup of a recent event for the empty-state preview link.
  const sampleEventIdRef = useRef<string | null>(null)
  const [sampleEventId, setSampleEventId] = useState<string | null>(null)

  // Build the query string for both list + CSV fetches. Each filter
  // is omitted when default so the URL stays clean.
  const buildQs = useCallback((extra: Record<string, string> = {}) => {
    const p = new URLSearchParams()
    p.set('view', view)
    if (anomalyOnly) p.set('anomalyOnly', '1')
    if (fromDate)    p.set('from', fromDate)
    if (toDate)      p.set('to',   toDate)
    if (debouncedQ)  p.set('q',    debouncedQ)
    if (hostId)      p.set('hostId', hostId)
    for (const [k, v] of Object.entries(extra)) p.set(k, v)
    return p.toString()
  }, [view, anomalyOnly, fromDate, toDate, debouncedQ, hostId])

  // Reload from scratch whenever any filter changes. Resets the list
  // (this is a new query, not a continuation).
  const load = useCallback((background = false) => {
    if (!background) setLoading(true)
    fetch(`/app/api/admin/surveys?${buildQs()}`, { credentials: 'include' })
      .then(async r => { if (!r.ok) throw await loadFailure(r); return r.json() })
      .then(d => {
        if (!d) return
        setLoadError(null)
        setLast30(d.last30)
        setAllTime(d.allTime)
        setHosts(d.hosts ?? [])
        if (d.view === 'events') {
          setEventsAgg(Array.isArray(d.events) ? d.events : [])
          setResponses([])
        } else {
          setResponses(Array.isArray(d.recent) ? d.recent : [])
          setEventsAgg([])
        }
        setHasMore(!!d.hasMore)
        setNextCursor(d.nextCursor ?? null)
        setLastRefresh(new Date())
      })
      .catch((e: Error) => setLoadError(e?.message ?? 'Failed to load'))
      .finally(() => { if (!background) setLoading(false) })
  }, [buildQs])

  useEffect(() => {
    load(false)
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => { if (!timer) timer = setInterval(() => { if (!document.hidden) load(true) }, 30_000) }
    const stop  = () => { if (timer) { clearInterval(timer); timer = null } }
    const onVis = () => { if (document.hidden) stop(); else { load(true); start() } }
    start()
    document.addEventListener('visibilitychange', onVis)
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [load])

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // URL-sync. Replace (not push) so the back button stays useful.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (view !== 'responses') params.set('view', view); else params.delete('view')
    if (anomalyOnly)          params.set('anomalyOnly', '1'); else params.delete('anomalyOnly')
    if (fromDate)             params.set('from', fromDate);   else params.delete('from')
    if (toDate)               params.set('to',   toDate);     else params.delete('to')
    if (debouncedQ)           params.set('q',    debouncedQ); else params.delete('q')
    if (hostId)               params.set('hostId', hostId);   else params.delete('hostId')
    const q = params.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, anomalyOnly, fromDate, toDate, debouncedQ, hostId, pathname, router])

  // One-off lookup of a recent event for the empty-state preview link.
  useEffect(() => {
    if (sampleEventIdRef.current) return
    fetch('/app/api/admin/events?status=archived&take=1', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((evs: { id: string }[] | null) => {
        if (Array.isArray(evs) && evs[0]?.id) {
          sampleEventIdRef.current = evs[0].id
          setSampleEventId(evs[0].id)
        }
      })
      .catch(() => {})
  }, [])

  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const extra: Record<string, string> = view === 'responses' && nextCursor ? { cursor: nextCursor } : {}
      const res = await fetch(`/app/api/admin/surveys?${buildQs(extra)}`, { credentials: 'include' })
      if (!res.ok) return
      const d = await res.json()
      if (d.view === 'events') {
        // Events view doesn't paginate today — load-more no-ops.
        setHasMore(!!d.hasMore)
      } else {
        setResponses(prev => [...prev, ...(Array.isArray(d.recent) ? d.recent : [])])
        setHasMore(!!d.hasMore)
        setNextCursor(d.nextCursor ?? null)
      }
    } finally {
      setLoadingMore(false)
    }
  }

  function applyPreset(days: number) {
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const t = new Date()
    const f = new Date(); f.setDate(f.getDate() - days)
    setFromDate(fmt(f)); setToDate(fmt(t))
  }

  function exportCsv() {
    // Open in a new tab so the browser handles the download — saves
    // us a Blob() roundtrip and lets the user keep filtering.
    const qs = buildQs({ format: 'csv' })
    window.open(`/app/api/admin/surveys?${qs}`, '_blank')
  }

  const refreshLabel = (() => {
    if (!lastRefresh) return ''
    const s = Math.floor((Date.now() - lastRefresh.getTime()) / 1000)
    if (s < 5)    return 'Updated just now'
    if (s < 60)   return `Updated ${s}s ago`
    if (s < 3600) return `Updated ${Math.floor(s / 60)}m ago`
    return `Updated ${Math.floor(s / 3600)}h ago`
  })()

  const hasFilters = anomalyOnly || fromDate || toDate || debouncedQ || hostId

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Feedback ✿</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Post-event safety + quality signal{allTime ? ` · ${allTime.responses} response${allTime.responses === 1 ? '' : 's'} all-time` : ''}
          </p>
        </div>
        <button onClick={exportCsv}
          disabled={!last30 || last30.responses === 0}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Export the filtered set as CSV (capped at 5000 rows server-side)">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          Export CSV
        </button>
      </div>

      {/* 30d rollup — ignores active filters by design: this is the
          "is the signal healthy overall?" header, not a filtered view. */}
      <LoadErrorBanner message={loadError} onRetry={() => load(false)} title="Couldn't load feedback" />

      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white">Last 30 days <span className="text-zinc-600 font-normal">· unfiltered</span></h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {loading && !last30 ? 'Loading…'
              : !last30           ? (loadError ? 'Could not load — see above.' : 'Could not load — try refreshing.')
              :                     `${last30.responses} response${last30.responses === 1 ? '' : 's'}`}
            </p>
          </div>
          {last30 && last30.anomalies > 0 && (
            <Link href="/admin/moderation?tab=reports&surveyOnly=1"
              className="text-xs font-bold px-2 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors shrink-0">
              ⚠ {last30.anomalies} flag{last30.anomalies === 1 ? '' : 's'} →
            </Link>
          )}
        </div>
        {/* 2-up on mobile so each tile gets breathing room with the
            text-3xl figure + uppercase label; back to 3 columns at
            sm+ where the row has horizontal space. Responses spans
            both columns on mobile so it fills the orphan slot
            cleanly instead of half-row-stranded. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="Would return" value={last30?.wouldReturnRate ?? null} trendPp={last30?.rateTrendPp ?? null} kind="rate-high-good" />
          <Stat label="Anomaly rate" value={last30?.anomalyRate ?? null}                              kind="rate-low-good"  />
          <Stat label="Responses"    value={last30 ? last30.responses : null}                         kind="raw"
            className="col-span-2 sm:col-span-1" />
        </div>
      </div>

      {/* View toggle + filter bar */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* View toggle */}
          <div className="flex gap-1 bg-zinc-800 rounded-xl p-1 border border-zinc-700">
            {(['responses', 'events'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  view === v ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'
                }`}>
                {v === 'responses' ? 'Responses' : 'Per event'}
              </button>
            ))}
          </div>

          {/* Anomaly toggle */}
          <button onClick={() => setAnomalyOnly(v => !v)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors border ${
              anomalyOnly ? 'bg-red-500/20 text-red-300 border-red-500/40' : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-white'
            }`}>
            ⚠ Anomalies only
          </button>

          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)}
              placeholder="Search anomaly notes…"
              className="w-full pl-8 pr-8 py-1.5 text-xs rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500" />
            {searchQ && (
              <button onClick={() => setSearchQ('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-white" title="Clear search">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>

          {/* Host dropdown — only renders when there's >1 host with data */}
          {hosts.length > 1 && (
            <select value={hostId} onChange={e => setHostId(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-xl bg-zinc-800 border border-zinc-700 text-white focus:outline-none focus:ring-2 focus:ring-amber-500">
              <option value="">All hosts</option>
              {hosts.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          )}
        </div>

        {/* Date range row */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span className="font-semibold">When</span>
          {/* Preset windows. 7d/30d/90d cover the operational triage
              cadence; 180d/365d cover quarterly retrospectives and
              annual reviews where the longer baseline matters for
              comparing host or club performance over time. */}
          {[7, 30, 90, 180, 365].map(d => (
            <button key={d} onClick={() => applyPreset(d)}
              className="px-2 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors">
              {d === 365 ? '1y' : `${d}d`}
            </button>
          ))}
          <span className="text-zinc-700">|</span>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-white focus:outline-none focus:ring-1 focus:ring-amber-500" />
          <span>→</span>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-white focus:outline-none focus:ring-1 focus:ring-amber-500" />
          {hasFilters && (
            <button onClick={() => { setAnomalyOnly(false); setFromDate(''); setToDate(''); setSearchQ(''); setHostId('') }}
              className="text-zinc-500 hover:text-white underline ml-1">clear filters</button>
          )}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <ListSkeleton />
      ) : loadError && responses.length === 0 && eventsAgg.length === 0 ? null : view === 'responses' ? (
        responses.length === 0 ? (
          hasFilters ? (
            <EmptyFiltered onClear={() => { setAnomalyOnly(false); setFromDate(''); setToDate(''); setSearchQ(''); setHostId('') }} />
          ) : (
            <EmptyPrimer sampleEventId={sampleEventId} />
          )
        ) : (
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
            <div className="px-4 sm:px-5 py-3 border-b border-zinc-800 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-white">Recent responses</h3>
                <p className="text-[10px] text-zinc-600 mt-0.5">Responders are anonymous — including to you.</p>
              </div>
              <span className="text-xs text-zinc-500 shrink-0">{responses.length}{hasMore ? '+' : ''} shown</span>
            </div>
            <div className="divide-y divide-zinc-800">
              {responses.map(r => <ResponseRow key={r.id} r={r} />)}
            </div>
            {hasMore && (
              <button onClick={loadMore} disabled={loadingMore}
                className="w-full py-3 text-xs font-semibold border-t border-zinc-800 bg-zinc-800/40 hover:bg-zinc-800 text-zinc-300 disabled:opacity-50 transition-colors">
                {loadingMore ? 'Loading…' : 'Load more →'}
              </button>
            )}
          </div>
        )
      ) : (
        eventsAgg.length === 0 ? (
          hasFilters ? (
            <EmptyFiltered onClear={() => { setAnomalyOnly(false); setFromDate(''); setToDate(''); setSearchQ(''); setHostId('') }} />
          ) : (
            <EmptyPrimer sampleEventId={sampleEventId} />
          )
        ) : (
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
            <div className="px-4 sm:px-5 py-3 border-b border-zinc-800 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-white">Events ranked by recency</h3>
              <span className="text-xs text-zinc-500 shrink-0">{eventsAgg.length} event{eventsAgg.length === 1 ? '' : 's'}</span>
            </div>
            <div className="divide-y divide-zinc-800">
              {eventsAgg.map(row => <EventAggRow key={row.event.id} row={row} />)}
            </div>
          </div>
        )
      )}

      {!loading && refreshLabel && (
        <p className="text-xs text-zinc-600 text-right pt-2">{refreshLabel}</p>
      )}
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────

// Short labels for the "would not return" attribution (returnDeclineReason).
const DECLINE_LABELS: Record<string, string> = {
  host:   'the host',
  guest:  'a guest',
  venue:  'the venue',
  timing: 'timing',
  other:  'other',
}

function ResponseRow({ r }: { r: SurveyResponse }) {
  return (
    <Link href={`/admin/events/${r.event.id}/edit`}
      className="flex items-start gap-3 px-4 sm:px-5 py-3 hover:bg-zinc-800/50 transition-colors">
      <span className="text-lg shrink-0 mt-0.5">{r.event.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-white truncate">{r.event.title}</span>
          <span className="text-[10px] text-zinc-600">{new Date(r.event.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
        </div>
        {r.anomaly && r.anomalyNote && (
          <p className="text-xs text-zinc-300 mt-1 italic leading-snug">"{r.anomalyNote}"</p>
        )}
        <p className="text-[10px] text-zinc-600 mt-1">
          Submitted {new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${r.wouldReturn ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
          {r.wouldReturn ? '✓ would return' : '✕ would not'}
        </span>
        {!r.wouldReturn && r.returnDeclineReason && (
          // Why they wouldn't return — a diagnostic for moderators, not a
          // score input (the host's wouldReturnRate stays raw). 'guest' is
          // highlighted as an attendee-problem signal worth a closer look.
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
              r.returnDeclineReason === 'guest' ? 'bg-amber-500/20 text-amber-300' : 'bg-zinc-800 text-zinc-400'
            }`}
            title={r.returnDeclineReason === 'guest' ? 'Blamed on another attendee — worth a look' : `Reason: ${DECLINE_LABELS[r.returnDeclineReason] ?? r.returnDeclineReason}`}
          >
            {DECLINE_LABELS[r.returnDeclineReason] ?? r.returnDeclineReason}
          </span>
        )}
        {r.anomaly && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400">⚠ flagged</span>
        )}
      </div>
    </Link>
  )
}

function EventAggRow({ row }: { row: EventAggregate }) {
  const r = row
  return (
    <Link href={`/admin/events/${r.event.id}/edit`}
      className="flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-zinc-800/50 transition-colors">
      <span className="text-lg shrink-0">{r.event.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-white truncate">{r.event.title}</span>
          <span className="text-[10px] text-zinc-600">{new Date(r.event.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
        {/* Response rate sits right next to the response count — same
            line gives admins instant context for "trust the signal?"
            without committing screen real-estate to another column. */}
        <p className="text-[10px] text-zinc-600 mt-1">
          {r.responses} response{r.responses === 1 ? '' : 's'}
          {r.responseRate !== null && (
            <> · <span className={
              r.responseRate >= 50 ? 'text-green-400'
                : r.responseRate >= 25 ? 'text-amber-400'
                : 'text-red-400'
            }>{r.responseRate}% rate</span></>
          )}
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {r.anomalyCount > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400">⚠ {r.anomalyCount}</span>
        )}
        <span className={`text-base font-extrabold tabular-nums ${
          r.wouldReturnRate === null   ? 'text-zinc-600'
            : r.wouldReturnRate >= 80 ? 'text-green-400'
            : r.wouldReturnRate >= 60 ? 'text-amber-400'
            :                            'text-red-400'
        }`}>
          {r.wouldReturnRate === null ? '—' : `${r.wouldReturnRate}%`}
        </span>
      </div>
    </Link>
  )
}

function EmptyPrimer({ sampleEventId }: { sampleEventId: string | null }) {
  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-10 text-center">
      <div className="text-3xl mb-2">✿</div>
      <p className="text-zinc-300 text-sm font-medium">No survey responses yet</p>
      <p className="text-zinc-500 text-xs mt-2 max-w-md mx-auto">
        Surveys are dispatched ~24h after an event ends to its approved attendees. Two questions: "Did anything feel off?" + "Would you go again?". Anomaly flags auto-file a Report under <Link href="/admin/moderation" className="text-amber-400 hover:underline">Moderation</Link>.
      </p>
      {sampleEventId && (
        <Link href={`/events/${sampleEventId}/feedback`} target="_blank" rel="noopener noreferrer"
          className="inline-block mt-4 text-xs font-semibold text-amber-400 hover:underline">
          Preview the form attendees see →
        </Link>
      )}
    </div>
  )
}

function EmptyFiltered({ onClear }: { onClear: () => void }) {
  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-10 text-center">
      <div className="text-3xl mb-2">🔎</div>
      <p className="text-zinc-300 text-sm font-medium">No responses match your filters</p>
      <button onClick={onClear} className="inline-block mt-3 text-xs font-semibold text-amber-400 hover:underline">
        Clear filters
      </button>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
      <div className="divide-y divide-zinc-800">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="flex items-start gap-3 px-4 sm:px-5 py-3">
            <div className="w-5 h-5 rounded bg-zinc-800 animate-pulse shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="h-3.5 w-1/2 rounded bg-zinc-800 animate-pulse" />
              <div className="h-3 w-1/3 rounded bg-zinc-800/60 animate-pulse" />
            </div>
            <div className="h-4 w-20 rounded-full bg-zinc-800 animate-pulse shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value, trendPp, kind, className }: {
  label:   string
  value:   number | null
  trendPp?: number | null
  kind:    'rate-high-good' | 'rate-low-good' | 'raw'
  // Forwarded to the wrapper so callers can pass grid spans
  // (e.g. col-span-2 sm:col-span-1 for tiles that should fill the
  // remainder of a 2-col mobile layout).
  className?: string
}) {
  const color = value === null   ? 'text-zinc-600'
    : kind === 'raw'             ? 'text-white'
    : kind === 'rate-high-good'  ? (value >= 80 ? 'text-green-400' : value >= 60 ? 'text-amber-400' : 'text-red-400')
    :                              (value === 0 ? 'text-green-400' : value < 5  ? 'text-amber-400' : 'text-red-400')
  return (
    <div className={className}>
      <div className={`text-2xl sm:text-3xl font-extrabold ${color}`}>
        {value === null ? '—' : kind === 'raw' ? value : `${value}%`}
      </div>
      <div className="text-[10px] sm:text-xs text-zinc-500 mt-0.5 uppercase tracking-wider">{label}</div>
      {trendPp !== null && trendPp !== undefined && trendPp !== 0 && (
        <div className={`text-[10px] mt-1 ${trendPp > 0 ? 'text-green-400' : 'text-red-400'}`}>
          {trendPp > 0 ? '+' : ''}{trendPp}pp vs prior 30d
        </div>
      )}
    </div>
  )
}
