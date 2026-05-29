'use client'

import React, { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'

interface Analytics {
  period: string
  periodLabel: string
  months: string[]
  members:      { total: number; newLast30: number; newPrev30: number; growthRate: number; byMonth: number[] }
  engagement:   { activeMemberCount: number; activeMemberRate: number; dormantCount: number; repeatRsvpRate: number; totalUniqueRsvpers: number; repeatRsvpers: number; dormantMembers: { id: string; name: string; joinedAt: string; interests: string[]; neighborhood: string | null }[] }
  applications: { total: number; approved: number; rejected: number; pending: number; approvalRate: number | null; byMonth: number[]; topInterests: { interest: string; count: number }[] }
  events:       { total: number; published: number; past: number; upcoming: number; avgFillRate: number; totalRsvps: number; byMonth: number[]; rsvpByMonth: number[] }
  revenue:      { collected: number; pending: number; refunded: number; byMonth: number[] }
  reports:      { pending: number; actioned: number; dismissed: number }
  topEvents:    { id: string; title: string; date: string; totalSpots: number; attending: number; fillRate: number }[]
  topClubs:     { id: string; name: string; emoji: string; members: number; events: number }[]
  neighborhoods:    { name: string; members: number; events: number }[]
  revenueByClub:    { id: string; name: string; emoji: string; revenue: number; payments: number }[]
  refundRateByHost: { hostId: string; hostName: string; clubName: string; paid: number; refunded: number; refundedAmount: number; refundRate: number }[]
  interestAlignment: {
    fromApplications:  { interest: string; count: number }[]
    fromAttendedEvents: { interest: string; count: number }[]
  }
  hangouts: {
    totals: { createdInPeriod: number; referencesInPeriod: number }
    byMonth:           number[]
    referencesByMonth: number[]
    vibeBreakdown:     { good: number; meh: number; noShow: number }
    topHostsOfPeriod:  { id: string; name: string; color: string; profilePhoto: string | null; count: number }[]
  }
  funnel:  { applications: number; approved: number; firstEvent: number; repeat: number }
  cohorts: { cohort: string; size: number; within30Pct: number; within90Pct: number; everPct: number }[]
}

// Retention page used to live at /admin/retention with this shape. Folding it
// in lets one Analytics surface answer both "how are we doing" and "who needs
// a nudge" without admins context-switching pages.
interface RetentionMember {
  id: string; name: string; email: string; color: string
  neighborhood: string | null; interests?: string[]; joinedAt?: string
  lastEventDate?: string; eventCount?: number
}
interface RetentionData {
  neverAttended: RetentionMember[]
  dormant:      RetentionMember[]
  stats: { neverAttendedCount: number; dormantCount: number }
}

function StatCard({ label, value, sub, subColor = 'text-zinc-500', href, alert }: {
  label: string; value: string | number; sub?: string; subColor?: string; href?: string; alert?: 'red' | 'amber'
}) {
  const borderClass = alert === 'red' ? 'border-red-500/40' : alert === 'amber' ? 'border-amber-500/30' : 'border-zinc-800'
  const inner = (
    <div className={`bg-zinc-900 rounded-2xl p-5 border ${borderClass} hover:border-zinc-700 transition-colors h-full`}>
      <div className="text-xs text-zinc-500 font-medium mb-1">{label}</div>
      <div className={`text-2xl font-extrabold ${alert === 'red' ? 'text-red-400' : alert === 'amber' ? 'text-amber-400' : 'text-white'}`}>{value}</div>
      {sub && <div className={`text-xs mt-1 font-medium ${subColor}`}>{sub}</div>}
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}

function MiniBar({ values, months, color = '#f59e0b' }: { values: number[]; months: string[]; color?: string }) {
  const max = Math.max(...values, 1)
  return (
    <div className="flex items-end gap-1 h-16">
      {values.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full rounded-t"
            style={{ height: `${Math.max((v / max) * 48, v > 0 ? 4 : 0)}px`, backgroundColor: color, opacity: i === values.length - 1 ? 1 : 0.5 }}
          />
          <span className="text-[9px] text-zinc-600 leading-none">{months[i]?.split(' ')[0]}</span>
        </div>
      ))}
    </div>
  )
}

function FillBar({ pct, color = '#f59e0b' }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mt-1">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
    </div>
  )
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const d = Math.floor(diff / 86400000)
  if (d < 30) return `${d}d ago`
  if (d < 365) return `${Math.floor(d / 30)}mo ago`
  return `${Math.floor(d / 365)}y ago`
}

