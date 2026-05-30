'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'

type BannerType = 'sponsored' | 'promo' | 'strip'
type BannerPage = 'dashboard' | 'events' | 'clubs' | 'members' | 'neighborhoods' | 'guide'

interface Banner {
  id:       string
  page:     BannerPage
  type:     BannerType
  active:   boolean
  headline: string
  subtitle: string
  emoji:    string
  link:     string
  cta:      string
  bg:       string
  updatedAt: string
}

type AllBanners = Record<BannerPage, Banner>

const PAGES: { key: BannerPage; label: string; icon: string }[] = [
  { key: 'dashboard',     label: 'Dashboard',      icon: '🏠' },
  { key: 'events',        label: 'Events',         icon: '🗓️' },
  { key: 'clubs',         label: 'Clubs',          icon: '🏛️' },
  { key: 'members',       label: 'Members',        icon: '🤝' },
  { key: 'neighborhoods', label: 'Neighborhoods',  icon: '📍' },
  { key: 'guide',         label: 'City Guide',     icon: '🗺️' },
]

const TYPES: { key: BannerType; label: string; desc: string }[] = [
  { key: 'sponsored', label: 'Sponsored card',     desc: 'Dark gradient — for paid partners' },
  { key: 'promo',     label: 'Promo card',         desc: 'Amber brand — for internal promotions' },
  { key: 'strip',     label: 'Announcement strip', desc: 'Slim full-width bar — subtle, text-only' },
]

const EMPTY: Banner = { id: '', page: 'dashboard', type: 'sponsored', active: false, headline: '', subtitle: '', emoji: '🏷️', link: '', cta: '', bg: '', updatedAt: '' }

function BannerPreview({ b }: { b: Banner }) {
  if (b.type === 'promo') return <PromoPreview b={b} />
  if (b.type === 'strip') return <StripPreview b={b} />
  return <SponsoredPreview b={b} />
}

