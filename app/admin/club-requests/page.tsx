'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import Avatar from '@/components/admin/Avatar'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { loadFailure } from '@/lib/admin/useAdminLoad'
import { confirmToast } from '@/lib/confirmToast'
import { notifyModerationChanged } from '@/lib/modCounts'
import type { ClubStaffReason } from '@/lib/clubRequestRouting'

// Staff queue for club join requests. A club with no approved host has nobody
// who can see its requests from the club side, so they sat unanswered; this
// page lists them (city-scoped for moderators by the API) and acts through the
// same approve/decline endpoint hosts use. Requests to an inactive club land
// here too, host or not — that host can no longer answer them.

interface ClubRequest {
  userId: string; name: string; color: string
  requestedAt: string; ageDays: number; hasHost: boolean
  // Why only staff can answer it; null only in the "All pending" view.
  staffReason: ClubStaffReason | null
  club: { id: string; slug: string; name: string; emoji: string; cityName: string | null; isActive: boolean; isPrivate: boolean }
}

export default function ClubRequestsPage() {
  const { user } = useAuth()
  const [scope, setScope] = useState<'hostless' | 'all'>('hostless')
  const [requests, setRequests] = useState<ClubRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    fetch(`/app/api/admin/clubs/requests${scope === 'all' ? '?scope=all' : ''}`, { credentials: 'include' })
      .then(async r => { if (!r.ok) throw await loadFailure(r); return r.json() })
      .then(d => setRequests(Array.isArray(d?.requests) ? d.requests : []))
      .catch((e: Error) => setLoadError(e?.message ?? 'Failed to load'))
      .finally(() => setLoading(false))
  }, [scope])

  useEffect(() => { load() }, [load])

  async function act(r: ClubRequest, action: 'approve' | 'reject') {
    // Declining notifies the member, so it gets a second tap.
    if (action === 'reject' && !(await confirmToast(`Decline ${r.name}'s request to join ${r.club.name}?`, { confirmLabel: 'Decline' }))) return
    const key = `${r.club.id}:${r.userId}`
    setActing(key)
    try {
      const res = await fetch(`/app/api/clubs/${r.club.slug}/members`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: r.userId, action }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) { toast.error(d?.error ?? 'Could not update the request'); return }
      setRequests(prev => prev.filter(x => !(x.club.id === r.club.id && x.userId === r.userId)))
      notifyModerationChanged()
      toast.success(action === 'approve' ? 'Approved ✓' : 'Declined')
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-white text-2xl font-extrabold tracking-tight">Club requests</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {scope === 'hostless'
              ? 'Join requests to clubs with no approved host, or to inactive clubs — nobody else can answer these.'
              : 'Every pending join request you can act on.'}
          </p>
        </div>
        <div className="flex gap-1 bg-zinc-800 rounded-xl p-1 border border-zinc-700">
          {(['hostless', 'all'] as const).map(s => (
            <button key={s} onClick={() => setScope(s)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${scope === s ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'}`}>
              {s === 'hostless' ? 'Staff only' : 'All pending'}
            </button>
          ))}
        </div>
      </div>

      <LoadErrorBanner message={loadError} onRetry={load} title="Couldn't load club requests" />

      {loading && <p className="text-zinc-500 text-sm">Loading…</p>}

      {!loading && !loadError && requests.length === 0 && (
        <div className="text-center py-12 bg-zinc-900 border border-dashed border-zinc-800 rounded-2xl">
          <p className="text-white font-semibold">Nothing waiting</p>
          <p className="text-sm text-zinc-500 mt-1">No pending club requests in this view.</p>
        </div>
      )}

      {!loading && requests.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl divide-y divide-zinc-800">
          {requests.map(r => {
            const key = `${r.club.id}:${r.userId}`
            return (
              <div key={key} className="flex items-center gap-3 p-4 flex-wrap sm:flex-nowrap">
                <Avatar name={r.name} color={r.color} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{r.name}</p>
                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5 text-xs text-zinc-500">
                    <span>{r.club.emoji} {r.club.name}</span>
                    <span>· {r.club.cityName ?? 'Global'}</span>
                    <span className={r.ageDays >= 30 ? 'text-red-400' : ''}>· {r.ageDays === 0 ? 'today' : `${r.ageDays}d ago`}</span>
                    {!r.hasHost && <span className="font-semibold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400">No host</span>}
                    {r.staffReason === 'club_inactive' && <span className="font-semibold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400" title="Hosts can't act on an inactive club — only staff can answer this">Club inactive</span>}
                    {user?.role === 'admin' && (
                      <Link href={`/admin/clubs/${r.club.id}`} className="text-amber-400 hover:text-amber-300">Club →</Link>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => act(r, 'approve')} disabled={acting === key}
                    className="text-xs bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50">
                    Approve
                  </button>
                  <button onClick={() => act(r, 'reject')} disabled={acting === key}
                    className="text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50">
                    Decline
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
