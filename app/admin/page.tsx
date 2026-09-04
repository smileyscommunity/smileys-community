'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import {resolveImageUrl,  formatTime} from '@/lib/data'
import AlertsRow, { type Alert } from '@/components/admin/AlertsRow'
import { todayInTz, nowInTz, DEFAULT_TZ } from '@/lib/cityTime'
import { useCurrentCity } from '@/hooks/useCurrentCity'

interface TopHost {
  id: string; name: string; color: string; profilePhoto: string | null; count: number
}

interface Stats {
  // Which city these numbers describe; null = every city combined.
  city: { id: string; name: string; slug: string } | null
  totalAccounts: number; members: number; hosts: number
  events: number; upcoming: number; rsvps: number
  newMembersThisMonth: number
  revenueCollected: number; revenuePending: number; pendingPayments: number
  pendingApplications: number; pendingReports: number
  // Event join requests awaiting a decision (upcoming events only) —
  // the /admin/participants Pending inbox count.
  pendingJoinRequests: number
  // Events running today with live door-ops counts (sorted by time).
  todayEvents: { id: string; title: string; emoji: string; time: string; totalSpots: number; going: number; checkedIn: number }[]
  // #4 monitoring — count of email_failures rows in the last 24h.
  // Anything > 0 means SMTP/Resend is probably broken and members
  // are missing transactional emails. Surfaced as a red alert pill
  // so admin sees it before they hear from confused members.
  emailFailures24h: number
  // #5 monitoring — names of cron sweepers whose lastSuccessAt is
  // older than 2× their expected cadence (or never recorded).
  // Empty array when everything's healthy. Surfaced as a red
  // alert pill so silent cron failures don't go un-noticed.
  staleSweepers:    string[]
  // Multi-city liquidity signal — live cities with no upcoming event
  // (see lib/cityOps). Empty when every live city has something on the
  // calendar. `label` is pre-rendered by the API; `severity` is red once
  // the city has been live long enough that "just launched" no longer
  // explains the empty calendar.
  stalledCities:    { id: string; slug: string; name: string; members: number; daysLive: number; severity: 'amber' | 'red'; label: string }[]
  trends: { members: number; rsvps: number; revenue: number }
  hangouts:   {
    active: number; today: number; referencesWeek: number
    topHost: TopHost | null
  }
  visitorsThisWeek: number
  funnel:     { applications: number; approved: number; firstEvent: number; repeat: number }
  // Post-event survey quality rollup. wouldReturnRate is null when no
  // responses landed in the 30d window (no surveys dispatched yet, or
  // the events that ran got 0 responses). rateTrendPp is in
  // percentage-points: "+3pp" reads correctly for rates whereas a
  // relative %-change would mislead.
  quality?: {
    responses: number; anomalies: number
    wouldReturnRate: number | null
    anomalyRate:     number | null
    rateTrendPp:     number | null
    responsesTrend:  number
  }
  rsvpsByDay: number[]   // 7 entries, oldest first
  release:    string | null
  uptimeSeconds: number
}

interface AuditEntry {
  id: string; adminName: string; action: string
  description: string | null; createdAt: string; meta: any
}

interface AdminEvent {
  id: string; title: string; date: string; emoji: string
  totalSpots: number; spotsLeft: number; _count: { attendees: number }
  host: { name: string; color: string; profilePhoto: string | null } | null
}

const ACTION_COLOR: Record<string, string> = {
  'application.approve': 'bg-green-500/15 text-green-400',
  'application.reject':  'bg-red-500/15 text-red-400',
  'user.ban':            'bg-red-500/15 text-red-400',
  'user.remove':         'bg-red-500/15 text-red-400',
  'user.warn':           'bg-orange-500/15 text-orange-400',
  'user.role_change':    'bg-violet-500/15 text-violet-400',
  'payment.status':      'bg-blue-500/15 text-blue-400',
}