function RetentionRow({ m, sub }: { m: RetentionMember; sub: string }) {
  const [drafting, setDrafting] = useState(false)
  const [nudge, setNudge]       = useState('')

  async function draftNudge() {
    setDrafting(true)
    const res = await fetch('/app/api/admin/users/reengage', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: m.id }),
    })
    const data = await res.json()
    if (data.message) setNudge(data.message)
    setDrafting(false)
  }

  return (
    <div className="px-5 py-4 hover:bg-zinc-800/30 transition-colors">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
          style={{ backgroundColor: m.color }}>
          {m.name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/admin/users/${m.id}`} className="text-sm font-semibold text-zinc-200 hover:text-amber-400 transition-colors">
              {m.name}
            </Link>
            {m.neighborhood && <span className="text-xs text-zinc-500">{m.neighborhood}</span>}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a href={`mailto:${m.email}`}
            className="text-xs text-zinc-500 hover:text-zinc-200 px-2.5 py-2 rounded-lg hover:bg-zinc-700 transition-colors">
            Email
          </a>
          <button
            onClick={draftNudge}
            disabled={drafting}
            className="text-xs text-amber-400 hover:text-amber-300 font-semibold px-2.5 py-2 rounded-lg hover:bg-amber-500/10 transition-colors disabled:opacity-50"
          >
            {drafting ? '…' : '✦ Nudge'}
          </button>
        </div>
      </div>
      {nudge && (
        <div className="mt-3 ml-11 p-3 bg-zinc-800 rounded-xl border border-zinc-700 text-xs text-zinc-300 leading-relaxed">
          {nudge}
        </div>
      )}
    </div>
  )
}

const PERIODS = [
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: '6m',  label: '6 months' },
  { key: '12m', label: '12 months' },
]

// Human-readable window label used in chart titles ("Member growth — last
// 6 months") so the captions actually track the period selector instead of
// reading "last 6 months" forever regardless.
function periodWindowLabel(key: string): string {
  return PERIODS.find(p => p.key === key)?.label ?? '6 months'
}

type Tab = 'overview' | 'members' | 'events' | 'hangouts' | 'revenue' | 'health'
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'members',  label: 'Members'  },
  { key: 'events',   label: 'Events'   },
  { key: 'hangouts', label: 'Hangouts' },
  { key: 'revenue',  label: 'Revenue'  },
  { key: 'health',   label: 'Health'   },
]

function AnalyticsInner() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()

  const [data,          setData]          = useState<Analytics | null>(null)
  // Two-state load tracking: `loading` only fires on the initial fetch (when
  // there's no data yet) so the skeleton shows once. Subsequent fetches —
  // period changes, retries — set `refreshing`, which keeps the stale data
  // on screen with a small indicator instead of blanking the page.
  const [loading,       setLoading]       = useState(true)
  const [refreshing,    setRefreshing]    = useState(false)
  const [errorMsg,      setErrorMsg]      = useState<string | null>(null)
  const [period,        setPeriod]        = useState('6m')
  const [reengageId,    setReengageId]    = useState<string | null>(null)
  const [reengageMsgs,  setReengageMsgs]  = useState<Record<string, string>>({})
  const [reengageLoad,  setReengageLoad]  = useState<string | null>(null)
  const [showDormant,   setShowDormant]   = useState(false)
  const [retention,     setRetention]     = useState<RetentionData | null>(null)
  const [retentionTab,  setRetentionTab]  = useState<'never' | 'dormant'>('never')

  const tabParam = searchParams.get('tab') as Tab | null
  const tab: Tab = (TABS.some(t => t.key === tabParam) ? tabParam : 'overview') as Tab

  function setTab(next: Tab) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'overview') params.delete('tab')
    else params.set('tab', next)
    const q = params.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }

  // load() doubles as the initial fetch and the retry/refresh trigger.
  // Tracks errorMsg so we can show a retry banner instead of leaving the
  // page on "Failed to load" forever.
  const load = useCallback(() => {
    const isInitial = !data
    if (isInitial) setLoading(true)
    else           setRefreshing(true)
    setErrorMsg(null)
    fetch(`/app/api/admin/analytics?period=${period}`, { credentials: 'include' })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => { if (d) setData(d) })
      .catch(err => {
        console.error('[analytics load]', err)
        setErrorMsg('Could not load analytics. Try again?')
      })
      .finally(() => { setLoading(false); setRefreshing(false) })
  // data is intentionally NOT in deps — we read it once at call time to
  // decide skeleton-vs-stale, but re-running the effect on data change
  // would cause an infinite fetch loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  useEffect(() => { load() }, [load])

  // Lazy-load retention list only when Members tab is opened. Endpoint is
  // server-rendered list of never-attended + dormant — separate from the
  // /api/admin/analytics summary, which only includes counts.
  useEffect(() => {
    if (tab !== 'members' || retention) return
    fetch('/app/api/admin/retention', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setRetention(d) })
      .catch(() => {})
  }, [tab, retention])

  // Initial-load skeleton — only fires when there's no data yet. Period
  // changes after first load keep showing the previous data (greyed out)
  // until the refresh resolves, so the page never blanks.
  if (loading && !data) return (
    <div className="p-6 space-y-4">
      {[1, 2, 3].map(i => <div key={i} className="h-32 bg-zinc-900 rounded-2xl border border-zinc-800 animate-pulse" />)}
    </div>
  )

  // Hard failure on first load — no data, no fallback, retry surface.
  if (!data) return (
    <div className="p-6 space-y-3">
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
        <p className="text-sm text-red-300 font-medium">⚠ {errorMsg ?? 'Could not load analytics.'}</p>
        <button onClick={load} disabled={loading || refreshing}
          className="mt-2 text-xs font-bold bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg">
          {loading || refreshing ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    </div>
  )

  const growthColor = data.members.growthRate >= 0 ? 'text-green-400' : 'text-red-400'
  const growthSign  = data.members.growthRate >= 0 ? '+' : ''

  // ── Alerts banner (always visible across tabs — these need attention now) ──
  const alerts: { level: 'red' | 'amber'; msg: string }[] = []
  if (data.events.avgFillRate < 40)               alerts.push({ level: 'red',   msg: `Low avg fill rate (${data.events.avgFillRate}%) — events are not filling up` })
  else if (data.events.avgFillRate < 60)          alerts.push({ level: 'amber', msg: `Avg fill rate is ${data.events.avgFillRate}% — room to improve event promotion` })
  if (data.engagement.activeMemberRate < 20)      alerts.push({ level: 'red',   msg: `Only ${data.engagement.activeMemberRate}% of members active in last 30 days` })
  else if (data.engagement.activeMemberRate < 35) alerts.push({ level: 'amber', msg: `Active member rate is ${data.engagement.activeMemberRate}% — consider re-engagement` })
  if (data.applications.pending >= 10)            alerts.push({ level: 'red',   msg: `${data.applications.pending} applications waiting for review` })
  if (data.reports.pending >= 5)                  alerts.push({ level: 'red',   msg: `${data.reports.pending} reports pending action` })
  const hasRed = alerts.some(a => a.level === 'red')

  return (
    <div className="p-4 sm:p-6 space-y-6 text-white">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Analytics</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Platform growth, revenue, and community health</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Stale-data indicator — only shows during in-flight refreshes
              that aren't the initial load, so admins know the chart values
              are catching up to a new period selection. */}
          {refreshing && (
            <span className="text-xs text-zinc-500 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Refreshing…
            </span>
          )}
          <div className={`flex items-center bg-zinc-900 border border-zinc-800 rounded-xl p-1 gap-0.5 transition-opacity ${refreshing ? 'opacity-60' : ''}`}>
            {PERIODS.map(p => (
              <button key={p.key} onClick={() => setPeriod(p.key)} disabled={refreshing}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:cursor-wait ${
                  period === p.key ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Soft error banner — appears after first load if a refresh fails;
          the page keeps showing the previous data so context isn't lost. */}
      {errorMsg && data && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-red-300 font-medium">⚠ {errorMsg}</p>
          <button onClick={load} disabled={refreshing}
            className="text-xs font-bold bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg">
            {refreshing ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {/* Tab nav — URL-synced via ?tab=. Sticks under the page header so
          admins can switch lenses without losing the period selector above. */}
      <div className="flex gap-1 border-b border-zinc-800 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px whitespace-nowrap ${
              tab === t.key ? 'border-amber-500 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Alerts banner — always visible (these surface "needs attention now"
          across every tab so admins can't miss them by being on a different
          lens). ──────────────────────────────────────────────────────────── */}
      {alerts.length > 0 && (
        <div className={`rounded-2xl border p-4 space-y-1.5 ${hasRed ? 'bg-red-500/5 border-red-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
          <p className={`text-xs font-bold mb-2 ${hasRed ? 'text-red-400' : 'text-amber-400'}`}>Needs attention</p>
          {alerts.map((a, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={`text-xs font-bold shrink-0 ${a.level === 'red' ? 'text-red-400' : 'text-amber-400'}`}>
                {a.level === 'red' ? '●' : '○'}
              </span>
              <span className="text-xs text-zinc-300">{a.msg}</span>
            </div>
          ))}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          OVERVIEW TAB
          ════════════════════════════════════════════════════════════════════ */}
      {tab === 'overview' && (
        <>
          {/* ── Members ─────────────────────────────────────────────────── */}
          <section>
            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Members</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <StatCard label="Total members"    value={data.members.total.toLocaleString()} />
              <StatCard label="New (last 30d)"   value={data.members.newLast30}
                sub={`${growthSign}${data.members.growthRate}% vs prev 30d`} subColor={growthColor} />
              <StatCard label="Approval rate"    value={data.applications.approvalRate != null ? `${data.applications.approvalRate}%` : '—'}
                sub={`${data.applications.approved} approved · ${data.applications.rejected} rejected`} />
              <StatCard label="Pending apps"     value={data.applications.pending}
                href="/admin/applications"
                subColor={data.applications.pending >= 10 ? 'text-red-400' : data.applications.pending > 0 ? 'text-amber-400' : 'text-green-400'}
                alert={data.applications.pending >= 10 ? 'red' : data.applications.pending > 0 ? 'amber' : undefined}
                sub={data.applications.pending >= 10 ? 'Urgent — many pending' : data.applications.pending > 0 ? 'Review now' : 'All clear'} />
            </div>
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
              <div className="text-xs font-semibold text-zinc-400 mb-3">Member growth — last {periodWindowLabel(period)}</div>
              <MiniBar values={data.members.byMonth} months={data.months} color="#f59e0b" />
            </div>
          </section>

          {/* ── Applications ────────────────────────────────────────────── */}
          <section>
            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Applications</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
                <div className="text-xs font-semibold text-zinc-400 mb-3">Volume — last {periodWindowLabel(period)}</div>
                <MiniBar values={data.applications.byMonth} months={data.months} color="#a78bfa" />
              </div>
              <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
                <div className="text-xs font-semibold text-zinc-400 mb-1">Top interests in applications</div>
                <div className="text-xs text-zinc-600 mb-3">Click to filter applications by interest</div>
                <div className="space-y-2">
                  {data.applications.topInterests.slice(0, 5).map(({ interest, count }) => {
                    const max = data.applications.topInterests[0]?.count ?? 1
                    return (
                      <Link key={interest} href={`/admin/applications?interest=${encodeURIComponent(interest)}`} className="block group">
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="text-zinc-300 capitalize group-hover:text-violet-400 transition-colors">{interest}</span>
                          <span className="text-zinc-500">{count}</span>
                        </div>
                        <FillBar pct={(count / max) * 100} color="#a78bfa" />
                      </Link>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* ── Conversion funnel ───────────────────────────────────────────
              Visual drop-off chart for Applications → Approved → First
              event → Repeat. Each bar's width scales to its percentage of
              the top stage; the percentage chip shows conversion from the
              *previous* stage (the actionable metric — "where are we
              losing people"). Hidden when applications = 0. */}
          {data.funnel.applications > 0 && (
            <section>
              <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Conversion funnel</h2>
              <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-3">
                {(() => {
                  const f = data.funnel
                  const stages = [
                    { label: 'Applications', value: f.applications, color: '#a78bfa', prev: f.applications },
                    { label: 'Approved',     value: f.approved,     color: '#60a5fa', prev: f.applications },
                    { label: 'First event',  value: f.firstEvent,   color: '#f59e0b', prev: f.approved   },
                    { label: 'Repeat',       value: f.repeat,       color: '#34d399', prev: f.firstEvent },
                  ]
                  const top = stages[0].value || 1
                  return stages.map((s, i) => {
                    const widthPct = Math.round((s.value / top) * 100)
                    const convPct  = s.prev > 0 ? Math.round((s.value / s.prev) * 100) : 0
                    const convColor = i === 0 ? 'text-zinc-500'
                                    : convPct >= 60 ? 'text-green-400'
                                    : convPct >= 35 ? 'text-amber-400'
                                                    : 'text-red-400'
                    return (
                      <div key={s.label}>
                        <div className="flex items-baseline justify-between mb-1">
                          <span className="text-xs font-semibold text-zinc-300">{s.label}</span>
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-bold text-white">{s.value.toLocaleString()}</span>
                            {i > 0 && (
                              <span className={`text-xs font-bold ${convColor}`}>({convPct}%)</span>
                            )}
                          </div>
                        </div>
                        <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(widthPct, 2)}%`, backgroundColor: s.color }} />
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            </section>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          MEMBERS TAB — engagement summary + retention drill-down
          (formerly /admin/retention, folded in via /api/admin/retention)
          ════════════════════════════════════════════════════════════════════ */}
      {tab === 'members' && (
        <>
          {/* ── Engagement summary ──────────────────────────────────────── */}
          {data.engagement && (
            <section>
              <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
                <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Retention & Engagement</h2>
                {/* These metrics use fixed time windows (30d active, 90d
                    dormant, lifetime repeat) — they don't shift with the
                    period selector at the top. Disclose that here so
                    admins don't read e.g. activeMemberRate as scoped to
                    the chosen period. */}
                <span className="text-[10px] text-zinc-600 italic">Fixed windows · not affected by the period selector</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
                  <div className="text-xs text-zinc-500 font-medium mb-1">Active member rate</div>
                  <div className="text-2xl font-extrabold text-white">{data.engagement.activeMemberRate}%</div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {data.engagement.activeMemberCount} of {data.members.total} attended an event in last 30 days
                  </div>
                  <FillBar
                    pct={data.engagement.activeMemberRate}
                    color={data.engagement.activeMemberRate >= 50 ? '#34d399' : data.engagement.activeMemberRate >= 25 ? '#f59e0b' : '#ef4444'}
                  />
                </div>
                <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs text-zinc-500 font-medium mb-1">Dormant members</div>
                      <div className={`text-2xl font-extrabold ${data.engagement.dormantCount > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                        {data.engagement.dormantCount}
                      </div>
                      <div className="text-xs text-zinc-500 mt-1">No attendance in 90+ days</div>
                    </div>
                    {data.engagement.dormantCount > 0 && (
                      <button onClick={() => setShowDormant(v => !v)}
                        className="text-xs px-2.5 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 font-semibold transition-colors shrink-0">
                        {showDormant ? 'Hide' : 'Re-engage ↓'}
                      </button>
                    )}
                  </div>
                  {showDormant && data.engagement.dormantMembers.length > 0 && (
                    <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
                      {data.engagement.dormantMembers.map(m => (
                        <div key={m.id} className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-xs font-semibold text-white">{m.name}</span>
                              {m.neighborhood && <span className="text-xs text-zinc-500 ml-1.5">{m.neighborhood}</span>}
                              {m.interests.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-0.5">
                                  {m.interests.slice(0, 3).map(i => (
                                    <span key={i} className="text-[9px] px-1.5 py-0.5 bg-zinc-800 text-zinc-500 rounded-full capitalize">{i}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <button
                              onClick={async () => {
                                setReengageLoad(m.id)
                                const res = await fetch('/app/api/admin/users/reengage', {
                                  method: 'POST', credentials: 'include',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ userId: m.id }),
                                })
                                if (res.ok) {
                                  const { message } = await res.json()
                                  setReengageMsgs(prev => ({ ...prev, [m.id]: message }))
                                  setReengageId(m.id)
                                }
                                setReengageLoad(null)
                              }}
                              disabled={reengageLoad === m.id}
                              className="text-xs px-2 py-1 rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/20 font-semibold transition-colors shrink-0 disabled:opacity-50"
                            >
                              {reengageLoad === m.id ? '⏳' : reengageMsgs[m.id] ? '✦ Redraft' : '✦ Draft'}
                            </button>
                          </div>
                          {reengageId === m.id && reengageMsgs[m.id] && (
                            <div className="space-y-1.5">
                              <textarea
                                value={reengageMsgs[m.id]}
                                onChange={e => setReengageMsgs(prev => ({ ...prev, [m.id]: e.target.value }))}
                                rows={3}
                                className="w-full px-2.5 py-2 text-xs bg-zinc-800 border border-violet-500/30 rounded-lg text-white resize-none focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                              />
                              <button
                                onClick={async () => {
                                  const res = await fetch(`/app/api/admin/users/${m.id}`, {
                                    method: 'PATCH', credentials: 'include',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ _reengage: reengageMsgs[m.id] }),
                                  })
                                  if (res.ok) {
                                    setReengageMsgs(prev => ({ ...prev, [m.id]: '' }))
                                    setReengageId(null)
                                  }
                                }}
                                className="w-full py-1.5 text-xs font-semibold bg-violet-500 hover:bg-violet-600 text-white rounded-lg transition-colors"
                              >
                                Send notification
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
                  <div className="text-xs text-zinc-500 font-medium mb-1">Repeat RSVP rate</div>
                  <div className="text-2xl font-extrabold text-white">{data.engagement.repeatRsvpRate}%</div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {data.engagement.repeatRsvpers} of {data.engagement.totalUniqueRsvpers} attendees have joined 2+ events
                  </div>
                  <FillBar
                    pct={data.engagement.repeatRsvpRate}
                    color={data.engagement.repeatRsvpRate >= 60 ? '#34d399' : data.engagement.repeatRsvpRate >= 35 ? '#f59e0b' : '#ef4444'}
                  />
                </div>
              </div>
            </section>
          )}

          {/* ── Retention drill-down — never-attended + dormant lists ───── */}
          <section>
            <div className="flex items-end justify-between mb-3">
              <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Who needs a nudge</h2>
              <span className="text-xs text-zinc-600">
                {retention ? `${retention.stats.neverAttendedCount + retention.stats.dormantCount} total` : 'Loading…'}
              </span>
            </div>

            {/* Stat tabs — click to switch between the two segments */}
            {retention && (
              <div className="grid grid-cols-2 gap-3 mb-3">
                <button
                  onClick={() => setRetentionTab('never')}
                  className={`rounded-2xl p-5 border text-left transition-colors ${retentionTab === 'never' ? 'bg-amber-500/10 border-amber-500/30' : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'}`}>
                  <p className="text-xs text-zinc-500 font-medium mb-1">Never attended</p>
                  <p className="text-3xl font-extrabold text-white">{retention.stats.neverAttendedCount}</p>
                  <p className="text-xs text-zinc-500 mt-1">Approved &gt;7 days, 0 events</p>
                </button>
                <button
                  onClick={() => setRetentionTab('dormant')}
                  className={`rounded-2xl p-5 border text-left transition-colors ${retentionTab === 'dormant' ? 'bg-amber-500/10 border-amber-500/30' : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'}`}>
                  <p className="text-xs text-zinc-500 font-medium mb-1">Dormant</p>
                  <p className="text-3xl font-extrabold text-white">{retention.stats.dormantCount}</p>
                  <p className="text-xs text-zinc-500 mt-1">No events in 60+ days</p>
                </button>
              </div>
            )}

            {/* List */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              {!retention ? (
                <div className="p-12 text-center text-zinc-500 text-sm">Loading…</div>
              ) : retentionTab === 'never' ? (
                retention.neverAttended.length === 0 ? (
                  <div className="p-12 text-center text-zinc-500">
                    <p className="text-2xl mb-2">🎉</p>
                    <p className="text-sm">All members have attended at least one event!</p>
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-800/60">
                    {retention.neverAttended.map(m => (
                      <RetentionRow
                        key={m.id}
                        m={m}
                        sub={`Joined ${timeAgo(m.joinedAt!)} · ${m.interests?.slice(0, 3).join(', ') || 'No interests set'}`}
                      />
                    ))}
                  </div>
                )
              ) : (
                retention.dormant.length === 0 ? (
                  <div className="p-12 text-center text-zinc-500">
                    <p className="text-2xl mb-2">🎉</p>
                    <p className="text-sm">No dormant members right now!</p>
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-800/60">
                    {retention.dormant.map(m => (
                      <RetentionRow
                        key={m.id}
                        m={m}
                        sub={`Last event ${timeAgo(m.lastEventDate!)} · ${m.eventCount} event${m.eventCount !== 1 ? 's' : ''} total`}
                      />
                    ))}
                  </div>
                )
              )}
            </div>
          </section>

          {/* ── Cohort retention ────────────────────────────────────────────
              For each of the last 6 monthly cohorts (members who joined in
              month X), what % attended an event within their first 30 days,
              first 90 days, or ever. Reads as a heatmap-ish stacked
              breakdown: bright bars = good onboarding, dim bars = members
              never activated. The single most actionable community-health
              chart we have. */}
          {data.cohorts.length > 0 && (
            <section>
              <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
                <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Cohort retention</h2>
                <span className="text-[10px] text-zinc-600 italic">% of each month&apos;s joiners who attended ≥1 event</span>
              </div>
              <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
                <div className="grid grid-cols-[auto_1fr_auto] gap-x-4 gap-y-3 items-center text-xs">
                  {/* Column headers */}
                  <span className="text-[10px] font-bold text-zinc-500 uppercase">Cohort</span>
                  <div className="grid grid-cols-3 gap-2 text-[10px] font-bold text-zinc-500 uppercase">
                    <span className="text-center">First 30d</span>
                    <span className="text-center">First 90d</span>
                    <span className="text-center">Ever</span>
                  </div>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase text-right">Size</span>

                  {data.cohorts.map(c => (
                    <React.Fragment key={c.cohort}>
                      <span className="text-zinc-300 font-medium">{c.cohort}</span>
                      <div className="grid grid-cols-3 gap-2">
                        {[c.within30Pct, c.within90Pct, c.everPct].map((pct, i) => (
                          <div key={i} className="relative h-5 bg-zinc-800 rounded-md overflow-hidden">
                            <div
                              className="absolute inset-y-0 left-0 transition-all"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: pct >= 50 ? '#34d399' : pct >= 25 ? '#f59e0b' : '#ef4444',
                                opacity: c.size === 0 ? 0.3 : 1,
                              }}
                            />
                            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white mix-blend-difference">
                              {c.size === 0 ? '—' : `${pct}%`}
                            </span>
                          </div>
                        ))}
                      </div>
                      <span className="text-zinc-500 text-right tabular-nums">{c.size}</span>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          EVENTS TAB — events stats + neighborhoods + interest alignment
          ════════════════════════════════════════════════════════════════════ */}
      {tab === 'events' && (
        <>
          {/* ── Events ──────────────────────────────────────────────────── */}
          <section>
            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Events</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <StatCard label="Total events"   value={data.events.total} />
              <StatCard label="Upcoming"       value={data.events.upcoming} sub="Published" />
              <StatCard label="Total RSVPs"    value={data.events.totalRsvps.toLocaleString()} />
              <StatCard label="Avg fill rate"  value={`${data.events.avgFillRate}%`}
                sub="Across past events"
                subColor={data.events.avgFillRate >= 60 ? 'text-green-400' : data.events.avgFillRate >= 40 ? 'text-amber-400' : 'text-red-400'}
                alert={data.events.avgFillRate < 40 ? 'red' : data.events.avgFillRate < 60 ? 'amber' : undefined} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
                <div className="text-xs font-semibold text-zinc-400 mb-3">Events created — last {periodWindowLabel(period)}</div>
                <MiniBar values={data.events.byMonth} months={data.months} color="#34d399" />
              </div>
              <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
                <div className="text-xs font-semibold text-zinc-400 mb-3">RSVPs — last {periodWindowLabel(period)}</div>
                <MiniBar values={data.events.rsvpByMonth} months={data.months} color="#60a5fa" />
              </div>
            </div>

            {/* Top events */}
            {data.topEvents.length > 0 && (
              <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
                <div className="px-5 py-4 border-b border-zinc-800">
                  <div className="text-sm font-bold text-white">Top events by attendance</div>
                  <div className="text-xs text-zinc-500 mt-0.5">Past events sorted by headcount</div>
                </div>
                <div className="divide-y divide-zinc-800">
                  {data.topEvents.map(e => (
                    <Link key={e.id} href={`/admin/events/${e.id}/edit`}
                      className="flex items-center gap-4 px-5 py-3 hover:bg-zinc-800/40 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-white truncate">{e.title}</div>
                        <div className="text-xs text-zinc-500">{new Date(e.date).toLocaleDateString()}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold text-white">{e.attending}/{e.totalSpots}</div>
                        <div className={`text-xs font-semibold ${e.fillRate >= 80 ? 'text-green-400' : e.fillRate >= 50 ? 'text-amber-400' : 'text-zinc-500'}`}>
                          {e.fillRate}% full
                        </div>
                      </div>
                      <div className="w-16 shrink-0">
                        <FillBar pct={e.fillRate} color={e.fillRate >= 80 ? '#34d399' : e.fillRate >= 50 ? '#f59e0b' : '#71717a'} />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* ── Neighborhood heatmap ────────────────────────────────────── */}
          {data.neighborhoods?.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Neighborhood breakdown</h2>
              <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
                <div className="flex items-center gap-4 mb-4 text-xs text-zinc-500">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" /> Members</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-violet-500 inline-block" /> Events</span>
                  <span className="ml-auto text-zinc-600">Top {data.neighborhoods.length} neighborhoods</span>
                </div>
                <div className="space-y-3">
                  {data.neighborhoods.map(n => {
                    const maxMembers = Math.max(...data.neighborhoods.map(x => x.members), 1)
                    const maxEvents  = Math.max(...data.neighborhoods.map(x => x.events),  1)
                    const underserved = n.members >= 2 && n.events === 0
                    return (
                      <div key={n.name}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-zinc-300 font-medium flex items-center gap-1.5">
                            {n.name}
                            {underserved && <span className="text-[9px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full">no events yet</span>}
                          </span>
                          <span className="text-xs text-zinc-600">{n.members}m · {n.events}e</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${(n.members / maxMembers) * 100}%` }} />
                          </div>
                          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${(n.events / maxEvents) * 100}%` }} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </section>
          )}

          {/* ── Interest alignment ──────────────────────────────────────── */}
          {data.interestAlignment && (
            <section>
              <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Interest alignment</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
                  <div className="text-xs font-semibold text-zinc-400 mb-1">What applicants say they want</div>
                  <div className="text-xs text-zinc-600 mb-3">Click to browse applications by interest</div>
                  <div className="space-y-2">
                    {data.interestAlignment.fromApplications.slice(0, 7).map(({ interest, count }) => {
                      const max = data.interestAlignment.fromApplications[0]?.count ?? 1
                      return (
                        <Link key={interest} href={`/admin/applications?interest=${encodeURIComponent(interest)}`} className="block group">
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-zinc-300 capitalize group-hover:text-amber-400 transition-colors">{interest}</span>
                            <span className="text-zinc-500">{count}</span>
                          </div>
                          <FillBar pct={(count / max) * 100} color="#f59e0b" />
                        </Link>
                      )
                    })}
                    {data.interestAlignment.fromApplications.length === 0 && (
                      <p className="text-xs text-zinc-600">No application interest data yet.</p>
                    )}
                  </div>
                </div>
                <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
                  <div className="text-xs font-semibold text-zinc-400 mb-1">What members actually attend</div>
                  <div className="text-xs text-zinc-600 mb-3">Tags of events with approved RSVPs</div>
                  <div className="space-y-2">
                    {data.interestAlignment.fromAttendedEvents.slice(0, 7).map(({ interest, count }) => {
                      const max = data.interestAlignment.fromAttendedEvents[0]?.count ?? 1
                      return (
                        <div key={interest}>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-zinc-300 capitalize">{interest}</span>
                            <span className="text-zinc-500">{count}</span>
                          </div>
                          <FillBar pct={(count / max) * 100} color="#34d399" />
                        </div>
                      )
                    })}
                    {data.interestAlignment.fromAttendedEvents.length === 0 && (
                      <p className="text-xs text-zinc-600">No attended event tag data yet.</p>
                    )}
                  </div>
                </div>
              </div>
              {data.interestAlignment.fromApplications.length > 0 && data.interestAlignment.fromAttendedEvents.length > 0 && (() => {
                const appSet     = new Set(data.interestAlignment.fromApplications.slice(0, 5).map(i => i.interest.toLowerCase()))
                const attendSet  = new Set(data.interestAlignment.fromAttendedEvents.slice(0, 5).map(i => i.interest.toLowerCase()))
                const gaps       = [...appSet].filter(i => !attendSet.has(i))
                if (!gaps.length) return null
                return (
                  <div className="mt-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                    <p className="text-xs font-bold text-amber-400 mb-1">⚡ Potential gap</p>
                    <p className="text-xs text-zinc-400">
                      Members apply citing <span className="text-white font-medium">{gaps.join(', ')}</span> as interests, but these don't appear in top attended event tags. Consider programming more events in these areas.
                    </p>
                  </div>
                )
              })()}
            </section>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          HANGOUTS TAB — totals, velocity, vibe breakdown, top hosts
          ════════════════════════════════════════════════════════════════════ */}
      {tab === 'hangouts' && (
        <>
          <section>
            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Hangouts</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <StatCard label="Hangouts" value={data.hangouts.totals.createdInPeriod}
                sub={`Created in last ${periodWindowLabel(period)}`} />
              <StatCard label="References" value={data.hangouts.totals.referencesInPeriod}
                sub="Trust signals left after meetups" subColor="text-green-400" />
              <StatCard label="Good refs" value={data.hangouts.vibeBreakdown.good}
                subColor="text-green-400"
                sub={data.hangouts.totals.referencesInPeriod > 0
                  ? `${Math.round((data.hangouts.vibeBreakdown.good / data.hangouts.totals.referencesInPeriod) * 100)}% of refs`
                  : 'No refs yet'} />
              <StatCard label="No-shows" value={data.hangouts.vibeBreakdown.noShow}
                subColor={data.hangouts.vibeBreakdown.noShow > 0 ? 'text-red-400' : 'text-zinc-500'}
                alert={data.hangouts.vibeBreakdown.noShow > 5 ? 'red' : data.hangouts.vibeBreakdown.noShow > 0 ? 'amber' : undefined}
                sub="Reported as didn't show" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
                <div className="text-xs font-semibold text-zinc-400 mb-3">Hangouts posted — last {periodWindowLabel(period)}</div>
                <MiniBar values={data.hangouts.byMonth} months={data.months} color="#f59e0b" />
              </div>
              <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
                <div className="text-xs font-semibold text-zinc-400 mb-3">References created — last {periodWindowLabel(period)}</div>
                <MiniBar values={data.hangouts.referencesByMonth} months={data.months} color="#34d399" />
              </div>
            </div>
          </section>

          {/* Vibe breakdown — qualitative view that the raw count can't give */}
          {data.hangouts.totals.referencesInPeriod > 0 && (
            <section>
              <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Vibe breakdown</h2>
              <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-3">
                {([
                  { label: 'Good',            count: data.hangouts.vibeBreakdown.good,   color: '#34d399' },
                  { label: 'Meh',             count: data.hangouts.vibeBreakdown.meh,    color: '#a1a1aa' },
                  { label: 'Didn’t show',     count: data.hangouts.vibeBreakdown.noShow, color: '#ef4444' },
                ] as { label: string; count: number; color: string }[]).map(v => {
                  const total = data.hangouts.totals.referencesInPeriod
                  const pct   = total > 0 ? Math.round((v.count / total) * 100) : 0
                  return (
                    <div key={v.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-zinc-300 font-medium">{v.label}</span>
                        <span className="text-zinc-500">{v.count} <span className="text-zinc-600">· {pct}%</span></span>
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: v.color }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Top hosts — leaderboard for the selected period */}
          {data.hangouts.topHostsOfPeriod.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Top hosts · last {periodWindowLabel(period)}</h2>
              <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
                <div className="divide-y divide-zinc-800">
                  {data.hangouts.topHostsOfPeriod.map((h, i) => (
                    <Link key={h.id} href={`/members/${h.id}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-800/40 transition-colors">
                      <span className="text-xs font-bold text-zinc-600 w-4">{i + 1}</span>
                      <div className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                        style={{ backgroundColor: h.color }}>
                        {h.profilePhoto
                          ? <img src={`/app/api/files${h.profilePhoto.replace('/app/api/files', '')}`} alt={h.name} className="w-full h-full object-cover" />
                          : h.name[0]}
                      </div>
                      <span className="text-sm font-semibold text-zinc-200 flex-1 min-w-0 truncate">{h.name}</span>
                      <span className="text-xs text-zinc-500 shrink-0">{h.count} hangout{h.count !== 1 ? 's' : ''}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Empty state — guides admins toward the feature when no data */}
          {data.hangouts.totals.createdInPeriod === 0 && data.hangouts.totals.referencesInPeriod === 0 && (
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-10 text-center text-zinc-500">
              <p className="text-2xl mb-2">☕</p>
              <p className="text-sm">No hangouts in this period.</p>
              <p className="text-xs text-zinc-600 mt-1">Try a longer window or seed activity in <Link href="/hangouts" className="text-amber-400 hover:underline">/hangouts</Link>.</p>
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          REVENUE TAB — revenue + financial breakdown
          ════════════════════════════════════════════════════════════════════ */}
      {tab === 'revenue' && (
        <>
          <section>
            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Revenue</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <StatCard label="Collected"  value={`₺${data.revenue.collected.toLocaleString()}`} subColor="text-green-400" sub="Paid transactions" />
              <StatCard label="Pending"    value={`₺${data.revenue.pending.toLocaleString()}`}   subColor="text-amber-400" sub="Awaiting payment" href="/admin/payments" />
              <StatCard label="Refunded"   value={`₺${data.revenue.refunded.toLocaleString()}`}  subColor="text-zinc-400"  sub="Total refunded" />
            </div>
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
              <div className="text-xs font-semibold text-zinc-400 mb-3">Revenue collected — last {periodWindowLabel(period)} (₺)</div>
              <MiniBar values={data.revenue.byMonth} months={data.months} color="#34d399" />
              {data.revenue.byMonth.every(v => v === 0) && (
                <p className="text-xs text-zinc-600 mt-2">No paid transactions recorded yet.</p>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Financial breakdown</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

              {/* Revenue per club */}
              <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
                <div className="text-xs font-semibold text-zinc-400 mb-1">Revenue per club</div>
                <div className="text-xs text-zinc-600 mb-4">Ranked by total paid transactions (₺)</div>
                {data.revenueByClub?.length > 0 ? (
                  <div className="space-y-3">
                    {data.revenueByClub.map((c, i) => {
                      const max = data.revenueByClub[0]?.revenue ?? 1
                      return (
                        <div key={c.id}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-zinc-300 font-medium flex items-center gap-1.5">
                              <span className="text-zinc-600 text-xs w-3">{i + 1}</span>
                              {c.emoji} {c.name}
                            </span>
                            <span className="text-xs text-amber-400 font-bold">₺{c.revenue.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                              <div className="h-full bg-amber-500 rounded-full" style={{ width: `${(c.revenue / max) * 100}%` }} />
                            </div>
                            <span className="text-xs text-zinc-600 shrink-0">{c.payments} txn</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-600">No paid transactions yet.</p>
                )}
              </div>

              {/* Refund rate by host */}
              <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
                <div className="text-xs font-semibold text-zinc-400 mb-1">Refund rate by host</div>
                <div className="text-xs text-zinc-600 mb-4">Hosts with ≥3 transactions, ranked by refund rate</div>
                {data.refundRateByHost?.length > 0 ? (
                  <div className="space-y-3">
                    {data.refundRateByHost.map(h => {
                      const color = h.refundRate >= 30 ? '#ef4444' : h.refundRate >= 15 ? '#f59e0b' : '#34d399'
                      return (
                        <div key={h.hostId}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="min-w-0">
                              <span className="text-xs text-zinc-300 font-medium truncate block">{h.hostName}</span>
                              <span className="text-xs text-zinc-600">{h.clubName}</span>
                            </div>
                            <div className="text-right shrink-0 ml-3">
                              <span className="text-xs font-bold" style={{ color }}>{h.refundRate}%</span>
                              <span className="text-xs text-zinc-600 block">{h.refunded}/{h.paid + h.refunded} refunded</span>
                            </div>
                          </div>
                          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${h.refundRate}%`, backgroundColor: color }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-600">No refund data yet (requires ≥3 transactions per host).</p>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          HEALTH TAB — reports + top clubs
          ════════════════════════════════════════════════════════════════════ */}
      {tab === 'health' && (
        <section>
          <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Community health</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

            {/* Reports */}
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
              <div className="text-sm font-bold text-white mb-3">Reports</div>
              <div className="space-y-2">
                {[
                  { label: 'Pending',   count: data.reports.pending,   color: '#ef4444' },
                  { label: 'Actioned',  count: data.reports.actioned,  color: '#34d399' },
                  { label: 'Dismissed', count: data.reports.dismissed, color: '#71717a' },
                ].map(r => {
                  const total = data.reports.pending + data.reports.actioned + data.reports.dismissed || 1
                  return (
                    <div key={r.label}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-zinc-400">{r.label}</span>
                        <span className="text-zinc-300 font-semibold">{r.count}</span>
                      </div>
                      <FillBar pct={(r.count / total) * 100} color={r.color} />
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Top clubs */}
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
              <div className="px-5 py-3 border-b border-zinc-800">
                <div className="text-sm font-bold text-white">Top clubs by members</div>
              </div>
              <div className="divide-y divide-zinc-800">
                {data.topClubs.map(c => (
                  <Link key={c.id} href={`/admin/clubs/${c.id}`}
                    className="flex items-center gap-3 px-5 py-2.5 hover:bg-zinc-800/40 transition-colors">
                    <span className="text-lg">{c.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{c.name}</div>
                    </div>
                    <div className="text-right shrink-0 text-xs text-zinc-500">
                      <span className="text-zinc-300 font-semibold">{c.members}</span> members · <span>{c.events}</span> events
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

export default function AnalyticsPage() {
  return (
    <Suspense>
      <AnalyticsInner />
    </Suspense>
  )
}
