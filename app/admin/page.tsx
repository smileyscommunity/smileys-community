'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { resolveImageUrl, todayIstanbul } from '@/lib/data'

interface Stats {
  totalAccounts: number; members: number; hosts: number
  events: number; upcoming: number; rsvps: number
  newMembersThisMonth: number
  revenueCollected: number; revenuePending: number; pendingPayments: number
  pendingApplications: number; pendingReports: number
  trends: { members: number; rsvps: number; revenue: number }
  hangouts:   { active: number; today: number; referencesWeek: number }
  rsvpsByDay: number[]   // 7 entries, oldest first
}

interface AuditEntry {
  id: string; adminName: string; action: string
  description: string | null; createdAt: string; meta: any
}

interface AdminEvent {
  id: string; title: string; date: string; emoji: string
  totalSpots: number; _count: { attendees: number }
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
  const { user } = useAuth()
  const [stats,    setStats]    = useState<Stats | null>(null)
  const [audit,    setAudit]    = useState<AuditEntry[]>([])
  const [events,   setEvents]   = useState<AdminEvent[]>([])
  // Distinguish "not loaded yet" from "load failed" so we don't render the
  // … placeholder forever when /api/admin/stats 500s. errorMsg drives the
  // retry banner; loading drives the skeleton state.
  const [loading,  setLoading]  = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Use Istanbul-local date floor, not the UTC slice of new Date(), so events
  // on the same calendar day in Istanbul aren't dropped when admin's clock
  // crosses midnight UTC. Server-side filter + take so we fetch only the 6
  // upcoming events we render, instead of every published event ever.
  const load = useCallback(() => {
    setLoading(true)
    setErrorMsg(null)
    const today = todayIstanbul()
    Promise.all([
      fetch('/app/api/admin/stats',                                                  { credentials: 'include' }),
      fetch('/app/api/admin/audit?take=8',                                            { credentials: 'include' }),
      fetch(`/app/api/admin/events?status=published&from=${today}&take=6`,            { credentials: 'include' }),
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
    }).catch(err => {
      console.error('[admin dashboard load]', err)
      setErrorMsg('Could not load dashboard. Try again?')
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.name?.split(' ')[0] ?? 'Admin'

  const alerts = stats ? [
    stats.pendingApplications > 0 && {
      icon: '👤', label: `${stats.pendingApplications} application${stats.pendingApplications !== 1 ? 's' : ''} pending`,
      href: '/admin/applications', color: 'border-amber-500/30 bg-amber-500/5 text-amber-400',
    },
    stats.pendingPayments > 0 && {
      icon: '💳', label: `${stats.pendingPayments} payment${stats.pendingPayments !== 1 ? 's' : ''} · ₺${stats.revenuePending.toLocaleString()}`,
      href: '/admin/payments', color: 'border-violet-500/30 bg-violet-500/5 text-violet-400',
    },
    stats.pendingReports > 0 && {
      icon: '🚨', label: `${stats.pendingReports} report${stats.pendingReports !== 1 ? 's' : ''} to review`,
      href: '/admin/moderation', color: 'border-red-500/30 bg-red-500/5 text-red-400',
    },
  ].filter(Boolean) as { icon: string; label: string; href: string; color: string }[] : []

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
          <button onClick={load} disabled={loading}
            className="text-xs font-bold bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg">
            {loading ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {/* ── Alerts ── */}
      {alerts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {alerts.map((a, i) => (
            <Link key={i} href={a.href}
              className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl border text-sm font-semibold hover:opacity-80 transition-opacity ${a.color}`}>
              <span className="text-base shrink-0">{a.icon}</span>
              <span>{a.label}</span>
              <svg className="w-3.5 h-3.5 ml-auto opacity-60 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
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
        <Link href="/hangouts"
          className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-4 transition-colors group">
          <div className="flex items-start justify-between mb-3">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center text-lg bg-amber-500/10 text-amber-400">
              ☕
            </span>
            <span className="text-xs text-zinc-500 font-medium">Hangouts</span>
          </div>
          {stats ? (
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
                const pct = e.totalSpots > 0 ? Math.round((e._count.attendees / e.totalSpots) * 100) : 0
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
                        <span className="text-[11px] text-zinc-500 shrink-0 font-medium">{e._count.attendees}/{e.totalSpots}</span>
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
                const label = entry.action.replace('.', ' ').replace(/_/g, ' ')
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
    </div>
  )
}
