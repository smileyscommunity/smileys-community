'use client'

import { useState, useEffect } from 'react'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { loadFailure } from '@/lib/admin/useAdminLoad'

// /admin/nps — quarterly Net Promoter Score dashboard.
//
// Sibling to /admin/feedback but a different temporal cadence:
//   - Feedback ✿ = per-event drip, granular safety + quality
//   - NPS       = whole-community pulse, one score per quarter
//
// Anonymity wedge identical to event surveys: userId never reaches
// this surface. Comments display score + period only — admins read
// sentiment without identifying authors. Acting on a detractor goes
// via a broadcast / "anything we can do better?" notification by
// score band, never by name.
//
// Layout:
//   - Headline: current-quarter NPS, trend vs prior quarter
//   - Trailing-4 bar chart for at-a-glance trajectory
//   - Promoter / Passive / Detractor split
//   - Response-rate context (responses / eligible)
//   - Recent comments list (period + score, no userId)
//   - CSV export

interface NPSRollup {
  period:        string
  responses:     number
  promoters:     number
  passives:      number
  detractors:    number
  promoterPct:   number | null
  passivePct:    number | null
  detractorPct:  number | null
  nps:           number | null
  avgScore:      number | null
}

interface Comment {
  id: string; score: number; comment: string; period: string; createdAt: string
}

interface Payload {
  period:       string
  current:      NPSRollup
  previous:     NPSRollup | null
  npsTrendPp:   number | null
  history:      NPSRollup[]
  eligible:     number
  responseRate: number | null
  minDays:      number
  comments:     Comment[]
}

