'use client'

import { toast } from 'sonner'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { formatTime, resolveImageUrl, todayIstanbul } from '@/lib/data'

interface AdminEvent {
  id: string; title: string; date: string; time: string; emoji: string
  status: string; totalSpots: number; spotsLeft: number; clubId: string
  hostId: string | null; neighborhood: string; coverImage: string | null
  price: number; currency: string; membersOnly: boolean; featured: boolean
  isRecurring: boolean; seriesId: string | null
  _count: { attendees: number }
  host: { id: string; name: string; color: string; profilePhoto: string | null } | null
}

interface Club { id: string; name: string; emoji: string }

// ⋯ dropdown — status changes + duplicate + delete
function ActionsMenu({
  event,
  onStatusChange,
  onDuplicate,
  onDelete,
}: {
  event: AdminEvent
  onStatusChange: (id: string, status: string) => void
  onDuplicate: (event: AdminEvent) => void
  onDelete: (event: AdminEvent) => void
}) {
  const [open, setOpen] = useState(false)
  const statusOptions = [
    event.status !== 'published' && { label: 'Publish',  status: 'published', cls: 'text-green-400' },
    event.status !== 'cancelled' && { label: 'Cancel',   status: 'cancelled', cls: 'text-red-400'   },
    event.status !== 'postponed' && { label: 'Postpone', status: 'postponed', cls: 'text-amber-400' },
    event.status !== 'draft'     && { label: 'Draft',    status: 'draft',     cls: 'text-zinc-400'  },
    event.status !== 'archived'  && { label: 'Archive',  status: 'archived',  cls: 'text-zinc-500'  },
  ].filter(Boolean) as { label: string; status: string; cls: string }[]

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 bg-zinc-800 border border-zinc-700 rounded-xl shadow-xl z-20 py-1 min-w-[150px]">
            <p className="px-4 pt-2 pb-1 text-xs font-bold text-zinc-600 uppercase tracking-wider">Set status</p>
            {statusOptions.map(o => (
              <button key={o.status} onClick={() => { setOpen(false); onStatusChange(event.id, o.status) }}
                className={`w-full text-left px-4 py-2 text-xs font-semibold hover:bg-zinc-700 transition-colors ${o.cls}`}>
                {o.label}
              </button>
            ))}
            <div className="border-t border-zinc-700 mt-1 pt-1">
              <button onClick={() => { setOpen(false); onDuplicate(event) }}
                className="w-full text-left px-4 py-2 text-xs font-semibold text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors">
                Duplicate
              </button>
              <button onClick={() => { setOpen(false); onDelete(event) }}
                className="w-full text-left px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-colors">
                Delete
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function AdminEventsPage() {
  const today = todayIstanbul()
  const [events,     setEvents]     = useState<AdminEvent[]>([])
  const [clubs,      setClubs]      = useState<Club[]>([])
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [tabStatus,  setTabStatus]  = useState<'all' | 'upcoming' | 'pending' | 'archived'>('upcoming')
  const [clubFilter, setClubFilter] = useState('all')
  const [dateFrom,   setDateFrom]   = useState('')
  const [dateTo,     setDateTo]     = useState('')
  const [selected,   setSelected]   = useState<Set<string>>(new Set())
  const [bulkBusy,   setBulkBusy]   = useState(false)

  useEffect(() => {
    // Previously setLoading(true) was only called on mount, so clicking
    // a tab left the previous tab's data on screen until the new fetch
    // landed — looked instant but was actually stale.
    setLoading(true)
    const archived = tabStatus === 'archived' ? '?archived=1' : ''
    const pending  = tabStatus === 'pending'  ? '?status=pending' : ''
    Promise.all([
      fetch(`/app/api/admin/events${archived || pending}`, { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/admin/clubs', { credentials: 'include' }).then(r => r.json()),
    ]).then(([evData, clData]) => {
      setEvents(Array.isArray(evData) ? evData : [])
      setClubs(Array.isArray(clData) ? clData : [])
    }).finally(() => setLoading(false))
  }, [tabStatus])

  async function toggleFeatured(event: AdminEvent) {
    const next = !event.featured
    const res = await fetch(`/app/api/admin/events/${event.id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ featured: next }),
    })
    if (res.ok) {
      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, featured: next } : e))
      toast(next ? '★ Featured' : 'Unfeatured')
    }
  }

  async function approveEvent(event: AdminEvent) {
    const res = await fetch(`/app/api/admin/events/${event.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'published' }),
    })
    if (res.ok) {
      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, status: 'published' } : e))
      toast.success(`"${event.title}" published`)
    }
  }

  async function handleDelete(event: AdminEvent) {
    if (!window.confirm(`Delete "${event.title}"?`)) return
    const res = await fetch(`/app/api/admin/events/${event.id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) {
      setEvents(prev => prev.filter(e => e.id !== event.id))
      toast.success('Deleted')
    }
  }

  // PATCH allowlist on the server is `published / flagged / unpublished
  // / pending` — admins can hit those as moderators too. Anything else
  // (cancelled, postponed, draft, archived) goes through PUT which
  // requires admin. Using PATCH where allowed keeps moderators able to
  // publish from the ⋯ menu — previously this always went through PUT
  // and would 403 a moderator.
  const PATCH_STATUSES = new Set(['published', 'flagged', 'unpublished', 'pending'])

  async function handleStatusChange(id: string, newStatus: string) {
    if (newStatus === 'cancelled' && !window.confirm('Cancel event? Attendees will be notified.')) return
    const method = PATCH_STATUSES.has(newStatus) ? 'PATCH' : 'PUT'
    const res = await fetch(`/app/api/admin/events/${id}`, {
      method, credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (res.ok) {
      setEvents(prev => prev.map(e => e.id === id ? { ...e, status: newStatus } : e))
      toast.success(`Status → ${newStatus}`)
    } else {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Failed to update status')
    }
  }

  async function handleDuplicate(event: AdminEvent) {
    // Real server-side duplicate now — the old impl just inserted a
    // client-only row with id `dup-${Date.now()}` that vanished on
    // reload and 404'd on any subsequent Edit/Delete. New endpoint
    // clones the source as a fresh draft with today's date.
    const res = await fetch(`/app/api/admin/events/${event.id}/duplicate`, {
      method: 'POST', credentials: 'include',
    })
    if (res.ok) {
      const copy = await res.json()
      setEvents(prev => [copy, ...prev])
      toast.success('Duplicated ✓')
    } else {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Failed to duplicate')
    }
  }

  // Bulk runner — tracks which ids actually completed so a partial 500
  // only mutates the rows that really changed. Previously Promise.all
  // dropped per-request status entirely and the toast claimed full
  // success even on full failure.
  async function bulkRun(label: string, work: (id: string) => Promise<boolean>, onSuccess: (ids: Set<string>) => void) {
    if (selected.size === 0) return
    setBulkBusy(true)
    const results = await Promise.all([...selected].map(async id => ({ id, ok: await work(id).catch(() => false) })))
    const ok = new Set(results.filter(r => r.ok).map(r => r.id))
    const fail = results.length - ok.size
    if (ok.size) onSuccess(ok)
    setSelected(new Set())
    setBulkBusy(false)
    if (ok.size) toast.success(`${label}: ${ok.size} done`)
    if (fail)    toast.error(`${label}: ${fail} failed`)
  }

  async function bulkCancel() {
    if (!window.confirm(`Cancel ${selected.size} events? Attendees will be notified.`)) return
    await bulkRun('Cancel', async (id) => {
      const res = await fetch(`/app/api/admin/events/${id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      return res.ok
    }, (ok) => {
      setEvents(prev => prev.map(e => ok.has(e.id) ? { ...e, status: 'cancelled' } : e))
    })
  }

  async function bulkDelete() {
    if (!window.confirm(`Delete ${selected.size} events?`)) return
    await bulkRun('Delete', async (id) => {
      const res = await fetch(`/app/api/admin/events/${id}`, { method: 'DELETE', credentials: 'include' })
      return res.ok
    }, (ok) => {
      setEvents(prev => prev.filter(e => !ok.has(e.id)))
    })
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  // `duplicated` was a left-over from the client-only duplicate impl;
  // now that handleDuplicate persists and prepends to `events`, this
  // shadow list isn't needed — keeping the alias for the JSX below.
  const allEvents = events

  // Apply the "non-tab" filters first (search, club, date range) so the
  // tab counts below all reflect those narrowings — matches the
  // search-aware tabs on /admin/users. Without this, counts always read
  // the unfiltered totals and looked wrong next to a narrowed list.
  const baseFiltered = allEvents.filter(e => {
    if (clubFilter !== 'all' && e.clubId !== clubFilter) return false
    if (dateFrom && e.date < dateFrom) return false
    if (dateTo   && e.date > dateTo)   return false
    if (search) {
      const q = search.toLowerCase()
      if (!e.title.toLowerCase().includes(q) && !e.neighborhood.toLowerCase().includes(q) && !(e.host?.name.toLowerCase().includes(q))) return false
    }
    return true
  })

  // "Upcoming" = published-style events with a future date. Cancelled
  // and postponed events used to leak in because the old filter only
  // excluded archived / pending / past.
  function isUpcoming(e: AdminEvent): boolean {
    if (e.status === 'archived' || e.status === 'pending') return false
    if (e.status === 'cancelled' || e.status === 'postponed') return false
    if (e.date < today) return false
    return true
  }

  const visible = baseFiltered.filter(e => {
    if (tabStatus === 'upcoming') return isUpcoming(e)
    if (tabStatus === 'archived') return e.status === 'archived'
    if (tabStatus === 'pending')  return e.status === 'pending'
    return true  // 'all'
  })

  const upcomingCount = baseFiltered.filter(isUpcoming).length
  const pendingCount  = baseFiltered.filter(e => e.status === 'pending').length
  const archivedCount = baseFiltered.filter(e => e.status === 'archived').length

  return (
    <div className="p-4 sm:p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Events</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {loading ? 'Loading…' : <><span className="text-white font-bold">{events.length}</span> total · {upcomingCount} upcoming</>}
          </p>
        </div>
        <Link href="/admin/events/new"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-colors shrink-0">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Create event
        </Link>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex gap-1 bg-zinc-800 rounded-xl p-1 overflow-x-auto scrollbar-hide">
          {([
            // Tab counts mirror the active search / club / date filters
            // — same fix as /admin/users. The 'All' count reads from the
            // search-narrowed baseFiltered, not the raw fetch.
            { key: 'all',      label: 'All',      count: baseFiltered.length },
            { key: 'upcoming', label: 'Upcoming', count: upcomingCount       },
            { key: 'pending',  label: 'Pending',  count: pendingCount        },
            { key: 'archived', label: 'Past',     count: archivedCount       },
          ] as const).map(tab => (
            <button key={tab.key} onClick={() => setTabStatus(tab.key)}
              className={`shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                tabStatus === tab.key ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-white'
              }`}>
              {tab.label}
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                tab.key === 'pending' && tab.count > 0 ? 'bg-amber-500/20 text-amber-400'
                  : tabStatus === tab.key ? 'bg-zinc-600 text-zinc-300' : 'bg-zinc-700 text-zinc-500'
              }`}>{tab.count}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative w-64">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" placeholder="Search title, host, neighborhood…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
          <select value={clubFilter} onChange={e => setClubFilter(e.target.value)}
            className="text-xs px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-white focus:outline-none focus:ring-2 focus:ring-amber-500 w-40">
            <option value="all">All clubs</option>
            {clubs.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
          </select>
          {/* Native date pickers — `type="text"` placeholders forced
              admins to hand-type yyyy-mm-dd with no validation. Same
              treatment the other admin pages got. */}
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="text-xs px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500" />
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="text-xs px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo('') }} className="text-xs text-zinc-500 hover:text-white transition-colors px-2">✕ Clear</button>
          )}
        </div>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
          <span className="text-xs font-bold text-amber-400">{selected.size} selected</span>
          <button onClick={bulkCancel} disabled={bulkBusy}
            className="px-3 py-1.5 text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded-lg transition-colors disabled:opacity-40">
            Cancel all
          </button>
          <button onClick={bulkDelete} disabled={bulkBusy}
            className="px-3 py-1.5 text-xs font-semibold bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg transition-colors disabled:opacity-40">
            Delete all
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-zinc-500 hover:text-white transition-colors">
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">

        {/* Desktop header — col layout: 1 | 5 | 2 | 1 | 3 = 12 */}
        <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 bg-zinc-800/50 border-b border-zinc-800 text-xs font-bold text-zinc-500 uppercase tracking-wider">
          <div className="col-span-1 flex items-center">
            <input type="checkbox"
              checked={selected.size === visible.length && visible.length > 0}
              onChange={() => setSelected(prev => prev.size === visible.length ? new Set() : new Set(visible.map(e => e.id)))}
              className="rounded border-zinc-600 bg-zinc-800 text-amber-500 focus:ring-amber-500" />
          </div>
          <div className="col-span-5">Event</div>
          <div className="col-span-2">Date & Price</div>
          <div className="col-span-1 text-center">Fill</div>
          <div className="col-span-3 text-right">Actions</div>
        </div>

        <div className="divide-y divide-zinc-800">
          {loading && <div className="px-6 py-16 text-center text-zinc-500 text-sm">Loading…</div>}
          {!loading && visible.length === 0 && (
            <div className="px-6 py-16 text-center text-zinc-500 text-sm">No events match your filters.</div>
          )}

          {visible.map(event => {
            const host       = event.host
            const club       = clubs.find(c => c.id === event.clubId)
            const goingCount = event._count.attendees
            const fillPct    = event.totalSpots > 0 ? Math.round((goingCount / event.totalSpots) * 100) : 0
            const isPast     = event.date < today
            const isFeatured = event.featured

            // Status cascade — pending used to fall through to "Live",
            // making approval-required events look already published in
            // the list.
            const statusLabel = event.status === 'cancelled' ? 'Cancelled'
              : event.status === 'postponed' ? 'Postponed'
              : event.status === 'archived'  ? 'Archived'
              : event.status === 'draft'     ? 'Draft'
              : event.status === 'pending'   ? 'Pending'
              : isPast                       ? 'Past' : 'Live'

            const statusCls = event.status === 'cancelled' ? 'bg-red-500/10 text-red-400'
              : event.status === 'postponed' ? 'bg-amber-500/10 text-amber-400'
              : event.status === 'pending'   ? 'bg-amber-500/10 text-amber-400'
              : (event.status === 'draft' || event.status === 'archived' || isPast) ? 'bg-zinc-700 text-zinc-400'
              : 'bg-green-500/10 text-green-400'

            return (
              <div key={event.id}>

                {/* ── Mobile card ── */}
                <div className="md:hidden p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl shrink-0 mt-0.5">{event.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/admin/events/${event.id}/edit`}
                          className="font-semibold text-sm text-white hover:text-amber-400 transition-colors leading-snug">
                          {event.title}
                        </Link>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${statusCls}`}>{statusLabel}</span>
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                        {club && <span>{club.emoji} {club.name}</span>}
                        <span>·</span>
                        <span>{event.neighborhood}</span>
                        {isFeatured && <span className="text-amber-400">★</span>}
                        {event.membersOnly && <span className="text-violet-400">🔒</span>}
                        {event.seriesId && <span className="text-cyan-400" title="Part of a recurring series">🔁</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>{event.date} · {formatTime(event.time)}{event.price > 0 ? ` · ₺${event.price}` : ''}</span>
                    <span>{goingCount}/{event.totalSpots}</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${fillPct >= 80 ? 'bg-red-400' : 'bg-amber-400'}`} style={{ width: `${fillPct}%` }} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {host ? (
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center text-white text-[9px] font-bold shrink-0" style={{ backgroundColor: host.color }}>
                          {host.profilePhoto ? <img src={resolveImageUrl(host.profilePhoto)} alt={host.name} className="w-full h-full object-cover" /> : host.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="text-xs text-zinc-400 truncate">{host.name}</span>
                      </div>
                    ) : <div />}
                    <div className="flex items-center gap-1 shrink-0">
                      {event.status === 'pending' && (
                        <button onClick={() => approveEvent(event)}
                          className="px-2.5 py-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 text-xs font-bold transition-colors">
                          Approve
                        </button>
                      )}
                      <Link href={`/admin/events/${event.id}/participants`}
                        className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors" title="Attendees">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      </Link>
                      <button onClick={() => toggleFeatured(event)}
                        className={`p-1.5 rounded-lg transition-colors ${isFeatured ? 'bg-amber-500/10 text-amber-400' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'}`}>
                        <svg className="w-4 h-4" fill={isFeatured ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                      </button>
                      <Link href={`/admin/events/${event.id}/edit`}
                        className="px-2.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition-colors">
                        Edit
                      </Link>
                      <ActionsMenu event={event} onStatusChange={handleStatusChange} onDuplicate={handleDuplicate} onDelete={handleDelete} />
                    </div>
                  </div>
                </div>

                {/* ── Desktop row — col: 1 | 5 | 2 | 1 | 3 = 12 ── */}
                <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-zinc-800/40 transition-colors">

                  {/* Checkbox */}
                  <div className="col-span-1 flex items-center">
                    <input type="checkbox" checked={selected.has(event.id)} onChange={() => toggleSelect(event.id)}
                      className="rounded border-zinc-600 bg-zinc-800 text-amber-500 focus:ring-amber-500" />
                  </div>

                  {/* Event + host */}
                  <div className="col-span-5 flex items-center gap-3 min-w-0">
                    <span className="text-xl shrink-0">{event.emoji}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Link href={`/admin/events/${event.id}/edit`}
                          className="font-semibold text-sm text-white hover:text-amber-400 transition-colors truncate">
                          {event.title}
                        </Link>
                        {isFeatured && <span className="text-amber-400 text-xs shrink-0">★</span>}
                        {event.membersOnly && <span className="text-violet-400 text-xs shrink-0">🔒</span>}
                        {event.seriesId && <span className="text-cyan-400 text-xs shrink-0" title="Recurring series">🔁</span>}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5 truncate">{club?.emoji} {club?.name} · {event.neighborhood}</div>
                      {host && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center text-white text-[8px] font-bold shrink-0" style={{ backgroundColor: host.color }}>
                            {host.profilePhoto ? <img src={resolveImageUrl(host.profilePhoto)} alt={host.name} className="w-full h-full object-cover" /> : host.name.slice(0, 2).toUpperCase()}
                          </div>
                          <span className="text-xs text-zinc-500 truncate">{host.name}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Date & price */}
                  <div className="col-span-2">
                    <div className="text-xs font-semibold text-zinc-200">{event.date}</div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {formatTime(event.time)}
                      {event.price > 0 && <span className="ml-1.5 text-amber-400 font-semibold">₺{event.price}</span>}
                    </div>
                    <span className={`inline-block mt-1 text-xs font-bold px-1.5 py-0.5 rounded-full ${statusCls}`}>{statusLabel}</span>
                  </div>

                  {/* Fill */}
                  <div className="col-span-1">
                    <div className="text-xs text-center text-zinc-300 font-semibold mb-1">
                      {goingCount}<span className="text-zinc-600">/{event.totalSpots}</span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${fillPct >= 80 ? 'bg-red-400' : 'bg-amber-400'}`} style={{ width: `${fillPct}%` }} />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="col-span-3 flex items-center justify-end gap-1.5">
                    {event.status === 'pending' && (
                      <button onClick={() => approveEvent(event)}
                        className="px-2.5 py-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 text-xs font-bold transition-colors shrink-0">
                        Approve
                      </button>
                    )}
                    <Link href={`/admin/events/${event.id}/participants`}
                      className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors" title="Attendees">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    </Link>
                    <button onClick={() => toggleFeatured(event)} title={isFeatured ? 'Unfeature' : 'Feature'}
                      className={`p-1.5 rounded-lg transition-colors ${isFeatured ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
                      <svg className="w-4 h-4" fill={isFeatured ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                    </button>
                    <Link href={`/admin/events/${event.id}/edit`}
                      className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition-colors shrink-0">
                      Edit
                    </Link>
                    <ActionsMenu event={event} onStatusChange={handleStatusChange} onDuplicate={handleDuplicate} onDelete={handleDelete} />
                  </div>
                </div>

              </div>
            )
          })}
        </div>

        {visible.length > 0 && (
          <div className="px-6 py-3 border-t border-zinc-800 bg-zinc-800/30 text-xs text-zinc-500">
            Showing {visible.length} of {events.length} events
          </div>
        )}
      </div>
    </div>
  )
}
