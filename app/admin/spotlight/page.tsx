'use client'

import { useState } from 'react'
import { confirmToast } from '@/lib/confirmToast'
import Link from 'next/link'
import { resolveImageUrl } from '@/lib/data'
import { toast } from 'sonner'
import { useAdminLoad } from '@/lib/admin/useAdminLoad'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'

// This page used to host editors for the announcement banner and
// the community poll as well. Both moved to /admin/announcements
// (formerly /admin/engagement) when the comms tooling was
// consolidated; the duplicated state + JSX here lingered until
// today and hit the same endpoints from two surfaces, which
// meant edits showed up on either page but bug fixes only
// landed on whichever one I touched. Now it's spotlight only.

interface User {
  id: string
  name: string
  email: string
  color: string
  profilePhoto: string | null
  neighborhood: string | null
}

interface Spotlight {
  user:      { id: string; name: string; color: string; profilePhoto: string | null; neighborhood: string | null }
  funFact:   string
  topSpots:  string[]
  updatedAt: string | null
}

function Avatar({ user }: { user: Pick<User, 'name' | 'color' | 'profilePhoto'> }) {
  const initials = user.name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return user.profilePhoto ? (
    <img src={resolveImageUrl(user.profilePhoto)} alt={user.name}
      className="w-10 h-10 rounded-full object-cover shrink-0" />
  ) : (
    <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-white text-sm font-bold"
      style={{ backgroundColor: user.color }}>
      {initials}
    </div>
  )
}

