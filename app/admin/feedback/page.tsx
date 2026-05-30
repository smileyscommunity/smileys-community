'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'

// Post-event survey dashboard. Lives in the Events section of the
// sidebar — surveys are per-event feedback, not moderation actions.
// Auto-filed anomaly Reports continue to live under /admin/moderation
// (Reports tab + "From surveys" filter) where they're triaged.
//
// What's here:
//   - 30d rollup tile (would-return %, anomaly %, response count) with
//     a percentage-points trend vs prior 30d.
//   - Recent 50 responses with event context. anomalyNote rendered
//     verbatim. userId is never returned by the API so admins can
//     triage anonymously — the survey's whole wedge.
//   - Empty-state primer so the page renders something useful before
//     the first response lands.

interface SurveyResponse {
  id: string; createdAt: string; anomaly: boolean; anomalyNote: string | null; wouldReturn: boolean
  event: { id: string; title: string; emoji: string; date: string; hostId: string | null }
}

interface SurveyData {
  last30:  { responses: number; wouldReturnRate: number | null; anomalyRate: number | null; anomalies: number; rateTrendPp: number | null }
  allTime: { responses: number; anomalies: number }
  recent:  SurveyResponse[]
}

export default function AdminFeedbackPage() {
  const [data,        setData]        = useState<SurveyData | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  // 1s tick so the "Updated Xs ago" label ages without refetching.
  const [, setTick] = useState(0)
  // Sample event id for the "Preview the form" link in the empty
  // state — the API returns recent events along with responses, but
  // the empty state happens precisely when there are no responses
  // yet, so we look up a recent past event separately.
  const sampleEventIdRef = useRef<string | null>(null)
  const [sampleEventId, setSampleEventId] = useState<string | null>(null)

  function load(background = false) {
    if (!background) setLoading(true)
    fetch('/app/api/admin/surveys', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setData(d)
          setLastRefresh(new Date())
        }
      })
      .finally(() => { if (!background) setLoading(false) })
  }

  useEffect(() => {
    load(false)
    // 30s auto-refresh, paused via Page Visibility API. Matches the
    // pattern shipped on /admin/users + /admin/moderation.
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => { if (!timer) timer = setInterval(() => { if (!document.hidden) load(true) }, 30_000) }
    const stop  = () => { if (timer) { clearInterval(timer); timer = null } }
    const onVis = () => { if (document.hidden) stop(); else { load(true); start() } }
    start()
    document.addEventListener('visibilitychange', onVis)
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 1s tick so the freshness footer ages without a network round-trip.
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // One-off lookup of a recent past event for the empty-state preview
  // link. Cached in a ref so we don't refetch on every render — the
  // empty state is only reached once on initial load.
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

  const refreshLabel = (() => {
    if (!lastRefresh) return ''
    const s = Math.floor((Date.now() - lastRefresh.getTime()) / 1000)
    if (s < 5)    return 'Updated just now'
    if (s < 60)   return `Updated ${s}s ago`
    if (s < 3600) return `Updated ${Math.floor(s / 60)}m ago`
    return `Updated ${Math.floor(s / 3600)}h ago`
  })()

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">Feedback ✿</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Post-event safety + quality signal{data ? ` · ${data.allTime.responses} response${data.allTime.responses === 1 ? '' : 's'} all-time` : ''}
        </p>
      </div>

      {/* 30d rollup — always renders so the page never looks broken. */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-white">Last 30 days</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {loading       ? 'Loading…'
              : !data        ? 'Could not load — try refreshing.'
              :                `${data.last30.responses} response${data.last30.responses === 1 ? '' : 's'}`}
            </p>
          </div>
          {data && data.last30.anomalies > 0 && (
            <Link href="/admin/moderation?tab=reports&surveyOnly=1"
              className="text-xs font-bold px-2 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors shrink-0">
              ⚠ {data.last30.anomalies} flag{data.last30.anomalies === 1 ? '' : 's'} →
            </Link>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Would return"
            value={data?.last30.wouldReturnRate ?? null}
            trendPp={data?.last30.rateTrendPp ?? null}
            kind="rate-high-good" />
          <Stat label="Anomaly rate"
            value={data?.last30.anomalyRate ?? null}
            kind="rate-low-good" />
          {/* Null while loading so we don't flash a misleading "0"
              before the server replies. data.last30.responses === 0
              is itself a legitimate "no responses in the window"
              state and renders correctly via the same Stat. */}
          <Stat label="Responses"
            value={data ? data.last30.responses : null}
            kind="raw" />
        </div>
      </div>

      {/* Empty state primer vs response list. Skeleton matches the
          real card shape so nothing jumps when data lands. */}
      {loading ? (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          <div className="divide-y divide-zinc-800">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-start gap-3 px-4 sm:px-5 py-3">
                <div className="w-5 h-5 rounded bg-zinc-800 animate-pulse shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="h-3.5 w-1/2 rounded bg-zinc-800 animate-pulse" />
                  <div className="h-3 w-1/3 rounded bg-zinc-800/60 animate-pulse" />
                </div>
                <div className="space-y-1 shrink-0">
                  <div className="h-4 w-20 rounded-full bg-zinc-800 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : !data || data.recent.length === 0 ? (
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
      ) : (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          <div className="px-4 sm:px-5 py-3 border-b border-zinc-800 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white">Recent responses</h3>
              {/* The wedge of the survey is that responders stay
                  anonymous — call it out so the admin reading anomaly
                  notes for triage doesn't try to guess who said what. */}
              <p className="text-[10px] text-zinc-600 mt-0.5">Responders are anonymous — including to you.</p>
            </div>
            <span className="text-xs text-zinc-500 shrink-0">{data.recent.length} shown</span>
          </div>
          <div className="divide-y divide-zinc-800">
            {data.recent.map(r => (
              <Link key={r.id} href={`/admin/events/${r.event.id}/edit`}
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
                  {r.anomaly && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400">⚠ flagged</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Freshness footer — same contract as /admin/users + others.
          Hidden until the first load completes so it doesn't appear
          alongside the skeleton. */}
      {!loading && refreshLabel && (
        <p className="text-xs text-zinc-600 text-right pt-2">{refreshLabel}</p>
      )}
    </div>
  )
}

// Compact stat tile. Renders "—" when value is null (no data yet)
// rather than a misleading "0%" or "0". Three colour modes:
// rate-high-good (would-return), rate-low-good (anomaly), and raw
// (response count).
function Stat({ label, value, trendPp, kind }: {
  label:   string
  value:   number | null
  trendPp?: number | null
  kind:    'rate-high-good' | 'rate-low-good' | 'raw'
}) {
  const color = value === null   ? 'text-zinc-600'
    : kind === 'raw'             ? 'text-white'
    : kind === 'rate-high-good'  ? (value >= 80 ? 'text-green-400' : value >= 60 ? 'text-amber-400' : 'text-red-400')
    :                              (value === 0 ? 'text-green-400' : value < 5  ? 'text-amber-400' : 'text-red-400')
  return (
    <div>
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