function timeAgo(date: string) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s/60)}m ago`
  if (s < 86400)return `${Math.floor(s/3600)}h ago`
  return `${Math.floor(s/86400)}d ago`
}

function Trend({ v }: { v?: number | null }) {
  // Only suppress when the value is genuinely unknown (null/undefined).
  // A real 0% week-over-week change is still data — surface it as a
  // neutral "no change" chip so admins can see we actually measured.
  if (v === undefined || v === null) return null
  if (v === 0) {
    return (
      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-zinc-700/40 text-zinc-400">
        = 0%
      </span>
    )
  }
  const pos = v > 0
  return (
    <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md ${pos ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
      {pos ? '↑' : '↓'} {Math.abs(v)}%
    </span>
  )
}

export default function AdminPage() {
  // Admin surfaces follow the city being administered.
  const tz = useCurrentCity()?.timezone ?? DEFAULT_TZ
  const { user } = useAuth()
  const [stats,    setStats]    = useState<Stats | null>(null)
  const [audit,    setAudit]    = useState<AuditEntry[]>([])
  const [events,   setEvents]   = useState<AdminEvent[]>([])
  // Distinguish "not loaded yet" from "load failed" so we don't render the
  // … placeholder forever when /api/admin/stats 500s. errorMsg drives the
  // retry banner; loading drives the skeleton state.
  const [loading,  setLoading]  = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // City scope. null = every city combined (the historical view). Persisted
  // to localStorage because the scope is a stance, not a one-off query: an
  // admin checking on a new city wants every visit to open there until they
  // say otherwise. Read lazily so SSR doesn't touch localStorage.
  const [cities, setCities] = useState<{ id: string; name: string; slug: string; status: string }[]>([])
  const [cityId, setCityId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem('admin_dash_city') || null
  })
  const setCityScope = useCallback((id: string | null) => {
    setCityId(id)
    if (id) window.localStorage.setItem('admin_dash_city', id)
    else    window.localStorage.removeItem('admin_dash_city')
  }, [])

  // Auto-refresh state — "Updated 12s ago" indicator + 60s background poll.
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [, setTick] = useState(0)  // forces re-render so the timer label ages

  // Use Istanbul-local date floor, not the UTC slice of new Date(), so events
  // on the same calendar day in Istanbul aren't dropped when admin's clock
  // crosses midnight UTC. Server-side filter + take so we fetch only the 6
  // upcoming events we render, instead of every published event ever.
  //
  // background=true skips the skeleton state so the 60s auto-poll doesn't
  // flicker the UI back to "loading" every minute.
  const load = useCallback((background = false) => {
    if (!background) setLoading(true)
    setErrorMsg(null)
    const today = todayInTz(tz)
    const cityQ = cityId ? `&city=${encodeURIComponent(cityId)}` : ''
    Promise.all([
      fetch(`/app/api/admin/stats${cityId ? `?city=${encodeURIComponent(cityId)}` : ''}`, { credentials: 'include' }),
      fetch('/app/api/admin/audit?take=8',                                            { credentials: 'include' }),
      fetch(`/app/api/admin/events?status=published&from=${today}&take=6${cityQ}`,     { credentials: 'include' }),
    ]).then(async ([sRes, aRes, eRes]) => {
      if (!sRes.ok) throw new Error('stats')
      const [s, a, e] = await Promise.all([
        sRes.json(),
        aRes.ok ? aRes.json() : [],
        eRes.ok ? eRes.json() : [],
      ])
      setStats(s)
      setAudit(Array.isArray(a) ? a : [])
      setEvents(Array.isArray(e) ? e : [])
      setLastRefresh(new Date())
    }).catch(err => {
      console.error('[admin dashboard load]', err)
      // Only show the banner on foreground load failures — a flaky 60s
      // poll shouldn't yank attention away from whatever the admin's
      // currently reading.
      if (!background) setErrorMsg('Could not load dashboard. Try again?')
    }).finally(() => { if (!background) setLoading(false) })
  }, [cityId])

  useEffect(() => { load(false) }, [load])

  // City list for the switcher. Fetched once — cities are created about as
  // often as a launch, so there's nothing to poll for. A stored city that
  // no longer exists (deleted between visits) falls back to every-city
  // rather than leaving the dashboard pinned to a 400.
  useEffect(() => {
    let cancelled = false
    fetch('/app/api/admin/cities', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((rows: { id: string; name: string; slug: string; status: string }[]) => {
        if (cancelled || !Array.isArray(rows)) return
        setCities(rows)
        setCityId(prev => {
          if (prev && !rows.some(c => c.id === prev)) {
            window.localStorage.removeItem('admin_dash_city')
            return null
          }
          return prev
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Background auto-refresh — every 60s, but pause when the tab is hidden
  // (saves DB load when nobody's looking) and resume immediately on focus
  // so a returning admin sees fresh data right away.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    function start() {
      if (timer) return
      timer = setInterval(() => { if (!document.hidden) load(true) }, 60_000)
    }
    function stop() { if (timer) { clearInterval(timer); timer = null } }
    function onVisibility() {
      if (document.hidden) stop()
      else { load(true); start() }
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [load])

  // Tick once a second so the "Updated Xs ago" label visibly counts up
  // without re-fetching anything.
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // The city's wall-clock, not the device's — same rationale (and hourCycle
  // gotcha) as the member dashboard's getGreeting().
  const hour = nowInTz(tz).hour
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.name?.split(' ')[0] ?? 'Admin'

  const alerts: Alert[] = stats ? [
    stats.pendingApplications > 0 && {
      icon: '👤', label: `${stats.pendingApplications} application${stats.pendingApplications !== 1 ? 's' : ''} pending`,
      href: '/admin/applications', color: 'border-amber-500/30 bg-amber-500/5 text-amber-400',
    },
    stats.pendingJoinRequests > 0 && {
      icon: '🎟️', label: `${stats.pendingJoinRequests} join request${stats.pendingJoinRequests !== 1 ? 's' : ''} pending`,
      href: '/admin/participants', color: 'border-amber-500/30 bg-amber-500/5 text-amber-400',
    },
    stats.pendingPayments > 0 && {
      icon: '💳', label: `${stats.pendingPayments} payment${stats.pendingPayments !== 1 ? 's' : ''} · ₺${stats.revenuePending.toLocaleString()}`,
      href: '/admin/payments', color: 'border-violet-500/30 bg-violet-500/5 text-violet-400',
    },
    stats.pendingReports > 0 && {
      icon: '🚨', label: `${stats.pendingReports} report${stats.pendingReports !== 1 ? 's' : ''} to review`,
      href: '/admin/moderation', color: 'border-red-500/30 bg-red-500/5 text-red-400',
    },
    // #4 monitoring — sits at the high-severity end of the alerts row
    // because a broken SMTP means refunds + verifications + lockout
    // alerts are all silently dropping. Links to the audit page where
    // the underlying failures are queryable.
    stats.emailFailures24h > 0 && {
      icon: '📭', label: `${stats.emailFailures24h} email failure${stats.emailFailures24h !== 1 ? 's' : ''} (24h)`,
      color: 'border-red-500/30 bg-red-500/5 text-red-400',  // no href — investigate in Resend / server logs
    },
    // #5 monitoring — cron sweeper has gone silent. Each name in
    // the array hasn't checked in for > 2× its expected cadence.
    // Common causes: bad CRON_SECRET, crashed process, DNS blip.
    // Label lists the offending sweepers so admin can grep the
    // crontab + server logs directly.
    stats.staleSweepers && stats.staleSweepers.length > 0 && {
      icon: '⏱️', label: `${stats.staleSweepers.length} stale cron${stats.staleSweepers.length !== 1 ? 's' : ''}: ${stats.staleSweepers.join(', ')}`,
      color: 'border-red-500/30 bg-red-500/5 text-red-400',  // no href — the label names the stale sweepers; fix is server-side
    },
    // Stalled-city pill — a live city with nothing on the calendar is the
    // one thing the city status flag cannot see. Amber for a fresh launch,
    // red once it has been live long enough that the empty calendar is the
    // problem. Links to the cities page, where the city's hosts are listed.
    stats.stalledCities && stats.stalledCities.length > 0 && {
      icon: '🌱',
      label: `${stats.stalledCities.length} live ${stats.stalledCities.length !== 1 ? 'cities' : 'city'} with no upcoming event: ${stats.stalledCities.map(c => c.label).join(' · ')}`,
      href: '/admin/cities',
      color: stats.stalledCities.some(c => c.severity === 'red')
        ? 'border-red-500/30 bg-red-500/5 text-red-400'
        : 'border-amber-500/30 bg-amber-500/5 text-amber-400',
    },
    // Visitors pill — soft signal, not a "do something" alert. Sits in the
    // same row so admins see "what's happening" + "what needs me" together.
    stats.visitorsThisWeek > 0 && {
      icon: '👋', label: `${stats.visitorsThisWeek} visitor${stats.visitorsThisWeek !== 1 ? 's' : ''} this week`,
      href: '/visiting', color: 'border-blue-500/30 bg-blue-500/5 text-blue-400',
    },
  ].filter(Boolean) as Alert[] : []

  // "Updated Xs ago" indicator label — counts up between background
  // refreshes so the page reads as live, not stale.
  const refreshLabel = (() => {
    if (!lastRefresh) return ''
    const s = Math.floor((Date.now() - lastRefresh.getTime()) / 1000)
    if (s < 5)     return 'Updated just now'
    if (s < 60)    return `Updated ${s}s ago`
    if (s < 3600)  return `Updated ${Math.floor(s / 60)}m ago`
    return `Updated ${Math.floor(s / 3600)}h ago`
  })()

  // Conversion funnel one-liner — shows the funnel as percentages of the
  // previous stage. Hidden when no applications exist (zero-data community).
  const funnelLine = stats && stats.funnel.applications > 0 ? (() => {
    const f = stats.funnel
    const approvedPct   = Math.round((f.approved   / f.applications) * 100)
    const firstPct      = f.approved   > 0 ? Math.round((f.firstEvent / f.approved) * 100)   : 0
    const repeatPct     = f.firstEvent > 0 ? Math.round((f.repeat     / f.firstEvent) * 100) : 0
    return { approvedPct, firstPct, repeatPct }
  })() : null

  // Deploy footer — "Last deploy 23m ago" from uptimeSeconds (seconds since
  // pm2 restart ≈ seconds since deploy). Compressed format reads at a glance.
  const deployLabel = stats ? (() => {
    const s = stats.uptimeSeconds
    if (s < 60)    return `${s}s ago`
    if (s < 3600)  return `${Math.floor(s / 60)}m ago`
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`
    return `${Math.floor(s / 86400)}d ago`
  })() : ''

  return (
    <div className="p-4 sm:p-6 space-y-6 text-white">

      {/* ── Header + quick search ──
          Greeting on top, persistent search input below. The input is a
          thin shim that dispatches the same 'open-command-palette' event
          the mobile search button uses — gives moderators a discoverable
          handle for ⌘K's underlying logic without duplicating it. */}
      <div className="space-y-3">
        <div>
          <p className="text-xs text-zinc-500 font-medium">{greeting}</p>
          <h1 className="text-xl font-extrabold text-white tracking-tight">{firstName} 👋</h1>
        </div>

        {/* ── City scope ──
            Pills rather than a <select>: with a handful of cities they're
            one tap instead of two, and the current scope stays readable
            without opening anything. Only rendered once more than one city
            exists — a single-city platform has no scope to choose. */}
        {cities.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {[{ id: null as string | null, name: 'All cities', status: 'live' }, ...cities].map(c => {
              const active = cityId === c.id
              return (
                <button key={c.id ?? 'all'} onClick={() => setCityScope(c.id)}
                  aria-pressed={active}
                  className={`min-h-9 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    active
                      ? 'bg-white text-zinc-900 border-white'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200'
                  }`}>
                  {c.name}
                  {c.status !== 'live' && c.id && (
                    <span className={`ml-1.5 font-semibold ${active ? 'text-zinc-500' : 'text-zinc-600'}`}>soon</span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Email + cron health are platform-level facts with no city
            dimension, so they keep reporting network-wide while everything
            else narrows. Say so rather than let a scoped dashboard imply
            Bodrum has its own SMTP. */}
        {cityId && stats?.city && (
          <p className="text-[11px] text-zinc-500">
            Counts below are <span className="font-bold text-zinc-400">{stats.city.name}</span> only.
            Email and cron health stay platform-wide.
          </p>
        )}
        <button onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}
          className="w-full sm:max-w-md flex items-center gap-2.5 px-3.5 py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-xl transition-colors text-left">
          <svg className="w-4 h-4 text-zinc-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="text-sm text-zinc-500 flex-1">Search users, events, listings…</span>
          <span className="hidden sm:inline text-[10px] font-bold text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded">⌘K</span>
        </button>
      </div>

      {/* ── Load error ── */}
      {errorMsg && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-red-300 font-medium">⚠ {errorMsg}</p>
          <button onClick={() => load(false)} disabled={loading}
            className="text-xs font-bold bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg">
            {loading ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {/* ── Happening today ── door-ops hero. On event days the admin's
          top job is the door — who's arrived, who's missing — so today's
          events get top billing with live counts and one-tap routes into
          Check-in and the participants page. Self-hides on quiet days;
          counts refresh with the 60s background poll. */}
      {stats && stats.todayEvents.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
          <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
            </span>
            <span className="text-xs font-bold text-amber-400 uppercase tracking-widest">Happening today</span>
          </div>
          <div className="divide-y divide-zinc-800/60">
            {stats.todayEvents.map(e => (
              <div key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <span className="text-xl shrink-0">{e.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">{e.title}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    🕖 {formatTime(e.time)} · {e.going} going ·{' '}
                    <span className={e.checkedIn > 0 ? 'text-green-400 font-semibold' : ''}>{e.checkedIn} checked in</span>
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Link href={`/admin/checkin?event=${e.id}`}
                    className="text-xs font-bold px-3 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors">
                    ✓ Check-in
                  </Link>
                  <Link href={`/admin/events/${e.id}/participants`}
                    className="text-xs font-semibold px-3 py-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors">
                    People
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Alerts ── shared with /admin/moderator via AlertsRow component */}
      <AlertsRow alerts={alerts} />

      {/* ── Quick actions ──
          Shortcuts to the three most-common admin ops that otherwise need
          two clicks (open sidebar → click section → land on page). Pure
          link buttons; no new endpoints. */}
      {/* Stacked icon+label tiles instead of an icon-only row. Old
          layout hid the label below sm so phones got three tiny
          icon-only chips with no context — admins had to remember
          which icon meant which. Now each tile is a comfortable tap
          target with a visible label at every viewport. */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { href: '/admin/events/new',                    label: 'New Event',  icon: '➕' },
          { href: '/admin/announcements?tab=announcement', label: 'Announce',  icon: '📣' },
          { href: '/admin/checkin',                        label: 'Check-In',  icon: '✓' },
        ].map(a => (
          <Link key={a.href} href={a.href}
            className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-3 sm:py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-xl text-[11px] sm:text-xs font-semibold text-zinc-300 transition-colors text-center">
            <span className="text-base sm:text-sm leading-none">{a.icon}</span>
            <span className="leading-tight">{a.label}</span>
          </Link>
        ))}
      </div>

      {/* ── Conversion funnel one-liner ──
          Applications → Approved → First event → Repeat, as percentages of
          the previous stage. Read in one glance: "where are we losing
          people?" Hidden when applications = 0 (zero-data community). */}
      {funnelLine && stats && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-xs text-zinc-400 overflow-x-auto whitespace-nowrap">
          <span className="font-bold text-white">{stats.funnel.applications}</span> applications
          <span className="text-zinc-600 mx-2">→</span>
          <span className="font-bold text-white">{stats.funnel.approved}</span> approved
          <span className="text-amber-400 ml-1">({funnelLine.approvedPct}%)</span>
          <span className="text-zinc-600 mx-2">→</span>
          <span className="font-bold text-white">{stats.funnel.firstEvent}</span> first event
          <span className={`ml-1 ${funnelLine.firstPct >= 50 ? 'text-green-400' : 'text-amber-400'}`}>({funnelLine.firstPct}%)</span>
          <span className="text-zinc-600 mx-2">→</span>
          <span className="font-bold text-white">{stats.funnel.repeat}</span> repeat
          <span className={`ml-1 ${funnelLine.repeatPct >= 50 ? 'text-green-400' : 'text-amber-400'}`}>({funnelLine.repeatPct}%)</span>
        </div>
      )}

      {/* ── Quality (post-event survey rollup) ──
          Last 30 days: the would-attend-again rate, the anomaly rate,
          and how many responses we've actually collected. The trend
          arrow is in percentage POINTS not relative %-change, because
          a relative move on a rate ("84% is 5% higher than 80%") reads
          wrong. Hidden when no survey responses have landed yet. */}
      {stats?.quality && stats.quality.responses > 0 && (
        <Link href={stats.quality.anomalies > 0 ? '/admin/moderation?tab=reports&surveyOnly=1' : '/admin/moderation'} className="block rounded-2xl border border-zinc-800 bg-zinc-900 hover:border-zinc-700 transition-colors p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold text-white">Quality · last 30 days</h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                {stats.quality.responses} post-event response{stats.quality.responses === 1 ? '' : 's'} collected
              </p>
            </div>
            {stats.quality.anomalies > 0 && (
              <span className="text-xs font-bold px-2 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 shrink-0">
                ⚠ {stats.quality.anomalies} flag{stats.quality.anomalies === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {/* 2-up on mobile so each tile gets breathing room with the
              text-3xl figure + uppercase label; back to 3 columns at
              sm+ where the row has horizontal space. Responses spans
              both columns on mobile so it fills the orphan slot
              cleanly instead of half-row-stranded. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <div className={`text-2xl sm:text-3xl font-extrabold ${
                stats.quality.wouldReturnRate === null  ? 'text-zinc-600'
                  : stats.quality.wouldReturnRate >= 80 ? 'text-green-400'
                  : stats.quality.wouldReturnRate >= 60 ? 'text-amber-400'
                  : 'text-red-400'
              }`}>
                {stats.quality.wouldReturnRate === null ? '—' : `${stats.quality.wouldReturnRate}%`}
              </div>
              <div className="text-[10px] sm:text-xs text-zinc-500 mt-0.5 uppercase tracking-wider">Would return</div>
              {stats.quality.rateTrendPp !== null && stats.quality.rateTrendPp !== 0 && (
                <div className={`text-[10px] mt-1 ${stats.quality.rateTrendPp > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {stats.quality.rateTrendPp > 0 ? '+' : ''}{stats.quality.rateTrendPp}pp vs prior 30d
                </div>
              )}
            </div>
            <div>
              <div className={`text-2xl sm:text-3xl font-extrabold ${
                stats.quality.anomalyRate === null   ? 'text-zinc-600'
                  : stats.quality.anomalyRate === 0  ? 'text-green-400'
                  : stats.quality.anomalyRate < 5    ? 'text-amber-400'
                  : 'text-red-400'
              }`}>
                {stats.quality.anomalyRate === null ? '—' : `${stats.quality.anomalyRate}%`}
              </div>
              <div className="text-[10px] sm:text-xs text-zinc-500 mt-0.5 uppercase tracking-wider">Anomaly rate</div>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <div className="text-2xl sm:text-3xl font-extrabold text-white">{stats.quality.responses}</div>
              <div className="text-[10px] sm:text-xs text-zinc-500 mt-0.5 uppercase tracking-wider">Responses</div>
              {stats.quality.responsesTrend !== 0 && (
                <div className={`text-[10px] mt-1 ${stats.quality.responsesTrend > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {stats.quality.responsesTrend > 0 ? '+' : ''}{stats.quality.responsesTrend}% vs prior 30d
                </div>
              )}
            </div>
          </div>
        </Link>
      )}

      {/* ── Key stats ──
          Card value/sub render as skeleton bars while loading (replaces the
          old "…" placeholder which read as actual content). When stats has
          loaded, the real value or formatted string shows. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {([
          {
            label: 'Members', value: stats?.members,
            sub: stats ? `+${stats.newMembersThisMonth} this month` : null,
            trend: stats?.trends.members,
            icon: '👥', iconBg: 'bg-blue-500/10 text-blue-400',
            href: '/admin/users',
          },
          {
            label: 'Upcoming', value: stats?.upcoming,
            // sub used to be "X total events" — pure noise on a dashboard
            // where admins care about what's coming, not the lifetime
            // count. Dropped; card stays compact.
            sub: null,
            icon: '🗓️', iconBg: 'bg-amber-500/10 text-amber-400',
            href: '/admin/events',
          },
          {
            label: 'RSVPs', value: stats?.rsvps,
            sub: stats ? 'All-time attendances' : null,
            trend: stats?.trends.rsvps,
            icon: '🎟️', iconBg: 'bg-green-500/10 text-green-400',
            href: '/admin/participants',
          },
          {
            label: 'Revenue', value: stats ? `₺${stats.revenueCollected.toLocaleString()}` : undefined,
            sub: stats ? (stats.revenuePending ? `₺${stats.revenuePending.toLocaleString()} pending` : 'No pending') : null,
            trend: stats?.trends.revenue,
            icon: '💰', iconBg: 'bg-violet-500/10 text-violet-400',
            href: '/admin/payments',
          },
        ] as {
          label: string; value: string | number | undefined; sub: string | null
          trend?: number; icon: string; iconBg: string; href: string
        }[]).map(card => (
          <Link key={card.label} href={card.href}
            className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-4 transition-colors group">
            <div className="flex items-start justify-between mb-3">
              <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg ${card.iconBg}`}>
                {card.icon}
              </span>
              {/* Explicit undefined check beats `'trend' in card` (which
                  fires even when the key is set to undefined). */}
              {card.trend !== undefined && <Trend v={card.trend} />}
            </div>
            {card.value === undefined
              ? <div className="h-7 w-20 rounded-md bg-zinc-800 animate-pulse" />
              : <div className="text-2xl font-extrabold text-white group-hover:text-amber-400 transition-colors">{card.value}</div>}
            <div className="text-xs text-zinc-500 mt-0.5 font-medium">{card.label}</div>
            {card.sub === null && card.value === undefined
              ? <div className="h-3 w-16 rounded-md bg-zinc-800/60 animate-pulse mt-1.5" />
              : card.sub && <div className="text-[11px] text-zinc-600 mt-1">{card.sub}</div>}
          </Link>
        ))}
      </div>

      {/* ── Hangouts pulse + RSVPs sparkline ──
          Two complementary signals: hangouts is the new spontaneous-meetup
          surface (was completely invisible from admin before); RSVPs-per-day
          gives the short-term momentum signal the single trend chip can't
          show. Side-by-side on desktop, stacked on mobile. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Hangouts pulse */}
        <Link href="/admin/hangouts"
          className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-4 transition-colors group">
          <div className="flex items-start justify-between mb-3">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center text-lg bg-amber-500/10 text-amber-400">
              ☕
            </span>
            <span className="text-xs text-zinc-500 font-medium">Hangouts</span>
          </div>
          {stats ? (
            <>
              <div className="flex items-end gap-5">
                <div>
                  <div className="text-2xl font-extrabold text-white group-hover:text-amber-400 transition-colors">{stats.hangouts.active}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">active</div>
                </div>
                <div>
                  <div className="text-2xl font-extrabold text-zinc-300">{stats.hangouts.today}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">today</div>
                </div>
                <div>
                  <div className="text-2xl font-extrabold text-zinc-300">{stats.hangouts.referencesWeek}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">refs / 7d</div>
                </div>
              </div>
              {/* Top host this week — surfaces the rising connector. Hidden
                  when nobody posted any hangouts in the window. */}
              {stats.hangouts.topHost && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-zinc-800">
                  <div className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                    style={{ backgroundColor: stats.hangouts.topHost.color }}>
                    {stats.hangouts.topHost.profilePhoto
                      ? <img src={resolveImageUrl(stats.hangouts.topHost.profilePhoto)} alt={stats.hangouts.topHost.name} className="w-full h-full object-cover" />
                      : stats.hangouts.topHost.name[0]}
                  </div>
                  <span className="text-[11px] text-zinc-500">
                    Top host this week: <span className="text-zinc-300 font-medium">{stats.hangouts.topHost.name}</span>
                    <span className="text-zinc-600"> · {stats.hangouts.topHost.count} hangout{stats.hangouts.topHost.count !== 1 ? 's' : ''}</span>
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-end gap-5">
              {[1, 2, 3].map(i => (
                <div key={i}>
                  <div className="h-7 w-10 rounded-md bg-zinc-800 animate-pulse" />
                  <div className="h-3 w-14 rounded-md bg-zinc-800/60 animate-pulse mt-1.5" />
                </div>
              ))}
            </div>
          )}
        </Link>

        {/* RSVPs sparkline — last 7 days, oldest left → newest right */}
        <Link href="/admin/analytics?tab=events"
          className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-4 transition-colors group">
          <div className="flex items-start justify-between mb-3">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center text-lg bg-green-500/10 text-green-400">
              🎟️
            </span>
            <span className="text-xs text-zinc-500 font-medium">RSVPs · last 7 days</span>
          </div>
          {stats ? (() => {
            const arr = stats.rsvpsByDay
            const max = Math.max(...arr, 1)
            const total = arr.reduce((s, v) => s + v, 0)
            return (
              <>
                <div className="text-2xl font-extrabold text-white group-hover:text-amber-400 transition-colors">{total}</div>
                <div className="text-[11px] text-zinc-600 mt-0.5 mb-3">attendances this week</div>
                <div className="flex items-end gap-1 h-10">
                  {arr.map((v, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end">
                      <div
                        className="w-full rounded-t bg-green-500/80"
                        style={{ height: `${Math.max((v / max) * 36, v > 0 ? 4 : 1)}px` }}
                        title={`${v} on day ${i + 1}`}
                      />
                    </div>
                  ))}
                </div>
              </>
            )
          })() : (
            <>
              <div className="h-7 w-16 rounded-md bg-zinc-800 animate-pulse" />
              <div className="h-3 w-32 rounded-md bg-zinc-800/60 animate-pulse mt-1.5 mb-3" />
              <div className="h-10 w-full rounded-md bg-zinc-800/60 animate-pulse" />
            </>
          )}
        </Link>
      </div>

      {/* ── Main grid: Events + Audit ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Upcoming events */}
        <div className="lg:col-span-3 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
            <div>
              <h2 className="text-sm font-bold text-white">Upcoming Events</h2>
              <p className="text-xs text-zinc-500 mt-0.5">{events.length} next up</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/admin/events/new"
                className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg font-semibold transition-colors">
                + New
              </Link>
              <Link href="/admin/events" className="text-xs text-amber-400 hover:text-amber-300 font-semibold">
                All →
              </Link>
            </div>
          </div>

          {events.length === 0 ? (
            <div className="px-5 py-12 text-center text-zinc-500 text-sm">No upcoming events.</div>
          ) : (
            <div className="divide-y divide-zinc-800/60">
              {events.map(e => {
                const pct = e.totalSpots > 0 ? Math.round(((e.totalSpots - e.spotsLeft) / e.totalSpots) * 100) : 0
                const barColor = pct >= 90 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-500' : 'bg-emerald-500'
                return (
                  <Link key={e.id} href={`/admin/events/${e.id}/edit`}
                    className="flex items-center gap-3 px-5 py-3.5 hover:bg-zinc-800/40 transition-colors group">
                    <div className="w-9 h-9 rounded-xl bg-zinc-800 flex items-center justify-center text-lg shrink-0 group-hover:bg-zinc-700 transition-colors">
                      {e.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-200 group-hover:text-white truncate transition-colors">{e.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[11px] text-zinc-500 shrink-0 font-medium">{e.totalSpots - e.spotsLeft}/{e.totalSpots}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-zinc-400 font-medium">
                        {new Date(e.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </p>
                      {e.host && (
                        <div className="flex items-center justify-end gap-1 mt-1">
                          <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center text-white text-[8px] font-bold shrink-0"
                            style={{ backgroundColor: e.host.color }}>
                            {e.host.profilePhoto
                              ? <img src={resolveImageUrl(e.host.profilePhoto)} alt={e.host.name} className="w-full h-full object-cover" />
                              : e.host.name.slice(0, 2).toUpperCase()}
                          </div>
                          <span className="text-[11px] text-zinc-500">{e.host.name.split(' ')[0]}</span>
                        </div>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Audit log */}
        <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
            <div>
              <h2 className="text-sm font-bold text-white">Recent Activity</h2>
              <p className="text-xs text-zinc-500 mt-0.5">Latest admin actions</p>
            </div>
            <Link href="/admin/audit" className="text-xs text-amber-400 hover:text-amber-300 font-semibold">
              Full log →
            </Link>
          </div>

          {audit.length === 0 ? (
            <div className="px-5 py-12 text-center text-zinc-500 text-sm">No actions logged yet.</div>
          ) : (
            <div className="divide-y divide-zinc-800/60">
              {audit.map(entry => {
                const colorCls = ACTION_COLOR[entry.action] ?? 'bg-zinc-700 text-zinc-400'
                const label = (entry.action ?? '').replace('.', ' ').replace(/_/g, ' ')
                const targetName = entry.meta?.name || entry.meta?.title
                return (
                  <div key={entry.id} className="px-5 py-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-zinc-300 truncate">{entry.adminName}</span>
                      <span className={`text-[9px] font-black uppercase tracking-tight px-1.5 py-0.5 rounded-md shrink-0 ${colorCls}`}>
                        {label}
                      </span>
                      <span className="text-[10px] text-zinc-600 ml-auto shrink-0">{timeAgo(entry.createdAt)}</span>
                    </div>
                    {targetName && (
                      <p className="text-xs text-zinc-500 truncate">{targetName}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>

      {/* ── Deploy + refresh footer ──
          Tiny strip with the live release + "Updated Xs ago." Background
          poll updates lastRefresh every 60s; tick effect re-renders the
          label every 1s so it visibly counts up. */}
      {stats?.release && (
        <div className="text-[10px] text-zinc-600 text-center pt-2">
          Release <span className="font-mono text-zinc-500">{stats.release}</span>
          <span className="mx-1.5">·</span>
          Deployed {deployLabel}
          {refreshLabel && (
            <>
              <span className="mx-1.5">·</span>
              {refreshLabel}
            </>
          )}
        </div>
      )}
    </div>
  )
}
