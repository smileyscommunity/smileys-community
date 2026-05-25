'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'

const CATEGORIES = [
  { id: 'all',      label: 'All' },
  { id: 'ROOMS',    label: 'Rooms' },
  { id: 'JOBS',     label: 'Jobs' },
  { id: 'SERVICES', label: 'Services' },
  { id: 'BUY_SELL', label: 'Buy & Sell' },
  { id: 'FREE',     label: 'Free' },
  { id: 'RECO',     label: 'Recommendations' },
]

const CATEGORY_OPTIONS = [
  { id: 'ROOMS',    label: 'Rooms & Housing' },
  { id: 'JOBS',     label: 'Jobs & Gigs' },
  { id: 'SERVICES', label: 'Services' },
  { id: 'BUY_SELL', label: 'Buy & Sell' },
  { id: 'FREE',     label: 'Free Stuff' },
  { id: 'RECO',     label: 'Recommendations' },
]

interface ListingSettings {
  enabledCategories: string[]
  defaultExpiryDays: number
  requireApproval: boolean
  maxActivePerMember: number
}

const STATUS_OPTS = [
  { id: 'active',  label: 'Active'  },
  { id: 'expired', label: 'Expired' },
  { id: 'deleted', label: 'Deleted' },
  { id: 'filled',  label: 'Filled'  },
  { id: 'all',     label: 'All'     },
]

const CAT_COLOR: Record<string, string> = {
  ROOMS:    'bg-blue-500/10 text-blue-400',
  JOBS:     'bg-green-500/10 text-green-400',
  SERVICES: 'bg-orange-500/10 text-orange-400',
  BUY_SELL: 'bg-purple-500/10 text-purple-400',
  FREE:     'bg-teal-500/10 text-teal-400',
  RECO:     'bg-amber-500/10 text-amber-400',
}

interface Listing {
  id: string
  category: string
  title: string
  description: string
  price: string | null
  contact: string | null
  status: string
  expiresAt: string
  createdAt: string
  user: { id: string; name: string; email: string; color: string }
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
      style={{ backgroundColor: color }}>
      {name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
    </div>
  )
}

const DEFAULT_LISTING_SETTINGS: ListingSettings = {
  enabledCategories: ['ROOMS', 'JOBS', 'SERVICES', 'BUY_SELL', 'FREE', 'RECO'],
  defaultExpiryDays: 30,
  requireApproval:   false,
  maxActivePerMember: 5,
}

