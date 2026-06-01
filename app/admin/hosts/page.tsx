'use client'

// /admin/hosts — every approved club host on the platform, with
// activity stats + inline promote/demote affordances. Previously
// did its own client-side aggregation via an N+1 against
// /api/admin/clubs/[id]/memberships; now fetches one shaped
// payload from /api/admin/hosts (server-side groupBy) so the
// page loads in one round trip regardless of club count.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { getInitials } from '@/lib/data'

interface Host {
  userId:         string
  user:           { id: string; name: string; email: string; color: string }
  clubs:          { id: string; name: string; emoji: string }[]
  eventCount:     number
  eventCount90d:  number
  totalAttendees: number
  lastEventAt:    string | null
}

type ActivityFilter = 'all' | 'active' | 'inactive'

export default function AdminHostsPage() {
  const [hosts,     setHosts]     = useState<Host[] | null>(null)
  const [error,     setError]     = useState<string | null>(null)
  const [search,    setSearch]    = useState('')
  const [activity,  setActivity]  = useState<ActivityFilter>('all')
  const [promoting, setPromoting] = useState(false)

  const load = useCallback(() => {
    setError(null)
    fetch('/app/api/admin/hosts', { credentials: 'include' })
      .then(async r => {
        // Real error handling — was silently treating 401/403/500
        // as "no hosts" because the unchecked .json() let the
        // error body slip through as data and fail Array.isArray
        // downstream.
        if (!r.ok) {
          const text = await r.text().catch(() => '')
          throw new Error(`${r.status}: ${text.slice(0, 200) || r.statusText}`)
        }
        return r.json() as Promise<{ hosts: Host[] }>
      })
      .then(d => setHosts(d.hosts))
      .catch(e => setError(e.message ?? 'Failed to load'))
  }, [])
  useEffect(load, [load])

  // Filtered + searched view. Recomputed on each render — cheap
  // for a list of dozens.
  const visible = useMemo<Host[]>(() => {
    if (!hosts) return []
    const q = search.trim().toLowerCase()
    return hosts.filter(h => {
      if (q && !h.user.name.toLowerCase().includes(q) && !h.user.email.toLowerCase().includes(q)) return false
      if (activity === 'active'   && h.eventCount90d === 0) return false
      if (activity === 'inactive' && h.eventCount90d  >  0) return false
      return true
    })
  }, [hosts, search, activity])

  const inactiveCount = useMemo(() => hosts?.filter(h => h.eventCount90d === 0).length ?? 0, [hosts])

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-white text-2xl font-extrabold tracking-tight">Hosts</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {hosts === null
              ? '—'
              : `${hosts.length} host${hosts.length === 1 ? '' : 's'}${inactiveCount ? ` · ${inactiveCount} inactive (no events in 90d)` : ''}`}
          </p>
        </div>
        <button onClick={() => setPromoting(s => !s)}
          className="text-xs px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold transition-colors">
          {promoting ? 'Close' : '+ Promote member'}
        </button>
      </div>

      {promoting && (
        <PromotePanel onSaved={() => { setPromoting(false); load() }} onCancel={() => setPromoting(false)} />
      )}

      {/* Search + activity filter. The activity filter is the
          high-leverage one — admin's primary job on this page is
          spotting hosts who haven't run anything recently. */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="flex-1 min-w-[200px] bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
        <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
          {(['all', 'active', 'inactive'] as const).map(opt => (
            <button key={opt} onClick={() => setActivity(opt)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activity === opt ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'
              }`}>
              {opt[0].toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4">
          <p className="text-sm font-bold text-red-300">Couldn&apos;t load hosts</p>
          <p className="text-xs text-red-400/80 mt-1 break-all">{error}</p>
          <button onClick={load}
            className="mt-3 text-xs px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 font-semibold">
            Retry
          </button>
        </div>
      )}

      {!error && hosts === null && <HostSkeleton />}

      {!error && hosts !== null && hosts.length === 0 && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-10 text-center">
          <div className="text-3xl mb-2">👤</div>
          <p className="text-zinc-400 text-sm">No club hosts yet.</p>
          <p className="text-zinc-500 text-xs mt-1">Use the &ldquo;Promote member&rdquo; button above or set someone&apos;s role in their club&apos;s members panel.</p>
        </div>
      )}

      {!error && hosts !== null && hosts.length > 0 && visible.length === 0 && (
        <p className="text-sm text-zinc-500 px-1">No matches for the current search/filter.</p>
      )}

      {!error && visible.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map(host => <HostCard key={host.userId} host={host} onChanged={load} />)}
        </div>
      )}
    </div>
  )
}

function HostCard({ host, onChanged }: { host: Host; onChanged: () => void }) {
  const [busyClubId, setBusyClubId] = useState<string | null>(null)
  const isInactive = host.eventCount90d === 0

  async function demote(clubId: string, clubName: string) {
    if (!confirm(`Demote ${host.user.name} from ${clubName} (role → member)?`)) return
    setBusyClubId(clubId)
    try {
      const res = await fetch(`/app/api/admin/clubs/${clubId}/memberships`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: host.userId, role: 'member' }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error ?? 'Demote failed')
        return
      }
      toast.success(`Demoted ${host.user.name.split(' ')[0]} from ${clubName}`)
      onChanged()
    } finally {
      setBusyClubId(null)
    }
  }

  return (
    <div className={`bg-zinc-900 rounded-2xl border p-5 flex items-start gap-4 ${
      isInactive ? 'border-amber-500/20' : 'border-zinc-800'
    }`}>
      <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0 mt-0.5"
        style={{ backgroundColor: host.user.color }}>
        {getInitials(host.user.name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-white text-sm truncate">{host.user.name}</span>
          {isInactive && <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">Idle 90d</span>}
        </div>
        <a href={`mailto:${host.user.email}`} className="text-xs text-zinc-500 hover:text-amber-400 truncate block">{host.user.email}</a>

        <div className="flex items-center gap-3 flex-wrap mt-1.5 text-xs text-zinc-400">
          <span>🗓 <strong className="text-white">{host.eventCount}</strong> total</span>
          <span>📈 <strong className="text-white">{host.eventCount90d}</strong> in 90d</span>
          <span>👥 <strong className="text-white">{host.totalAttendees}</strong></span>
        </div>
        {host.lastEventAt && (
          <p className="text-[10px] text-zinc-500 mt-0.5">
            Last event: {new Date(host.lastEventAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        )}

        {/* Club tags now double as the demote affordance — tap the
            × on a club to demote from just that one. Removing the
            host's role on every club they hold via a single "Demote
            everywhere" would be too easy a way to ruin the data. */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {host.clubs.map(club => (
            <span key={club.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-800 rounded-lg text-xs text-amber-400 font-medium border border-zinc-700">
              <span>{club.emoji} {club.name}</span>
              <button onClick={() => demote(club.id, club.name)} disabled={busyClubId === club.id}
                title={`Demote from ${club.name}`}
                aria-label={`Demote from ${club.name}`}
                className="ml-0.5 text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-50">
                {busyClubId === club.id ? '…' : '×'}
              </button>
            </span>
          ))}
        </div>
      </div>
      <Link href={`/admin/users/${host.userId}`}
        className="text-xs px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors font-semibold shrink-0">
        View
      </Link>
    </div>
  )
}

// Page-shape skeleton — same outer grid as the real list so the
// layout doesn't jump when the data lands.
function HostSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-zinc-800 animate-pulse shrink-0 mt-0.5" />
          <div className="flex-1 space-y-2">
            <div className="bg-zinc-800 rounded h-4 w-1/2 animate-pulse" />
            <div className="bg-zinc-800 rounded h-3 w-3/4 animate-pulse" />
            <div className="bg-zinc-800 rounded h-3 w-2/3 animate-pulse" />
            <div className="flex gap-1.5 mt-1">
              <div className="bg-zinc-800 rounded h-5 w-20 animate-pulse" />
              <div className="bg-zinc-800 rounded h-5 w-16 animate-pulse" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Promote — pick a member, pick a club, PATCH the membership
// from role='member' to role='host'. Uses the existing
// membership endpoint so notification + audit run as designed.
// ──────────────────────────────────────────────────────────────
interface ClubLite { id: string; name: string; emoji: string }
interface MemberLite { id: string; name: string; email?: string }

function PromotePanel({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [clubs,     setClubs]     = useState<ClubLite[] | null>(null)
  const [clubId,    setClubId]    = useState('')
  const [query,     setQuery]     = useState('')
  const [members,   setMembers]   = useState<MemberLite[]>([])
  const [searching, setSearching] = useState(false)
  const [busy,      setBusy]      = useState(false)

  useEffect(() => {
    fetch('/app/api/admin/clubs', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((cs: ClubLite[]) => { setClubs(Array.isArray(cs) ? cs : []) })
      .catch(() => setClubs([]))
  }, [])

  // Debounced member search scoped to the chosen club. Without a
  // club, search is disabled (the PATCH needs a clubId anyway).
  useEffect(() => {
    if (!clubId || !query.trim()) { setMembers([]); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/app/api/admin/clubs/${clubId}/memberships`, { credentials: 'include' })
        if (!res.ok) return
        const all = await res.json() as Array<{ userId: string; role: string; status: string; user?: { id: string; name: string; email: string } }>
        const q = query.trim().toLowerCase()
        const hits = all
          .filter(m => m.role === 'member' && m.status === 'approved' && m.user)
          .filter(m => (m.user!.name + ' ' + m.user!.email).toLowerCase().includes(q))
          .slice(0, 10)
          .map(m => ({ id: m.userId, name: m.user!.name, email: m.user!.email }))
        setMembers(hits)
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [clubId, query])

  async function promote(userId: string, userName: string) {
    if (!clubId) return
    const clubName = clubs?.find(c => c.id === clubId)?.name ?? 'club'
    if (!confirm(`Promote ${userName} to host of ${clubName}?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/app/api/admin/clubs/${clubId}/memberships`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role: 'host' }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error ?? 'Promote failed')
        return
      }
      toast.success(`Promoted ${userName.split(' ')[0]} to host`)
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
      <p className="text-sm font-bold text-white">Promote a member to host</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Club</label>
          <select value={clubId} onChange={e => setClubId(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500">
            <option value="">Select a club…</option>
            {clubs?.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Member (name or email)</label>
          <input type="search" value={query} onChange={e => setQuery(e.target.value)}
            disabled={!clubId}
            placeholder={clubId ? 'Type to search…' : 'Pick a club first'}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-zinc-500 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-amber-500" />
        </div>
      </div>

      {clubId && query.trim() && (
        <div className="divide-y divide-zinc-800 border border-zinc-800 rounded-lg max-h-48 overflow-y-auto">
          {searching && <p className="px-3 py-2 text-xs text-zinc-500">Searching…</p>}
          {!searching && members.length === 0 && <p className="px-3 py-2 text-xs text-zinc-500">No matching approved member in this club.</p>}
          {members.map(m => (
            <button key={m.id} onClick={() => promote(m.id, m.name)} disabled={busy}
              className="w-full text-left px-3 py-2 hover:bg-zinc-800 disabled:opacity-50">
              <p className="text-xs font-semibold text-white">{m.name}</p>
              {m.email && <p className="text-[10px] text-zinc-500">{m.email}</p>}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} disabled={busy}
          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-semibold">
          Cancel
        </button>
      </div>
    </div>
  )
}
