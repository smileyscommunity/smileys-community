'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import AlertsRow, { type Alert } from '@/components/admin/AlertsRow'
import Avatar from '@/components/admin/Avatar'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { loadFailure } from '@/lib/admin/useAdminLoad'
import { firstNameOf } from '@/lib/data'

interface ModStats {
  pendingApplications: number
  pendingReports: number
  approvalQueueEvents: number
  visitorsThisWeek: number
  recentMessages: {
    id: string; message: string; createdAt: string
    user:  { id: string; name: string; color: string }
    event: { id: string; title: string }
  }[]
  myEvents: {
    id: string; title: string; date: string; time: string
    spotsLeft: number; totalSpots: number; status: string
  }[]
}

export default function ModeratorPage() {
  const { user } = useAuth()
  const isHost = user?.isClubHost === true
  const [stats, setStats] = useState<ModStats | null>(null)
  const [loading, setLoading] = useState(true)
  // This is the moderator's landing page, so a broken mod-stats must not
  // read as "no work today". Show the failure and offer a retry instead.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    fetch('/app/api/admin/mod-stats', { credentials: 'include' })
      .then(async r => { if (!r.ok) throw await loadFailure(r); return r.json() })
      .then(d => { if (!cancelled && d) setStats(d) })
      .catch((e: Error) => { if (!cancelled) setLoadError(e?.message ?? 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadTick])

  const firstName = firstNameOf(user?.name) || 'Moderator'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const totalPriority = (stats?.pendingApplications ?? 0) + (stats?.pendingReports ?? 0)

  // Build the same shape AlertsRow expects, but with only the data
  // moderators are authorized to see (no payments). Keeps the "what needs
  // attention" surface visually consistent with /admin.
  const alerts: Alert[] = stats ? [
    stats.pendingApplications > 0 && {
      icon: '👤', label: `${stats.pendingApplications} application${stats.pendingApplications !== 1 ? 's' : ''} pending`,
      href: '/admin/applications', color: 'border-amber-500/30 bg-amber-500/5 text-amber-400',
    },
    stats.pendingReports > 0 && {
      icon: '🚨', label: `${stats.pendingReports} report${stats.pendingReports !== 1 ? 's' : ''} to review`,
      href: '/admin/moderation', color: 'border-red-500/30 bg-red-500/5 text-red-400',
    },
    stats.visitorsThisWeek > 0 && {
      icon: '👋', label: `${stats.visitorsThisWeek} visitor${stats.visitorsThisWeek !== 1 ? 's' : ''} this week`,
      href: '/visiting', color: 'border-blue-500/30 bg-blue-500/5 text-blue-400',
    },
  ].filter(Boolean) as Alert[] : []

  return (
    <div className="p-4 sm:p-6 space-y-5 text-white">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">{greeting}, {firstName}</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {user?.role === 'moderator' ? 'Moderator' : 'Admin'}{isHost ? ' · Host' : ''}
            {totalPriority > 0
              ? ` · ${totalPriority} item${totalPriority !== 1 ? 's' : ''} need your attention`
              : ' · All clear'}
          </p>
        </div>
        {totalPriority > 0 && (
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-red-500/10 border border-red-500/20 shrink-0">
            <span className="text-red-400 font-extrabold text-sm">{totalPriority}</span>
          </div>
        )}
      </div>

      {/* Shared "what needs attention" pill row — same component /admin
          uses, fed by the data moderators are authorized to see (apps +
          reports + visitors; no payments). */}
      <LoadErrorBanner message={loadError} onRetry={() => setReloadTick(n => n + 1)} title="Couldn't load Mod Home" />

      {!loading && !loadError && <AlertsRow alerts={alerts} />}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="h-28 bg-zinc-900 rounded-2xl border border-zinc-800 animate-pulse" />)}
        </div>
      ) : stats ? (
        <>
          {/* ── PRIORITY SECTION ── Applications + Reports hero cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

            {/* Applications — people & culture priority */}
            <Link href="/admin/applications"
              className={`rounded-2xl border p-6 transition-colors group ${
                stats.pendingApplications > 0
                  ? 'bg-amber-500/5 border-amber-500/30 hover:bg-amber-500/10'
                  : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'
              }`}>
              <div className="flex items-start justify-between mb-4">
                <div className="text-2xl">✦</div>
                <span className={`text-4xl font-extrabold ${stats.pendingApplications > 0 ? 'text-amber-400' : 'text-zinc-600'}`}>
                  {stats.pendingApplications}
                </span>
              </div>
              <div className="text-base font-bold text-white mb-1">Applications</div>
              <div className="text-xs text-zinc-500 mb-4">
                {stats.pendingApplications > 0
                  ? `${stats.pendingApplications} applicant${stats.pendingApplications !== 1 ? 's' : ''} waiting for vetting`
                  : 'No pending applications'}
              </div>
              <div className={`text-xs font-semibold ${stats.pendingApplications > 0 ? 'text-amber-400 group-hover:text-amber-300' : 'text-zinc-600'} transition-colors`}>
                {stats.pendingApplications > 0 ? 'Review now →' : 'All reviewed ✓'}
              </div>
            </Link>

            {/* Reports — community safety priority */}
            <Link href="/admin/moderation"
              className={`rounded-2xl border p-6 transition-colors group ${
                stats.pendingReports > 0
                  ? 'bg-red-500/5 border-red-500/30 hover:bg-red-500/10'
                  : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'
              }`}>
              <div className="flex items-start justify-between mb-4">
                <div className="text-2xl">⚑</div>
                <span className={`text-4xl font-extrabold ${stats.pendingReports > 0 ? 'text-red-400' : 'text-zinc-600'}`}>
                  {stats.pendingReports}
                </span>
              </div>
              <div className="text-base font-bold text-white mb-1">Reports</div>
              <div className="text-xs text-zinc-500 mb-4">
                {stats.pendingReports > 0
                  ? `${stats.pendingReports} report${stats.pendingReports !== 1 ? 's' : ''} pending review`
                  : 'No unresolved reports'}
              </div>
              <div className={`text-xs font-semibold ${stats.pendingReports > 0 ? 'text-red-400 group-hover:text-red-300' : 'text-zinc-600'} transition-colors`}>
                {stats.pendingReports > 0 ? 'Review now →' : 'All clear ✓'}
              </div>
            </Link>
          </div>

          {/* ── Quick-action strip ── */}
          <div className="grid grid-cols-3 gap-2">
            <Link href="/admin/applications"
              className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors text-center">
              <span className="text-lg">👤</span>
              <span className="text-xs font-semibold text-zinc-400">Vet Members</span>
            </Link>
            <Link href="/admin/moderation"
              className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors text-center">
              <span className="text-lg">🛡️</span>
              <span className="text-xs font-semibold text-zinc-400">Moderation</span>
            </Link>
            <Link href="/admin/moderation"
              className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors text-center">
              <span className="text-lg">◈</span>
              <span className="text-xs font-semibold text-zinc-400">
                Event Queue
                {stats.approvalQueueEvents > 0 && (
                  <span className="ml-1 text-violet-400">({stats.approvalQueueEvents})</span>
                )}
              </span>
            </Link>
          </div>

          {/* ── Recent Messages ── engagement monitoring */}
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <div>
                <div className="text-sm font-bold text-white">Recent messages</div>
                <div className="text-xs text-zinc-500 mt-0.5">Monitor for spam or toxic behaviour</div>
              </div>
              <Link href="/admin/moderation" className="text-xs text-zinc-500 hover:text-white transition-colors">
                Full log →
              </Link>
            </div>
            {stats.recentMessages.length === 0 ? (
              <div className="px-5 py-8 text-center text-zinc-500 text-sm">No messages yet.</div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {stats.recentMessages.map(m => (
                  <div key={m.id} className="flex items-start gap-3 px-5 py-3">
                    <Avatar name={m.user.name} color={m.user.color} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-white">{m.user.name}</span>
                        <span className="text-xs text-zinc-600">
                          in <Link href={`/events/${m.event.id}`} className="text-zinc-400 hover:text-white">{m.event.title}</Link>
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 truncate">{m.message}</p>
                    </div>
                    <span className="text-xs text-zinc-600 shrink-0">
                      {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── My Events (host only) ── */}
          {isHost && (
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
                <div>
                  <div className="text-sm font-bold text-white">My upcoming events</div>
                  <div className="text-xs text-zinc-500 mt-0.5">Events you're hosting</div>
                </div>
                <Link href="/admin/events" className="text-xs text-zinc-500 hover:text-white transition-colors">
                  Manage →
                </Link>
              </div>
              {stats.myEvents.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <div className="text-zinc-500 text-sm mb-3">No upcoming events.</div>
                  <Link href="/admin/events/new"
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-xl transition-colors">
                    + Create event
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-zinc-800">
                  {stats.myEvents.map(e => {
                    const going = e.totalSpots - e.spotsLeft
                    const pct = e.totalSpots > 0 ? Math.round((going / e.totalSpots) * 100) : 0
                    return (
                      <Link key={e.id} href={`/admin/events/${e.id}/edit`}
                        className="flex items-center gap-4 px-5 py-3.5 hover:bg-zinc-800/40 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-white truncate">{e.title}</div>
                          <div className="text-xs text-zinc-500 mt-0.5">
                            {new Date(e.date).toLocaleDateString()} · {e.time}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs font-semibold text-white">{going}/{e.totalSpots}</div>
                          <div className="text-xs text-zinc-500">{pct}% full</div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