export default function AdminListingsPage() {
  const [listings, setListings]   = useState<Listing[]>([])
  const [total, setTotal]         = useState(0)
  const [hasMore, setHasMore]     = useState(false)
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [category, setCategory]   = useState('all')
  const [status, setStatus]       = useState('active')
  const [query, setQuery]         = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings]   = useState<ListingSettings>(DEFAULT_LISTING_SETTINGS)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [editing, setEditing] = useState<Listing | null>(null)
  const [editForm, setEditForm] = useState({ title: '', description: '', price: '' })

  useEffect(() => {
    fetch('/app/api/admin/settings', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.listingSettings) {
          setSettings(s => ({ ...s, ...data.listingSettings }))
        }
      })
      .catch(() => {})
  }, [])

  async function saveSettings() {
    setSettingsSaving(true)
    const res = await fetch('/app/api/admin/settings', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingSettings: settings }),
    })
    setSettingsSaving(false)
    res.ok ? toast.success('Board settings saved ✓') : toast.error('Failed to save')
  }

  const fetch_ = useCallback(async (q: string, cat: string, st: string, offset: number, append = false) => {
    const params = new URLSearchParams({ offset: String(offset), status: st })
    if (cat !== 'all') params.set('category', cat)
    if (q) params.set('search', q)
    const res  = await fetch(`/app/api/admin/listings?${params}`, { credentials: 'include' })
    const data = await res.json()
    setListings(prev => append ? [...prev, ...data.listings] : data.listings)
    setTotal(data.total)
    setHasMore(data.hasMore)
  }, [])

  useEffect(() => {
    setLoading(true)
    fetch_(query, category, status, 0).finally(() => setLoading(false))
  }, [query, category, status, fetch_])

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 350)
    return () => clearTimeout(t)
  }, [search])

  async function handleDelete(id: string) {
    if (!confirm('Remove this listing?')) return
    await fetch(`/app/api/admin/listings/${id}`, { method: 'DELETE', credentials: 'include' })
    setListings(prev => prev.filter(l => l.id !== id))
    setTotal(t => t - 1)
  }

  async function handleRestore(id: string) {
    await fetch(`/app/api/admin/listings/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })
    setListings(prev => prev.filter(l => l.id !== id))
    setTotal(t => t - 1)
  }

  function openEdit(l: Listing) {
    setEditing(l)
    setEditForm({ title: l.title, description: l.description, price: l.price ?? '' })
  }

  async function handleSaveEdit() {
    if (!editing) return
    const res = await fetch(`/app/api/admin/listings/${editing.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: editForm.title.trim(), description: editForm.description.trim(), price: editForm.price.trim() || null }),
    })
    if (res.ok) {
      setListings(prev => prev.map(l => l.id === editing.id
        ? { ...l, title: editForm.title.trim(), description: editForm.description.trim(), price: editForm.price.trim() || null }
        : l
      ))
      setEditing(null)
    }
  }

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEditing(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-lg space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-white font-bold text-lg">Edit Listing</h2>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Title</label>
              <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Price</label>
              <input value={editForm.price} onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))}
                placeholder="e.g. ₺500 / month"
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Description</label>
              <textarea rows={5} value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none" />
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={handleSaveEdit} className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors">Save changes</button>
            </div>
          </div>
        </div>
      )}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Community Board</h1>
          <p className="text-zinc-400 text-sm mt-1">{total} listing{total !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/app/admin/listings/bulk"
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-amber-500/40 hover:text-amber-400 transition-colors">
            <span>＋</span> Bulk add
          </a>
          <button
            onClick={() => setShowSettings(s => !s)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${
              showSettings
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500'
            }`}
          >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="mb-6 bg-zinc-900 border border-zinc-700 rounded-2xl p-6 space-y-6">
          <h2 className="text-white font-bold text-sm uppercase tracking-widest">Board Settings</h2>

          {/* Enabled categories */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-3">Active Categories</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map(c => {
                const enabled = settings.enabledCategories.includes(c.id)
                return (
                  <button
                    key={c.id}
                    onClick={() => setSettings(s => ({
                      ...s,
                      enabledCategories: enabled
                        ? s.enabledCategories.filter(x => x !== c.id)
                        : [...s.enabledCategories, c.id],
                    }))}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                      enabled
                        ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:border-zinc-500'
                    }`}
                  >
                    {enabled ? '✓ ' : ''}{c.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Numeric settings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Default listing expiry (days)</label>
              <input
                type="number"
                min={1}
                max={365}
                value={settings.defaultExpiryDays}
                onChange={e => setSettings(s => ({ ...s, defaultExpiryDays: Number(e.target.value) }))}
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Max active listings per member</label>
              <input
                type="number"
                min={1}
                max={50}
                value={settings.maxActivePerMember}
                onChange={e => setSettings(s => ({ ...s, maxActivePerMember: Number(e.target.value) }))}
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Require approval toggle */}
          <div className="flex items-center justify-between py-2 border-t border-zinc-800">
            <div>
              <p className="text-sm font-semibold text-zinc-200">Require approval before publishing</p>
              <p className="text-xs text-zinc-500 mt-0.5">New listings stay hidden until an admin approves them</p>
            </div>
            <button
              onClick={() => setSettings(s => ({ ...s, requireApproval: !s.requireApproval }))}
              className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ml-4 ${
                settings.requireApproval ? 'bg-amber-500' : 'bg-zinc-700'
              }`}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
                settings.requireApproval ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>

          <button
            onClick={saveSettings}
            disabled={settingsSaving}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors"
          >
            {settingsSaving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search title, description, member…"
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        {/* Category */}
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="px-3 py-2.5 text-sm bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>

        {/* Status */}
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
          <div className="p-12 text-center text-zinc-500">Loading…</div>
        ) : listings.length === 0 ? (
          <div className="p-12 text-center text-zinc-500">No listings found</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-5 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider">Listing</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider hidden md:table-cell">Member</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider hidden lg:table-cell">Category</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider hidden lg:table-cell">Posted</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider hidden lg:table-cell">Expires</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {listings.map(l => (
                <tr key={l.id} className="hover:bg-zinc-800/40 transition-colors group">
                  {/* Title + description */}
                  <td className="px-5 py-4 max-w-xs">
                    <p className="font-semibold text-zinc-100 truncate">{l.title}</p>
                    <p className="text-xs text-zinc-500 truncate mt-0.5">{l.description}</p>
                    {l.price && <span className="text-xs text-amber-400 font-semibold">{l.price}</span>}
                  </td>

                  {/* Member */}
                  <td className="px-4 py-4 hidden md:table-cell">
                    <div className="flex items-center gap-2">
                      <Avatar name={l.user.name} color={l.user.color} />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-zinc-200 truncate">{l.user.name}</p>
                        <p className="text-xs text-zinc-500 truncate">{l.user.email}</p>
                      </div>
                    </div>
                  </td>

                  {/* Category */}
                  <td className="px-4 py-4 hidden lg:table-cell">
                    <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-lg ${CAT_COLOR[l.category] ?? 'bg-zinc-700 text-zinc-400'}`}>
                      {l.category.replace('_', '/')}
                    </span>
                  </td>

                  {/* Posted */}
                  <td className="px-4 py-4 text-xs text-zinc-500 hidden lg:table-cell">
                    {timeAgo(l.createdAt)}
                  </td>

                  {/* Expires */}
                  <td className="px-4 py-4 text-xs text-zinc-500 hidden lg:table-cell">
                    {new Date(l.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => openEdit(l)}
                        className="text-xs text-amber-400 hover:text-amber-300 font-semibold px-3 py-2 rounded-lg hover:bg-amber-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        Edit
                      </button>
                      {l.status === 'deleted' ? (
                        <button
                          onClick={() => handleRestore(l.id)}
                          className="text-xs text-green-400 hover:text-green-300 font-semibold px-3 py-2 rounded-lg hover:bg-green-500/10 transition-colors"
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDelete(l.id)}
                          className="text-xs text-red-400 hover:text-red-300 font-semibold px-3 py-2 rounded-lg hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          Remove
                        </button>
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
              onClick={() => fetch_(query, category, status, listings.length, true)}
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