export default function SpotlightPage() {
  // Shared admin-load hook gives us r.ok + shape-validation +
  // a Retry button via LoadErrorBanner. The escape hatch
  // setData lets the clear/save flows mutate the cached value.
  const { data: current, error: loadError, retry: loadCurrent, setData: setCurrent } = useAdminLoad<Spotlight>(
    '/app/api/admin/spotlight',
    (v): v is Spotlight => !!v && typeof v === 'object' && 'user' in (v as Record<string, unknown>),
  )
  const [search,    setSearch]    = useState('')
  const [results,   setResults]   = useState<User[]>([])
  const [selected,  setSelected]  = useState<User | null>(null)
  const [funFact,   setFunFact]   = useState('')
  const [topSpots,  setTopSpots]  = useState(['', '', ''])
  const [searching,    setSearching]    = useState(false)
  const [saving,       setSaving]       = useState(false)

  async function handleSearch() {
    if (!search.trim()) return
    setSearching(true)
    try {
      const res = await fetch(`/app/api/admin/users?search=${encodeURIComponent(search)}`, { credentials: 'include' })
      if (!res.ok) {
        // Previously Array.isArray was the only failure gate, so
        // an auth error (which returns a JSON error body) just
        // showed "no results" with no admin feedback.
        const d = await res.json().catch(() => ({}))
        toast.error(d?.error ?? 'Search failed')
        setResults([])
        return
      }
      const data = await res.json()
      setResults(Array.isArray(data) ? data.slice(0, 8) : [])
    } finally { setSearching(false) }
  }

  // Clear the current spotlight without having to set a different
  // member first — previously the only way to "remove" was to
  // overwrite with another pick. Hits DELETE on the same route
  // (server respects it as a clear; falls through to a graceful
  // 404 if there was nothing to clear).
  async function clearSpotlight() {
    if (!current) return
    if (!(await confirmToast(`Clear the current spotlight (${current.user.name})? The dashboard will fall back to its default.`))) return
    setSaving(true)
    try {
      const res = await fetch('/app/api/admin/spotlight', { method: 'DELETE', credentials: 'include' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d?.error ?? 'Failed to clear spotlight')
        return
      }
      setCurrent(null)
      toast.success('Spotlight cleared')
    } finally { setSaving(false) }
  }

  function selectUser(u: User) {
    setSelected(u)
    setResults([])
    setSearch('')
  }

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    try {
      const res = await fetch('/app/api/admin/spotlight', {
        method:  'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userId: selected.id, funFact, topSpots }),
      })
      if (!res.ok) throw new Error()
      toast.success('Spotlight updated!')
      // Refresh through the shared hook so the response is
      // r.ok-gated + shape-validated like the initial load.
      loadCurrent()
      setSelected(null)
      setFunFact('')
      setTopSpots(['', '', ''])
    } catch {
      toast.error('Failed to update spotlight')
    } finally { setSaving(false) }
  }

  function prefillFromCurrent() {
    if (!current) return
    setSelected({
      id:           current.user.id,
      name:         current.user.name,
      email:        '',
      color:        current.user.color,
      profilePhoto: current.user.profilePhoto,
      neighborhood: current.user.neighborhood,
    })
    setFunFact(current.funFact)
    setTopSpots(current.topSpots.length === 3 ? current.topSpots : ['', '', ''])
  }

  const inputCls = 'w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500'

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Spotlight</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Pick the member featured on the dashboard.</p>
        </div>
        {/* Pointer to where the announcement + poll editors moved.
            Same data lived in two places before — this nudge sends
            admin to the canonical surface. */}
        <Link href="/admin/announcements"
          className="text-xs px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors">
          Announcement &amp; poll →
        </Link>
      </div>

      <LoadErrorBanner message={loadError} onRetry={loadCurrent} title="Couldn't load spotlight" />

      {/* Current spotlight */}
      {current && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
          <div className="flex items-center justify-between mb-4 gap-3">
            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Current spotlight</h2>
            <div className="flex items-center gap-3 text-xs">
              <button onClick={prefillFromCurrent} className="text-amber-400 font-semibold hover:text-amber-300">Edit →</button>
              <button onClick={clearSpotlight} disabled={saving}
                className="text-zinc-500 font-semibold hover:text-red-400 transition-colors disabled:opacity-40"
                title="Remove the current spotlight (dashboard falls back to default)">
                Clear
              </button>
            </div>
          </div>
          <div className="flex items-center gap-4 mb-4">
            <Avatar user={current.user} />
            <div>
              <p className="font-bold text-white">{current.user.name}</p>
              {current.user.neighborhood && <p className="text-xs text-zinc-500">📍 {current.user.neighborhood}</p>}
              {current.updatedAt && (
                <p className="text-xs text-zinc-600 mt-0.5">
                  Set {new Date(current.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              )}
            </div>
          </div>
          {current.funFact && <p className="text-sm text-zinc-400 italic mb-3">"{current.funFact}"</p>}
          {current.topSpots.some(s => s) && (
            <div className="space-y-1">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-1">Top Istanbul spots</p>
              {current.topSpots.filter(s => s).map((spot, i) => (
                <p key={i} className="text-sm text-zinc-300"><span className="text-amber-500 font-bold">{i + 1}.</span> {spot}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Set new spotlight */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-5">
        <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
          {current ? 'Change spotlight member' : 'Set spotlight member'}
        </h2>

        <div>
          <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wide mb-1.5">Search member</label>
          <div className="flex gap-2">
            <input type="text" value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search by name or email…"
              className={`flex-1 ${inputCls}`} />
            <button onClick={handleSearch} disabled={searching || !search.trim()}
              className="px-4 py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-semibold disabled:opacity-40 transition-colors">
              {searching ? '…' : 'Search'}
            </button>
          </div>
          {results.length > 0 && (
            <div className="mt-2 border border-zinc-700 rounded-xl overflow-hidden divide-y divide-zinc-800">
              {results.map(u => (
                <button key={u.id} onClick={() => selectUser(u)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 transition-colors text-left">
                  <Avatar user={u} />
                  <div>
                    <p className="text-sm font-semibold text-white">{u.name}</p>
                    <p className="text-xs text-zinc-500">{u.email}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <div className="flex items-center gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <Avatar user={selected} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate">{selected.name}</p>
              {selected.neighborhood && <p className="text-xs text-zinc-400">📍 {selected.neighborhood}</p>}
            </div>
            <button onClick={() => setSelected(null)} className="text-zinc-500 hover:text-white text-lg leading-none">×</button>
          </div>
        )}

        <div>
          <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wide mb-1.5">Fun fact</label>
          <textarea value={funFact} onChange={e => setFunFact(e.target.value)}
            placeholder="A fun or interesting fact about this member…"
            rows={3} maxLength={200}
            className={`${inputCls} resize-none`} />
          <p className="text-xs text-zinc-600 text-right mt-1">{funFact.length}/200</p>
        </div>

        <div>
          <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wide mb-1.5">Top 3 Istanbul spots</label>
          <div className="space-y-2">
            {topSpots.map((spot, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-amber-500 font-bold text-sm w-4">{i + 1}.</span>
                <input type="text" value={spot}
                  onChange={e => setTopSpots(s => s.map((v, j) => j === i ? e.target.value : v))}
                  placeholder={`Spot ${i + 1} (e.g. Karaköy Lokantası)`} maxLength={80}
                  className={`flex-1 ${inputCls}`} />
              </div>
            ))}
          </div>
        </div>

        <button onClick={handleSave} disabled={saving || !selected}
          className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm disabled:opacity-40 transition-colors">
          {saving ? 'Saving…' : current ? 'Update spotlight' : 'Set spotlight'}
        </button>
      </div>
    </div>
  )
}