export default function AdminNpsPage() {
  const [data, setData]       = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  // A failed rollup used to leave the page on "Loading…" / "Could not
  // load" with no reason and no way back short of a browser refresh.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    let alive = true
    const load = () => {
      fetch('/app/api/admin/nps', { credentials: 'include' })
        .then(async r => { if (!r.ok) throw await loadFailure(r); return r.json() })
        .then(d => { if (alive && d) { setData(d); setLastRefresh(new Date()); setLoadError(null) } })
        .catch((e: Error) => { if (alive) setLoadError(e?.message ?? 'Failed to load') })
        .finally(() => alive && setLoading(false))
    }
    load()
    // Auto-refresh every 5 minutes. Standard pattern across admin
    // surfaces; cheap because the rollup query is tiny.
    const t = setInterval(load, 5 * 60 * 1000)
    return () => { alive = false; clearInterval(t) }
  }, [reloadTick])

  function exportCsv() {
    window.open('/app/api/admin/nps?format=csv', '_blank')
  }

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
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">NPS 💛</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Quarterly Net Promoter Score · anonymous responses
          </p>
        </div>
        <button onClick={exportCsv}
          disabled={!data || data.current.responses === 0}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Export the trailing-4-quarter response set as CSV — no userId, ever">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          Export CSV
        </button>
      </div>

      <LoadErrorBanner message={loadError} onRetry={() => setReloadTick(n => n + 1)} title="Couldn't load NPS" />

      {/* Current-quarter headline. NPS sits in a big tile with
          colour-graded class; the trend pill renders a delta vs the
          previous quarter (when present). Empty state when nobody
          has responded yet — explains the cycle rather than just
          showing "0" which reads like "everyone hates us." */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-white">
              {data ? data.period : 'Loading…'}
              <span className="text-zinc-600 font-normal"> · current quarter</span>
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {loading && !data         ? 'Loading…'
              : !data                    ? 'Could not load — see above.'
              : data.current.responses === 0 ? `No responses yet this quarter. Dispatch nudges members joined ≥ ${data.minDays} days ago in the first 14 days of each quarter.`
              :                            `${data.current.responses} response${data.current.responses === 1 ? '' : 's'} of ${data.eligible} eligible`}
            </p>
          </div>
          {data?.npsTrendPp !== null && data?.npsTrendPp !== undefined && (
            <span className={`text-xs font-bold px-2 py-1 rounded-full border shrink-0 ${
              data.npsTrendPp > 0  ? 'bg-green-500/15 text-green-400 border-green-500/30'
                : data.npsTrendPp < 0 ? 'bg-red-500/15 text-red-400 border-red-500/30'
                : 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30'
            }`}>
              {data.npsTrendPp > 0 ? '↑' : data.npsTrendPp < 0 ? '↓' : '·'} {Math.abs(data.npsTrendPp)} vs prior
            </span>
          )}
        </div>

        {/* Headline + breakdown. NPS gets the dominant tile; the
            four supporting tiles fall to 2-up on phones so text-3xl
            numbers don't squeeze. Promoter / Passive / Detractor
            counts double as a quick sanity check on the headline. */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-zinc-950/40 rounded-xl p-3 sm:p-4 col-span-2 sm:col-span-2 sm:row-span-1">
            <div className="text-xs text-zinc-500 uppercase tracking-wide">NPS</div>
            <div className={`mt-1 text-4xl sm:text-5xl font-extrabold ${
              data?.current.nps === null || data?.current.nps === undefined ? 'text-zinc-700'
                : data.current.nps >= 50 ? 'text-green-400'
                : data.current.nps >= 0  ? 'text-amber-400'
                : 'text-red-400'
            }`}>
              {data?.current.nps !== null && data?.current.nps !== undefined ? data.current.nps : '—'}
            </div>
            <div className="text-xs text-zinc-500 mt-1">Promoters % − Detractors %</div>
          </div>
          <BandTile label="Promoters"  pct={data?.current.promoterPct  ?? null} count={data?.current.promoters  ?? 0} tone="promoter" />
          <BandTile label="Passives"   pct={data?.current.passivePct   ?? null} count={data?.current.passives   ?? 0} tone="passive"  />
          <BandTile label="Detractors" pct={data?.current.detractorPct ?? null} count={data?.current.detractors ?? 0} tone="detractor" />
        </div>

        {/* Response rate + avg score row — context for "is the
            headline signal trustworthy?". Avg score is a softer
            companion to NPS; a 9.2 avg with a small response pool
            is meaningfully different from a 7.5 avg with a large
            one. */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="bg-zinc-950/40 rounded-xl p-3">
            <div className={`text-xl sm:text-2xl font-extrabold ${
              data?.responseRate === null || data?.responseRate === undefined ? 'text-zinc-700'
                : data.responseRate >= 25 ? 'text-green-400'
                : data.responseRate >= 10 ? 'text-amber-400'
                : 'text-red-400'
            }`}>
              {data?.responseRate !== null && data?.responseRate !== undefined ? `${data.responseRate}%` : '—'}
            </div>
            <div className="text-xs text-zinc-500 mt-1">Response rate · {data?.eligible ?? 0} eligible</div>
          </div>
          <div className="bg-zinc-950/40 rounded-xl p-3">
            <div className="text-xl sm:text-2xl font-extrabold text-white">
              {data?.current.avgScore !== null && data?.current.avgScore !== undefined ? data.current.avgScore.toFixed(1) : '—'}
              <span className="text-sm text-zinc-600 font-normal"> / 10</span>
            </div>
            <div className="text-xs text-zinc-500 mt-1">Average score</div>
          </div>
        </div>
      </div>

      {/* Trailing-4 quarter trend. Renders as a simple bar chart —
          one bar per quarter, height scaled to NPS magnitude with a
          centre line at 0 (because NPS goes negative). Empty
          quarters render as a zero-height placeholder so the bar
          slot is still visible. Hover/tap (via title attr) shows
          the actual NPS + sample size. */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-5">
        <h3 className="text-sm font-bold text-white">Trailing 4 quarters</h3>
        <p className="text-xs text-zinc-500 mt-0.5">Each bar is a quarter&apos;s NPS — promoter % minus detractor %.</p>
        <TrendChart history={data?.history ?? []} />
      </div>

      {/* Recent comments — anonymous. Bands as colour-coded pills so
          the reader spots "this is a detractor venting" vs "this is
          a promoter raving" at a glance. */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Recent comments</h3>
          <span className="text-xs text-zinc-500">{data?.comments.length ?? 0} shown</span>
        </div>
        {loading && !data ? (
          <div className="p-6 space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-zinc-800 rounded animate-pulse" />)}
          </div>
        ) : (data?.comments.length ?? 0) === 0 ? (
          <p className="p-6 text-sm text-zinc-500">No free-text comments yet — only score-only responses.</p>
        ) : (
          <div className="divide-y divide-zinc-800">
            {data!.comments.map(c => <CommentRow key={c.id} c={c} />)}
          </div>
        )}
      </div>

      {refreshLabel && (
        <p className="text-[10px] text-zinc-700 text-right">{refreshLabel}</p>
      )}
    </div>
  )
}

function BandTile({ label, pct, count, tone }: { label: string; pct: number | null; count: number; tone: 'promoter' | 'passive' | 'detractor' }) {
  const cls =
    tone === 'promoter'  ? 'text-green-400'
  : tone === 'passive'   ? 'text-amber-400'
  :                        'text-red-400'
  return (
    <div className="bg-zinc-950/40 rounded-xl p-3">
      <div className={`text-2xl sm:text-3xl font-extrabold ${pct === null ? 'text-zinc-700' : cls}`}>
        {pct === null ? '—' : `${pct}%`}
      </div>
      <div className="text-xs text-zinc-500 mt-1">{label} <span className="text-zinc-600">· {count}</span></div>
    </div>
  )
}

function TrendChart({ history }: { history: NPSRollup[] }) {
  // Scale the bars to the absolute max NPS in the window so a slow
  // quarter doesn't visually flatline next to a hot one. Minimum
  // magnitude of 20 prevents tiny absolute deltas from looking
  // bigger than they are.
  const max = Math.max(20, ...history.map(h => Math.abs(h.nps ?? 0)))
  return (
    <div className="mt-3 flex items-end gap-2 sm:gap-3 h-28">
      {history.map(h => {
        const nps = h.nps
        const pct = nps === null ? 0 : Math.abs(nps) / max
        const tone =
          nps === null ? 'bg-zinc-800'
          : nps >= 50  ? 'bg-green-500/80'
          : nps >= 0   ? 'bg-amber-500/70'
          : 'bg-red-500/70'
        const direction = nps !== null && nps < 0 ? 'items-start' : 'items-end'
        return (
          <div key={h.period} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
            {/* Two halves separated by a centre line so negative NPS
                hangs below. 50% per half so a +/-100 fills its half
                exactly. */}
            <div className="w-full flex-1 flex flex-col border-b border-zinc-800/60" title={`${h.period}: NPS ${nps ?? 'no responses'} · ${h.responses} response${h.responses === 1 ? '' : 's'}`}>
              <div className="flex-1 flex items-end justify-center">
                {nps !== null && nps >= 0 && (
                  <div className={`w-full rounded-t ${tone}`} style={{ height: `${pct * 100}%` }} />
                )}
              </div>
              <div className="flex-1 flex items-start justify-center">
                {nps !== null && nps < 0 && (
                  <div className={`w-full rounded-b ${tone}`} style={{ height: `${pct * 100}%` }} />
                )}
              </div>
            </div>
            <span className="text-[10px] text-zinc-600 font-semibold tracking-tight">{h.period.replace(/^\d{2}/, '')}</span>
            <span className={`text-[10px] font-bold ${
              nps === null ? 'text-zinc-700'
                : nps >= 50 ? 'text-green-400'
                : nps >= 0  ? 'text-amber-400'
                : 'text-red-400'
            }`}>
              {nps === null ? '—' : nps > 0 ? `+${nps}` : nps}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function CommentRow({ c }: { c: Comment }) {
  const tone =
    c.score >= 9 ? { label: 'Promoter',  cls: 'bg-green-500/15 text-green-400 border-green-500/30' }
  : c.score >= 7 ? { label: 'Passive',   cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' }
  :                { label: 'Detractor', cls: 'bg-red-500/15 text-red-400 border-red-500/30' }
  return (
    <div className="px-4 sm:px-5 py-4 hover:bg-zinc-800/30 transition-colors">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${tone.cls}`}>
          {tone.label} · {c.score}
        </span>
        <span className="text-[10px] text-zinc-600">{c.period}</span>
        <span className="text-[10px] text-zinc-700">·</span>
        <span className="text-[10px] text-zinc-700">{new Date(c.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
      </div>
      <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">{c.comment}</p>
    </div>
  )
}