export default function BannersPage() {
  const [banners,      setBanners]      = useState<Record<BannerPage, Banner[]>>({} as any)
  const [expanded,     setExpanded]     = useState<BannerPage | null>(null)
  const [editing,      setEditing]      = useState<Banner | null>(null)
  const [saving,       setSaving]       = useState(false)

  useEffect(() => {
    fetch('/app/api/admin/banners', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setBanners(d))
      .catch(() => {})
  }, [])

  function startEdit(page: BannerPage, existing?: Banner) {
    setEditing(existing || { ...EMPTY, page, id: '' })
  }

  async function save() {
    if (!editing) return
    const page = editing.page
    const current = banners[page] || []
    
    // If new, append. If existing, replace.
    let updated: Banner[]
    if (!editing.id) {
      updated = [...current, { ...editing, id: `b_${Date.now()}` }]
    } else {
      updated = current.map(b => b.id === editing.id ? editing : b)
    }

    setSaving(true)
    try {
      const res = await fetch('/app/api/admin/banners', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, banners: updated }),
      })
      if (!res.ok) throw new Error()
      setBanners(prev => ({ ...prev, [page]: updated }))
      toast.success('Banners updated!')
      setEditing(null)
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function remove(page: BannerPage, id: string) {
    if (!confirm('Are you sure you want to remove this banner?')) return
    const updated = (banners[page] || []).filter(b => b.id !== id)
    
    try {
      const res = await fetch('/app/api/admin/banners', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, banners: updated }),
      })
      if (!res.ok) throw new Error()
      setBanners(prev => ({ ...prev, [page]: updated }))
      toast.success('Banner removed')
    } catch {
      toast.error('Failed to remove')
    }
  }

  async function toggleActive(page: BannerPage, id: string) {
    const updated = (banners[page] || []).map(b => b.id === id ? { ...b, active: !b.active } : b)
    try {
      await fetch('/app/api/admin/banners', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, banners: updated }),
      })
      setBanners(prev => ({ ...prev, [page]: updated }))
    } catch {
      toast.error('Failed to toggle')
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold text-white">Banners</h1>
        <p className="text-sm text-zinc-400 mt-1">Manage promotional content across the platform.</p>
      </div>

      <div className="space-y-4">
        {PAGES.map(p => {
          const list    = banners[p.key] || []
          const isOpen  = expanded === p.key
          const activeCount = list.filter(b => b.active).length

          return (
            <div key={p.key} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <button
                onClick={() => setExpanded(isOpen ? null : p.key)}
                className="w-full flex items-center gap-4 px-6 py-5 hover:bg-zinc-800/50 transition-colors text-left"
              >
                <span className="text-xl w-6 text-center shrink-0">{p.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">{p.label}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {list.length} banner{list.length !== 1 ? 's' : ''} total · {activeCount} live
                  </p>
                </div>
                <svg className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isOpen && (
                <div className="border-t border-zinc-800 p-6 space-y-6">
                  {list.length === 0 ? (
                    <div className="text-center py-6 border-2 border-dashed border-zinc-800 rounded-2xl">
                      <p className="text-xs text-zinc-500">No banners for this page yet.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {list.map(b => (
                        <div key={b.id} className="relative group bg-zinc-800/30 rounded-2xl p-4 border border-zinc-800 hover:border-zinc-700 transition-colors">
                          <div className="flex items-center justify-between mb-4">
                            <span className={`text-[9px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded ${
                              b.active ? 'bg-green-900/40 text-green-400' : 'bg-zinc-700 text-zinc-500'
                            }`}>
                              {b.active ? 'Active' : 'Draft'}
                            </span>
                            {/* md:opacity-0 + md:group-hover keeps the
                                clean hover-reveal on desktop while
                                showing the controls unconditionally on
                                touch — previously the entire button
                                cluster was unreachable from mobile
                                because there's no hover on touch. */}
                            <div className="flex items-center gap-2 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                              <button onClick={() => toggleActive(p.key, b.id)} className="p-1 text-zinc-500 hover:text-white" title={b.active ? 'Deactivate' : 'Activate'}>
                                {b.active ? '⏸' : '▶'}
                              </button>
                              <button onClick={() => startEdit(p.key, b)} className="p-1 text-zinc-500 hover:text-amber-500" title="Edit">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                              </button>
                              <button onClick={() => remove(p.key, b.id)} className="p-1 text-zinc-500 hover:text-red-500" title="Remove">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            </div>
                          </div>
                          <BannerPreview b={b} />
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => startEdit(p.key)}
                    className="w-full py-3 border-2 border-dashed border-zinc-800 hover:border-zinc-700 rounded-2xl text-xs font-bold text-zinc-500 hover:text-zinc-300 transition-colors flex items-center justify-center gap-2"
                  >
                    <span>+ Add new banner</span>
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Editor Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-5 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                {editing.id ? 'Edit Banner' : 'New Banner'} — <span className="text-amber-500 capitalize">{editing.page}</span>
              </h2>
              <button onClick={() => setEditing(null)} className="text-zinc-500 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Type selector */}
              <div>
                <p className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-3">Banner Type</p>
                <div className="grid grid-cols-3 gap-2">
                  {TYPES.map(t => (
                    <button key={t.key} onClick={() => setEditing({ ...editing, type: t.key })}
                      className={`text-center py-2.5 rounded-xl border transition-colors ${
                        editing.type === t.key
                          ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                          : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                      }`}>
                      <p className="text-xs font-black uppercase">{t.label.split(' ')[0]}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div>
                <p className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-3">Live Preview</p>
                <div className="scale-95 origin-left">
                  <BannerPreview b={editing} />
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-[1fr_80px] gap-3">
                  <div>
                    <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-1.5 ml-1">Headline</label>
                    <input type="text" value={editing.headline} maxLength={60}
                      onChange={e => setEditing({ ...editing, headline: e.target.value })}
                      placeholder="Catchy headline..."
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-1.5 text-center">Emoji</label>
                    <input type="text" value={editing.emoji} maxLength={4}
                      onChange={e => setEditing({ ...editing, emoji: e.target.value })}
                      className="w-full px-2 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-lg text-white text-center focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-1.5 ml-1">Subtitle</label>
                  <input type="text" value={editing.subtitle} maxLength={100}
                    onChange={e => setEditing({ ...editing, subtitle: e.target.value })}
                    placeholder="Brief description..."
                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-1.5 ml-1">CTA Text</label>
                    <input type="text" value={editing.cta} maxLength={20}
                      onChange={e => setEditing({ ...editing, cta: e.target.value })}
                      placeholder="e.g. Join now"
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-1.5 ml-1">Link URL</label>
                    <input type="text" value={editing.link}
                      onChange={e => setEditing({ ...editing, link: e.target.value })}
                      placeholder="/events or https://..."
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input type="checkbox" id="active" checked={editing.active}
                    onChange={e => setEditing({ ...editing, active: e.target.checked })}
                    className="w-4 h-4 rounded border-zinc-700 bg-zinc-800 text-amber-500 focus:ring-amber-500" />
                  <label htmlFor="active" className="text-sm font-medium text-zinc-300 cursor-pointer">Make this banner live immediately</label>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-zinc-800 bg-zinc-800/20 flex gap-3">
              <button onClick={() => setEditing(null)} className="flex-1 py-3 rounded-2xl text-sm font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors border border-zinc-800">
                Cancel
              </button>
              <button onClick={save} disabled={saving || !editing.headline.trim()}
                className="flex-[2] py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm disabled:opacity-40 transition-colors shadow-lg shadow-amber-500/10">
                {saving ? 'Saving…' : editing.id ? 'Update Banner' : 'Create Banner'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SponsoredPreview({ b }: { b: Banner }) {
  return (
    <div className="flex items-center gap-3 bg-gradient-to-r from-zinc-900 to-zinc-700 rounded-2xl px-4 py-3 overflow-hidden relative border border-zinc-700/50">
      <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_80%_50%,#f59e0b_0%,transparent_60%)]" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-0.5">Sponsored</p>
        <p className="text-sm font-bold text-white leading-snug truncate">{b.headline || 'Headline text'}</p>
        {b.subtitle && <p className="text-xs text-zinc-400 truncate leading-tight mt-0.5">{b.subtitle}</p>}
        {b.cta && <p className="text-xs text-amber-400 font-bold mt-1">{b.cta} →</p>}
      </div>
      <div className="shrink-0 w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-xl">{b.emoji || '🏷️'}</div>
    </div>
  )
}

function PromoPreview({ b }: { b: Banner }) {
  return (
    <div className="flex items-center gap-3 bg-gradient-to-r from-amber-500 to-orange-400 rounded-2xl px-4 py-3 overflow-hidden relative border border-amber-400/30">
      <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_20%_50%,#fff_0%,transparent_60%)]" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-amber-100 uppercase tracking-widest mb-0.5">From Smileys</p>
        <p className="text-sm font-bold text-white leading-snug truncate">{b.headline || 'Headline text'}</p>
        {b.subtitle && <p className="text-xs text-amber-100 truncate leading-tight mt-0.5">{b.subtitle}</p>}
        {b.cta && <p className="text-xs font-bold text-white mt-1 underline">{b.cta} →</p>}
      </div>
      <div className="shrink-0 w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl">{b.emoji || '🎉'}</div>
    </div>
  )
}

function StripPreview({ b }: { b: Banner }) {
  return (
    <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
      <span className="text-xl shrink-0">{b.emoji || '📢'}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-amber-900 truncate leading-tight">{b.headline || 'Announcement text'}</p>
        {b.subtitle && <p className="text-xs text-amber-700 truncate leading-tight mt-0.5">{b.subtitle}</p>}
      </div>
      {b.cta && <span className="text-xs font-bold text-amber-600 shrink-0">{b.cta} →</span>}
    </div>
  )
}
