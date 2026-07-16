'use client'

import { useState } from 'react'
import { confirmToast } from '@/lib/confirmToast'
import Link from 'next/link'
import { toast } from 'sonner'
import { resolveImageUrl } from '@/lib/data'
import { useAdminLoad } from '@/lib/admin/useAdminLoad'
import { useAdminMemberSearch } from '@/hooks/useAdminMemberSearch'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'

interface PartnerUser { id: string; name: string; email: string }
interface Partner {
  id: string
  name: string
  category: string
  discount: string
  address: string
  neighborhood: string
  website: string | null
  instagram: string | null
  logo: string | null
  coverImage: string | null
  isActive: boolean
  users: PartnerUser[]
}
interface Member { id: string; name: string; email: string }

type PanelMode = 'users' | 'edit' | null

const FIELDS = [
  { key: 'name',         label: 'Business Name',   span: 2 },
  { key: 'category',     label: 'Category',        span: 1, placeholder: 'e.g. Cafe, Gym, Studio' },
  { key: 'discount',     label: 'Discount Offer',  span: 1, placeholder: 'e.g. 10% off for Smileys members' },
  { key: 'address',      label: 'Address',         span: 1 },
  { key: 'neighborhood', label: 'Neighborhood',    span: 1 },
  { key: 'website',      label: 'Website',         span: 1, placeholder: 'https://...' },
  { key: 'instagram',    label: 'Instagram',       span: 1, placeholder: '@username' },
  { key: 'logo',         label: 'Logo URL',        span: 1, placeholder: 'https://... image URL' },
  { key: 'coverImage',   label: 'Cover Image URL', span: 1, placeholder: 'https://... image URL' },
]

const inputCls = 'w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-amber-500'

