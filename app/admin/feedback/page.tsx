'use client'

import { useEffect, useState } from 'react'
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
  const [data,    setData]    = useState<SurveyData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/app/api/admin/surveys', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">Feedback ✿</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Post-event safety + quality signal. {data ? `${data.allTime.responses} response${data.allTime.responses === 1 ? '' : 's'} all-time.` : ''}
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
          <Stat label="Responses"
            value={data?.last30.responses ?? 0}
            kind="raw" />
        </div>
      </div>

      {/* Empty state primer vs response list. */}
      {loading ? (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-10 text-center text-zinc-500 text-sm">Loading recent responses…</div>
      ) : !data || data.recent.length === 0 ? (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-10 text-center">
          <div className="text-3xl mb-2">✿</div>
          <p className="text-zinc-300 text-sm font-medium">No survey responses yet</p>
          <p className="text-zinc-500 text-xs mt-2 max-w-md mx-auto">
            Surveys are dispatched ~24h after an event ends to its approved attendees. Two questions: "Did anything feel off?" + "Would you go again?". Anomaly flags auto-file a Report under <Link href="/admin/moderation" className="text-amber-400 hover:underline">Moderation</Link>.
          </p>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          <div className="px-4 sm:px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Recent responses</h3>
            <span className="text-xs text-zinc-500">{data.recent.length} shown</span>
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
