'use client'

import { useState, useEffect, useCallback } from 'react'
import { confirmToast } from '@/lib/confirmToast'
import Link from 'next/link'
import { toast } from 'sonner'
import { ISTANBUL_NEIGHBORHOODS } from '@/lib/data'

const STATUS_OPTS = [
  { id: 'active',    label: 'Active'    },
  { id: 'expired',   label: 'Expired'   },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all',       label: 'All'       },
]

const STATUS_COLOR: Record<string, string> = {
  active:    'bg-green-500/10 text-green-400',
  expired:   'bg-zinc-700/40 text-zinc-400',
  cancelled: 'bg-red-500/10 text-red-400',
}

interface Hangout {
  id: string
  title: string
  description: string | null
  location: string
  neighborhood: string | null
  startsAt: string
  endsAt: string
  status: string
  createdAt: string
  user: { id: string; name: string; email: string; color: string }
  _count: { joins: number; messages: number }
}

function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
      style={{ backgroundColor: color }}>
      {name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
    </div>
  )
}

function whenLabel(startsAt: string, endsAt: string) {
  const s = new Date(startsAt)
  const e = new Date(endsAt)
  const day = s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const t = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return `${day}, ${t(s)}–${t(e)}`
}

// ISO → the `YYYY-MM-DDTHH:mm` shape a datetime-local input expects, in
// local time (matches how the member composer/edit form round-trips).
function toLocalInput(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function AdminHangoutsPage() {
  const [hangouts, setHangouts] = useState<Hangout[]>([])
  const [total, setTotal]       = useState(0)
  const [hasMore, setHasMore]   = useState(false)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [search, setSearch]     = useState('')
  const [status, setStatus]     = useState('active')
  const [query, setQuery]       = useState('')
  const [editing, setEditing]   = useState<Hangout | null>(null)
  const [editForm, setEditForm] = useState({ title: '', location: '', neighborhood: '', description: '', startsAt: '', endsAt: '' })
  const [saving, setSaving]     = useState(false)

  const loadHangouts = useCallback(async (q: string, st: string, offset: number, append = false) => {
    const params = new URLSearchParams({ offset: String(offset), status: st })
    if (q) params.set('search', q)
    const res = await fetch(`/app/api/admin/hangouts?${params}`, { credentials: 'include' })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
    }
    const data = await res.json()
    setHangouts(prev => append ? [...prev, ...(data.hangouts ?? [])] : (data.hangouts ?? []))
    setTotal(data.total ?? 0)
    setHasMore(!!data.hasMore)
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    loadHangouts(query, status, 0)
      .catch(e => setError(e?.message ?? 'Failed to load'))
      .finally(() => setLoading(false))
  }, [query, status, loadHangouts])

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 350)
    return () => clearTimeout(t)
  }, [search])

  // Cancel = the delete semantics for hangouts (nothing hard-deletes them;
  // the DELETE endpoint flips status to 'cancelled' and notifies joiners).
  async function handleCancel(id: string) {
    if (!(await confirmToast('Cancel this hangout? Everyone who joined will be notified.'))) return
    const res = await fetch(`/app/api/hangouts/${id}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Failed to cancel')
      return
    }
    if (status === 'all' || status === 'cancelled') {
      setHangouts(prev => prev.map(h => h.id === id ? { ...h, status: 'cancelled' } : h))
    } else {
      setHangouts(prev => prev.filter(h => h.id !== id))
      setTotal(t => Math.max(0, t - 1))
    }
    toast.success('Hangout cancelled')
  }

  function openEdit(h: Hangout) {
    setEditing(h)
    setEditForm({
      title:        h.title,
      location:     h.location,
      neighborhood: h.neighborhood ?? '',
      description:  h.description ?? '',
      startsAt:     toLocalInput(h.startsAt),
      endsAt:       toLocalInput(h.endsAt),
    })
  }

  async function handleSaveEdit() {
    if (!editing) return
    const title    = editForm.title.trim()
    const location = editForm.location.trim()
    if (!title)    { toast.error('Title required'); return }
    if (!location) { toast.error('Location required'); return }
    setSaving(true)
    try {
      // Material changes (title/location/times) notify joiners server-side;
      // the PATCH also rejects non-active hangouts, which is why Edit is
      // only offered on active rows below.
      const res = await fetch(`/app/api/hangouts/${editing.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          location,
          neighborhood: editForm.neighborhood || null,
          description:  editForm.description.trim(),
          startsAt:     new Date(editForm.startsAt).toISOString(),
          endsAt:       new Date(editForm.endsAt).toISOString(),
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error ?? 'Failed to save')
        return
      }
      const { hangout } = await res.json()
      setHangouts(prev => prev.map(h => h.id === editing.id ? { ...h, ...hangout } : h))
      setEditing(null)
      toast.success('Saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEditing(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-white font-bold text-lg">Edit Hangout</h2>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Title</label>
              <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} maxLength={120}
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Location</label>
              <input value={editForm.location} onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))} maxLength={200}
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Neighborhood</label>
              <select value={editForm.neighborhood} onChange={e => setEditForm(f => ({ ...f, neighborhood: e.target.value }))}
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
                <option value="">— none —</option>
                {ISTANBUL_NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Description</label>
              <textarea rows={3} value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} maxLength={500}
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Starts</label>
                <input type="datetime-local" value={editForm.startsAt} onChange={e => setEditForm(f => ({ ...f, startsAt: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Ends</label>
                <input type="datetime-local" value={editForm.endsAt} onChange={e => setEditForm(f => ({ ...f, endsAt: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
            </div>
            <p className="text-xs text-zinc-500">Changing the title, location or time notifies everyone who joined.</p>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">Close</button>
              <button onClick={handleSaveEdit} disabled={saving} className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Hangouts</h1>
          <p className="text-zinc-400 text-sm mt-1">{total} hangout{total !== 1 ? 's' : ''}</p>
        </div>
        <Link href="/hangouts"
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-amber-500/40 hover:text-amber-400 transition-colors shrink-0">
          ☕ Open feed
        </Link>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-300">Couldn&apos;t load hangouts</p>
            <p className="text-xs text-red-400/80 mt-1 break-all">{error}</p>
          </div>
          <button onClick={() => {
              setError(null); setLoading(true)
              loadHangouts(query, status, 0)
                .catch(e => setError(e?.message ?? 'Failed to load'))
                .finally(() => setLoading(false))
            }}
            className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 font-semibold shrink-0">
            Retry
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-48">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search title, location, host…"
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="px-3 py-2.5 text-sm bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          {STATUS_OPTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
        {loading ? (
          <div className="divide-y divide-zinc-800/60">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-5 py-4 flex items-center gap-4">
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-2/3 rounded bg-zinc-800 animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-zinc-800/60 animate-pulse" />
                </div>
                <div className="hidden md:flex items-center gap-2 w-40">
                  <div className="w-7 h-7 rounded-full bg-zinc-800 animate-pulse" />
                  <div className="h-3 w-3/4 rounded bg-zinc-800 animate-pulse" />
                </div>
                <div className="hidden lg:block h-5 w-16 rounded-lg bg-zinc-800 animate-pulse" />
                <div className="h-7 w-16 rounded-lg bg-zinc-800 animate-pulse" />
              </div>
            ))}
          </div>
        ) : hangouts.length === 0 ? (
          <div className="p-12 text-center text-zinc-500">No hangouts found</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-5 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider">Hangout</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider hidden md:table-cell">Host</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider hidden lg:table-cell">When</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider hidden lg:table-cell">Going</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider hidden lg:table-cell">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {hangouts.map(h => (
                <tr key={h.id} className="hover:bg-zinc-800/40 transition-colors group">
                  {/* Title + location */}
                  <td className="px-5 py-4 max-w-xs">
                    <Link href={`/hangouts/${h.id}`} className="block group/t">
                      <p className="font-semibold text-zinc-100 truncate group-hover/t:text-amber-400 transition-colors">{h.title}</p>
                      <p className="text-xs text-zinc-500 truncate mt-0.5">
                        📍 {h.location}{h.neighborhood ? ` · ${h.neighborhood}` : ''}
                      </p>
                      {/* When on small screens where the dedicated column is hidden */}
                      <p className="text-xs text-zinc-600 mt-0.5 lg:hidden">{whenLabel(h.startsAt, h.endsAt)}</p>
                    </Link>
                  </td>

                  {/* Host — click-through to their admin user page */}
                  <td className="px-4 py-4 hidden md:table-cell">
                    <Link href={`/admin/users/${h.user.id}`}
                      className="flex items-center gap-2 hover:text-amber-400 transition-colors group/m">
                      <Avatar name={h.user.name} color={h.user.color} />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-zinc-200 truncate group-hover/m:text-amber-400">{h.user.name}</p>
                        <p className="text-xs text-zinc-500 truncate">{h.user.email}</p>
                      </div>
                    </Link>
                  </td>

                  {/* When */}
                  <td className="px-4 py-4 text-xs text-zinc-400 hidden lg:table-cell whitespace-nowrap">
                    {whenLabel(h.startsAt, h.endsAt)}
                  </td>

                  {/* Going (joins + host) + message count */}
                  <td className="px-4 py-4 text-xs text-zinc-400 hidden lg:table-cell whitespace-nowrap">
                    👥 {h._count.joins + 1}
                    {h._count.messages > 0 && <span className="text-zinc-600"> · 💬 {h._count.messages}</span>}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-4 hidden lg:table-cell">
                    <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-lg ${STATUS_COLOR[h.status] ?? 'bg-zinc-700 text-zinc-400'}`}>
                      {h.status}
                    </span>
                  </td>

                  {/* Actions — Edit/Cancel only for active hangouts (the
                      member PATCH/DELETE reject the rest). */}
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2 justify-end">
                      {h.status === 'active' && (
                        <>
                          <button
                            onClick={() => openEdit(h)}
                            className="text-xs text-amber-400 hover:text-amber-300 font-semibold px-3 py-2 rounded-lg hover:bg-amber-500/10 transition-colors md:opacity-0 md:group-hover:opacity-100"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleCancel(h.id)}
                            className="text-xs text-red-400 hover:text-red-300 font-semibold px-3 py-2 rounded-lg hover:bg-red-500/10 transition-colors md:opacity-0 md:group-hover:opacity-100"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {hasMore && (
          <div className="px-5 py-4 border-t border-zinc-800">
            <button
              onClick={() => loadHangouts(query, status, hangouts.length, true).catch(e => toast.error(e?.message ?? 'Failed to load more'))}
              className="text-sm text-amber-400 hover:text-amber-300 font-semibold transition-colors"
            >
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