export default function AdminPartnersPage() {
  // useAdminLoad in place of a hand-rolled fetch + setState dance:
  // it r.ok-gates + shape-validates the response and exposes retry.
  // Was previously using .then(r => r.json()) with no r.ok check —
  // a 401/500 fell through unchecked, Array.isArray filtered the
  // error JSON into [], and the page rendered "No partners yet"
  // indistinct from a real empty result.
  const {
    data: partnersData, loading, error: loadError, retry: load, setData: setPartnersData,
  } = useAdminLoad<Partner[]>(
    '/app/api/admin/partners',
    (v): v is Partner[] => Array.isArray(v),
  )
  const partners = partnersData ?? []
  const setPartners = (next: Partner[] | ((prev: Partner[]) => Partner[])) => {
    setPartnersData(typeof next === 'function' ? next(partnersData ?? []) : next)
  }

  const [panel,      setPanel]      = useState<{ id: string; mode: PanelMode }>({ id: '', mode: null })
  const [searches,   setSearches]   = useState<Record<string, string>>({})
  // Server-side member search for the assign picker — /api/admin/users
  // without ?search= caps at the newest 1000 rows, so filtering a
  // one-shot fetch client-side made the oldest members unfindable.
  // Only one panel is open at a time, so a single hook keyed to the
  // open panel's search box covers every partner row.
  const activeSearch = panel.mode === 'users' ? (searches[panel.id] ?? '') : ''
  const { results: memberHits } = useAdminMemberSearch(activeSearch)
  const [editForms,  setEditForms]  = useState<Record<string, Partial<Partner>>>({})
  const [saving,     setSaving]     = useState<string | null>(null)

  function openEdit(p: Partner) {
    setEditForms(prev => ({ ...prev, [p.id]: { ...p } }))
    setPanel({ id: p.id, mode: 'edit' })
  }

  function closePanel() { setPanel({ id: '', mode: null }) }

  async function saveEdit(id: string) {
    const data = editForms[id]
    if (!data) return
    setSaving(id)
    const res = await fetch(`/app/api/admin/partners/${id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      const updated = await res.json()
      setPartners(prev => prev.map(p => p.id === id ? { ...p, ...updated } : p))
      closePanel()
      toast.success('Saved ✓')
    } else toast.error('Failed to save')
    setSaving(null)
  }

  async function handleDelete(id: string) {
    if (!(await confirmToast('Delete this partner? Assigned users will revert to member role.'))) return
    const res = await fetch('/app/api/admin/partners', {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error(d?.error ?? 'Failed to delete partner')
      return
    }
    setPartners(prev => prev.filter(p => p.id !== id))
    toast.success('Deleted')
  }

  async function toggleActive(p: Partner) {
    const next = !p.isActive
    const res = await fetch(`/app/api/admin/partners/${p.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: next }),
    })
    if (!res.ok) {
      // Was completely silent — admin clicked "Activate" or
      // "Deactivate" and had no way to tell whether the click
      // landed. Worse: even on success there was no toast.
      const d = await res.json().catch(() => ({}))
      toast.error(d?.error ?? `Failed to ${next ? 'activate' : 'deactivate'} partner`)
      return
    }
    setPartners(prev => prev.map(x => x.id === p.id ? { ...x, isActive: next } : x))
    toast.success(`${p.name} ${next ? 'activated' : 'deactivated'}`)
  }

  async function assignUser(partnerId: string, user: Member) {
    const res = await fetch(`/app/api/admin/partners/${partnerId}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    })
    if (res.ok) {
      setPartners(prev => prev.map(p => p.id === partnerId ? { ...p, users: [...p.users, user] } : p))
      setSearches(s => ({ ...s, [partnerId]: '' }))
      toast.success(`${user.name} assigned ✓`)
    } else {
      const d = await res.json().catch(() => ({}))
      toast.error(d?.error ?? 'Failed to assign')
    }
  }

  async function removeUser(partnerId: string, userId: string) {
    const res = await fetch(`/app/api/admin/partners/${partnerId}`, {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error(d?.error ?? 'Failed to remove user')
      return
    }
    setPartners(prev => prev.map(p => p.id === partnerId ? { ...p, users: p.users.filter(u => u.id !== userId) } : p))
    toast('User unassigned')
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Partners</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Local businesses offering member discounts</p>
        </div>
        <Link href="/admin/partners/new"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-colors shrink-0">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Add partner
        </Link>
      </div>

      {/* Error banner — was silently rendering "No partners yet."
          on load failures. Retry re-fires both underlying hook
          loads (partners + users). */}
      <LoadErrorBanner message={loadError} onRetry={load} title="Couldn't load partners" />

      {loading ? (
        // Page-shape skeleton matching the partner row layout so
        // the moment data lands is a fill-in rather than a jump.
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-zinc-800 animate-pulse shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 rounded bg-zinc-800 animate-pulse" />
                <div className="h-3 w-1/2 rounded bg-zinc-800/60 animate-pulse" />
              </div>
              <div className="hidden sm:flex gap-2">
                {[0, 1, 2, 3].map(j => <div key={j} className="h-8 w-16 rounded-lg bg-zinc-800 animate-pulse" />)}
              </div>
            </div>
          ))}
        </div>
      )
      : partners.length === 0 ? <div className="text-center py-16 text-zinc-600">No partners yet.</div>
      : (
        <div className="space-y-3">
          {partners.map(p => {
            const isOpen    = panel.id === p.id
            const mode      = isOpen ? panel.mode : null
            const editData  = editForms[p.id] ?? p
            const search    = searches[p.id] ?? ''
            const assignedIds = new Set(p.users.map(u => u.id))
            const searchResults = mode === 'users' && search.trim().length > 1
              ? memberHits.filter(m => !assignedIds.has(m.id)).slice(0, 5)
              : []
            const logo = resolveImageUrl(p.logo)

            return (
              <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-visible">
                {/* Header row */}
                <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    {logo ? (
                      <img src={logo} alt={p.name} className="w-10 h-10 rounded-xl object-cover shrink-0 border border-zinc-700" />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-lg shrink-0">🏪</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-white truncate">{p.name}</p>
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full shrink-0 ${p.isActive ? 'bg-green-500/15 text-green-400' : 'bg-zinc-700 text-zinc-500'}`}>
                          {p.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 mt-0.5 truncate">
                        {p.category} · {p.neighborhood}
                        {p.discount && <span className="text-amber-500"> · {p.discount}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button onClick={() => isOpen && mode === 'edit' ? closePanel() : openEdit(p)}
                      className={`text-xs px-3 py-2 rounded-lg font-semibold transition-colors ${mode === 'edit' ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'}`}>
                      ✏️ Edit
                    </button>
                    <button onClick={() => isOpen && mode === 'users' ? closePanel() : setPanel({ id: p.id, mode: 'users' })}
                      className={`text-xs px-3 py-2 rounded-lg font-semibold transition-colors ${mode === 'users' ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'}`}>
                      👤 Users ({p.users.length})
                    </button>
                    <button onClick={() => toggleActive(p)}
                      className="text-xs px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors">
                      {p.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => handleDelete(p.id)}
                      className="text-xs px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors">
                      Delete
                    </button>
                  </div>
                </div>

                {/* Edit panel */}
                {mode === 'edit' && (
                  <div className="border-t border-zinc-800 px-5 py-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {FIELDS.map(f => (
                        <div key={f.key} className={f.span === 2 ? 'sm:col-span-2' : ''}>
                          <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">{f.label}</label>
                          <input
                            value={(editData as any)[f.key] ?? ''}
                            onChange={e => setEditForms(prev => ({ ...prev, [p.id]: { ...prev[p.id], [f.key]: e.target.value } }))}
                            placeholder={f.placeholder}
                            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      ))}
                      {/* Preview */}
                      {(editForms[p.id]?.logo || editForms[p.id]?.coverImage) && (
                        <div className="sm:col-span-2 flex gap-4">
                          {editForms[p.id]?.logo && (
                            <div>
                              <p className="text-xs text-zinc-500 mb-1">Logo preview</p>
                              <img src={resolveImageUrl(editForms[p.id].logo!)} alt={`${p.name} logo`} className="w-16 h-16 rounded-xl object-cover border border-zinc-700" />
                            </div>
                          )}
                          {editForms[p.id]?.coverImage && (
                            <div className="flex-1">
                              <p className="text-xs text-zinc-500 mb-1">Cover preview</p>
                              <img src={resolveImageUrl(editForms[p.id].coverImage!)} alt={`${p.name} cover`} className="w-full h-20 rounded-xl object-cover border border-zinc-700" />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex justify-end gap-3 mt-4">
                      <button onClick={closePanel} className="text-xs text-zinc-400 hover:text-white px-4 py-2 transition-colors">Cancel</button>
                      <button onClick={() => saveEdit(p.id)} disabled={saving === p.id}
                        className="bg-amber-500 hover:bg-amber-600 text-black px-6 py-2 rounded-xl font-bold text-sm transition-colors disabled:opacity-50">
                        {saving === p.id ? 'Saving…' : 'Save changes'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Users panel */}
                {mode === 'users' && (
                  <div className="border-t border-zinc-800 px-5 py-4 space-y-4">
                    {p.users.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Assigned accounts</p>
                        {p.users.map(u => (
                          <div key={u.id} className="flex items-center gap-3 py-1">
                            <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-white shrink-0">{u.name[0]}</div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-white truncate">{u.name}</p>
                              <p className="text-xs text-zinc-500 truncate">{u.email}</p>
                            </div>
                            <button onClick={() => removeUser(p.id, u.id)}
                              className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded-lg hover:bg-red-900/20 transition-colors">
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-600">No accounts assigned yet.</p>
                    )}
                    <div>
                      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Assign a member account</p>
                      <div className="relative">
                        <input
                          value={search}
                          onChange={e => setSearches(s => ({ ...s, [p.id]: e.target.value }))}
                          placeholder="Search by name…"
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500"
                        />
                        {searchResults.length > 0 && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden z-20 shadow-xl">
                            {searchResults.map(m => (
                              <button key={m.id} onClick={() => assignUser(p.id, m)}
                                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-700 transition-colors text-left">
                                <div className="w-7 h-7 rounded-full bg-zinc-600 flex items-center justify-center text-xs font-bold text-white shrink-0">{m.name[0]}</div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-white truncate">{m.name}</p>
                                  <p className="text-xs text-zinc-500 truncate">{m.email}</p>
                                </div>
                                <span className="text-xs text-amber-400 font-semibold shrink-0">Assign →</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-zinc-600 mt-2">Sets their role to <span className="text-zinc-400">partner</span> so they can access the partner portal.</p>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
