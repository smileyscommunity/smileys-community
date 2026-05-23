'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { resolveImageUrl } from '@/lib/data'

interface Stats {
  totalAccounts: number; members: number; hosts: number
  events: number; upcoming: number; rsvps: number
  newMembersThisMonth: number
  revenueCollected: number; revenuePending: number; pendingPayments: number
  pendingApplications: number; pendingReports: number
  trends: { members: number; rsvps: number; revenue: number }
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

function Trend({ v }: { v?: number }) {
  if (!v) return null
  const pos = v > 0
  return (
    <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md ${pos ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
      {pos ? '↑' : '↓'} {Math.abs(v)}%
    </span>
  )
}

export default function AdminPage() {
  const { user } = useAuth()
  const [stats,  setStats]  = useState<Stats | null>(null)
  const [audit,  setAudit]  = useState<AuditEntry[]>([])
  const [events, setEvents] = useState<AdminEvent[]>([])

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    Promise.all([
      fetch('/app/api/admin/stats',        { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      fetch('/app/api/admin/audit?take=8', { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      fetch('/app/api/admin/events?status=published', { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    ]).then(([s, a, e]) => {
      if (s) setStats(s)
      setAudit(Array.isArray(a) ? a : [])
      const evts = Array.isArray(e) ? e.filter((ev: AdminEvent) => ev.date >= today).slice(0, 6) : []
      setEvents(evts)
    })
  }, [])

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

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-500 font-medium">{greeting}</p>
          <h1 className="text-xl font-extrabold text-white tracking-tight">{firstName} 👋</h1>
        </div>
        <Link href="/admin/events/new"
          className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-colors shadow-lg shadow-amber-500/20">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Event
        </Link>
      </div>

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

      {/* ── Key stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: 'Members', value: stats?.members ?? '…',
            sub: `+${stats?.newMembersThisMonth ?? 0} this month`,
            trend: stats?.trends.members,
            icon: '👥', iconBg: 'bg-blue-500/10 text-blue-400',
            href: '/admin/users',
          },
          {
            label: 'Upcoming', value: stats?.upcoming ?? '…',
            sub: `${stats?.events ?? 0} total events`,
            icon: '🗓️', iconBg: 'bg-amber-500/10 text-amber-400',
            href: '/admin/events',
          },
          {
            label: 'RSVPs', value: stats?.rsvps ?? '…',
            sub: 'All-time attendances',
            trend: stats?.trends.rsvps,
            icon: '🎟️', iconBg: 'bg-green-500/10 text-green-400',
            href: '/admin/participants',
          },
          {
            label: 'Revenue', value: stats ? `₺${stats.revenueCollected.toLocaleString()}` : '…',
            sub: stats?.revenuePending ? `₺${stats.revenuePending.toLocaleString()} pending` : 'No pending',
            trend: stats?.trends.revenue,
            icon: '💰', iconBg: 'bg-violet-500/10 text-violet-400',
            href: '/admin/payments',
          },
        ].map(card => (
          <Link key={card.label} href={card.href}
            className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-4 transition-colors group">
            <div className="flex items-start justify-between mb-3">
              <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg ${card.iconBg}`}>
                {card.icon}
              </span>
              {'trend' in card && <Trend v={card.trend} />}
            </div>
            <div className="text-2xl font-extrabold text-white group-hover:text-amber-400 transition-colors">{card.value}</div>
            <div className="text-xs text-zinc-500 mt-0.5 font-medium">{card.label}</div>
            <div className="text-[11px] text-zinc-600 mt-1">{card.sub}</div>
          </Link>
        ))}
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
