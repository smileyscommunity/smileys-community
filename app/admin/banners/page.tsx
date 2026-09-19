'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { loadFailure } from '@/lib/admin/useAdminLoad'

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

type AllBanners = Record<BannerPage, Banner[]>

const EMPTY_BANNERS: AllBanners = {
  dashboard: [], events: [], clubs: [], members: [], neighborhoods: [], guide: [],
}

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

// Normalize the parsed shape — every key must hold an array;
// legacy single-object format would otherwise crash list.map().
function normalizeBanners(d: any): AllBanners {
  return {
    dashboard:     Array.isArray(d?.dashboard)     ? d.dashboard     : [],
    events:        Array.isArray(d?.events)        ? d.events        : [],
    clubs:         Array.isArray(d?.clubs)         ? d.clubs         : [],
    members:       Array.isArray(d?.members)       ? d.members       : [],
    neighborhoods: Array.isArray(d?.neighborhoods) ? d.neighborhoods : [],
    guide:         Array.isArray(d?.guide)         ? d.guide         : [],
  }
}

// Mirrors versionOf in app/api/admin/banners/route.ts: which stored list a
// write was built on. The server 409s when it no longer matches.
function versionOf(list: Banner[]): string {
  return list.map(b => `${b.id}@${b.updatedAt}`).join('|')
}

export default function BannersPage() {
  const { user } = useAuth()
  // Banners render in every city, so the API takes writes from admins only.
  const isAdmin = user.role === 'admin'
  const [banners,      setBanners]      = useState<AllBanners>(EMPTY_BANNERS)
  const [expanded,     setExpanded]     = useState<BannerPage | null>(null)
  const [editing,      setEditing]      = useState<Banner | null>(null)
  // Writes replace a page's whole stored list, so until a load has succeeded
  // the empty placeholder must never be posted — a transient 502 followed by
  // any edit used to delete every live banner, paid sponsors included.
  const [loaded,       setLoaded]       = useState(false)
  const [loadError,    setLoadError]    = useState<string | null>(null)
  const [busy,         setBusy]         = useState(false)
  // Inline-confirm for remove — same pattern as the other admin pages.
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  // The latest server-confirmed lists, readable mid-click. Two quick toggles
  // used to build both POSTs from the same render's state, so the second
  // reverted the first.
  const bannersRef = useRef<AllBanners>(EMPTY_BANNERS)
  // One write in flight at a time; a click that lands during one is dropped
  // rather than queued against a list about to change.
  const writing = useRef(false)

  const canWrite = isAdmin && loaded && !busy

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const r = await fetch('/app/api/admin/banners', { credentials: 'include' })
      if (!r.ok) throw await loadFailure(r)
      const next = normalizeBanners(await r.json())
      bannersRef.current = next
      setBanners(next)
      setLoaded(true)
    } catch (e) {
      setLoaded(false)
      setLoadError((e as Error)?.message || 'Network error — could not load banners')
    }
  }, [])

  useEffect(() => { load() }, [load])

  function applyPage(page: BannerPage, list: Banner[]) {
    bannersRef.current = { ...bannersRef.current, [page]: list }
    setBanners(prev => ({ ...prev, [page]: list }))
  }

  // Every write goes through here: built from the latest server-confirmed
  // list at the moment it runs (not the render that queued the click), sent
  // with that list's version, and followed by adopting what the server
  // stored — never what we hoped it stored.
  async function writePage(page: BannerPage, build: (current: Banner[]) => Banner[], failMsg: string): Promise<boolean> {
    if (!isAdmin || !loaded || writing.current) return false
    writing.current = true
    setBusy(true)
    try {
      const current = bannersRef.current[page] || []
      const res = await fetch('/app/api/admin/banners', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, banners: build(current), baseVersion: versionOf(current) }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && Array.isArray(data?.banners)) {
        // Someone (or an earlier lost response) changed the list — resync
        // to what's stored and let the admin re-apply deliberately.
        applyPage(page, data.banners)
        toast.error(data.error ?? 'Banners changed since you loaded them — refreshed')
        return false
      }
      if (!res.ok || !Array.isArray(data?.banners)) {
        // Surface the server's actual error.
        toast.error(data?.error ?? failMsg)
        return false
      }
      applyPage(page, data.banners)
      return true
    } catch {
      // The write may or may not have landed; the next one carries the old
      // version and gets a 409 + resync rather than clobbering.
      toast.error('Network error — please try again')
      return false
    } finally {
      writing.current = false
      setBusy(false)
    }
  }

  // Inline link validation that mirrors the server's isSafeHref so
  // admins see the error before submitting.
  function clientLinkValid(link: string): boolean {
    if (!link) return true
    // eslint-disable-next-line no-control-regex
    if (/[\s\x00-\x1f]/.test(link)) return false
    if (link.startsWith('//')) return false
    if (link.startsWith('/')) return true
    return /^https:\/\//i.test(link)
  }

  function startEdit(page: BannerPage, existing?: Banner) {
    if (!canWrite) return
    setEditing(existing || { ...EMPTY, page, id: '' })
  }

  async function save() {
    if (!editing) return
    // Inline validate the link before submitting so admin sees the
    // error in-context instead of getting a 400 toast after a roundtrip.
    if (!clientLinkValid(editing.link)) {
      toast.error('Link must be https:// or a /relative path')
      return
    }
    const draft = editing
    // If new, append. If existing, replace — against the latest list.
    const ok = await writePage(draft.page, current => !draft.id
      ? [...current, { ...draft, id: `b_${Date.now()}` }]
      : current.map(b => b.id === draft.id ? draft : b),
    'Failed to save')
    if (!ok) return
    toast.success('Banners updated!')
    setEditing(null)
  }

  async function remove(page: BannerPage, id: string) {
    const ok = await writePage(page, current => current.filter(b => b.id !== id), 'Failed to remove')
    if (!ok) return
    setConfirmRemove(null)
    toast.success('Banner removed')
  }

  async function toggleActive(page: BannerPage, id: string) {
    // Flips the banner as the server last stored it, not as this render saw
    // it. Failure leaves state as the server has it (writePage never
    // applies an unconfirmed list).
    await writePage(page, current => current.map(b => b.id === id ? { ...b, active: !b.active } : b), 'Failed to toggle')
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold text-white">Banners</h1>
        <p className="text-sm text-zinc-400 mt-1">Manage promotional content across the platform.</p>
        {!isAdmin && (
          <p className="text-xs text-amber-400/80 mt-2">Network-wide content is admin-only — you can view banners here, but only an admin can change them.</p>
        )}
      </div>

      <LoadErrorBanner message={loadError} onRetry={load} title="Couldn't load banners — editing is disabled until they load" />

      {!loaded && !loadError && <p className="text-sm text-zinc-500">Loading…</p>}

      {loaded && <div className="space-y-4">
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
                            {/* md:opacity-0 + md:group-hover (only on
                                hover-capable pointers) keeps the clean
                                hover-reveal on desktop while showing the
                                controls unconditionally on touch —
                                including touch tablets at md+ —
                                previously the entire button cluster was
                                unreachable without hover. */}
                            {isAdmin && (
                            <div className="flex items-center gap-2 md:[@media(hover:hover)]:opacity-0 md:[@media(hover:hover)]:group-hover:opacity-100 transition-opacity">
                              <button onClick={() => toggleActive(p.key, b.id)} disabled={!canWrite} className="p-1 text-zinc-500 hover:text-white disabled:opacity-40" title={b.active ? 'Deactivate' : 'Activate'}>
                                {b.active ? '⏸' : '▶'}
                              </button>
                              <button onClick={() => startEdit(p.key, b)} disabled={!canWrite} className="p-1 text-zinc-500 hover:text-amber-500 disabled:opacity-40" title="Edit">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                              </button>
                              {/* Two-click confirm — first click flips
                                  the icon into a red "Delete?" pill so
                                  a misclick doesn't immediately destroy
                                  a live banner. */}
                              {confirmRemove === b.id ? (
                                <div className="flex items-center gap-1">
                                  <button onClick={() => remove(p.key, b.id)} disabled={!canWrite}
                                    className="px-1.5 py-0.5 text-[10px] font-bold bg-red-500 hover:bg-red-600 text-white rounded transition-colors disabled:opacity-40">
                                    Delete?
                                  </button>
                                  <button onClick={() => setConfirmRemove(null)}
                                    className="px-1.5 py-0.5 text-[10px] font-bold text-zinc-400 hover:text-white bg-zinc-800 rounded transition-colors">
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <button onClick={() => setConfirmRemove(b.id)} disabled={!canWrite} className="p-1 text-zinc-500 hover:text-red-500 disabled:opacity-40" title="Remove">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                              )}
                            </div>
                            )}
                          </div>
                          <BannerPreview b={b} />
                        </div>
                      ))}
                    </div>
                  )}

                  {isAdmin && (
                    <button
                      onClick={() => startEdit(p.key)}
                      disabled={!canWrite}
                      className="w-full py-3 border-2 border-dashed border-zinc-800 hover:border-zinc-700 rounded-2xl text-xs font-bold text-zinc-500 hover:text-zinc-300 transition-colors flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                      <span>+ Add new banner</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>}

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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-1.5 ml-1">CTA Text</label>
                    <input type="text" value={editing.cta} maxLength={20}
                      onChange={e => setEditing({ ...editing, cta: e.target.value })}
                      placeholder="e.g. Join now"
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-1.5 ml-1">Link URL</label>
                    <input type="text" value={editing.link} maxLength={2000}
                      onChange={e => setEditing({ ...editing, link: e.target.value })}
                      placeholder="/events or https://..."
                      className={`w-full px-4 py-3 bg-zinc-800 border rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 ${
                        clientLinkValid(editing.link)
                          ? 'border-zinc-700 focus:ring-amber-500'
                          : 'border-red-500/50 focus:ring-red-500'
                      }`} />
                    {!clientLinkValid(editing.link) && (
                      <p className="text-xs text-red-400 mt-1 ml-1">Must be https:// or a /relative path</p>
                    )}
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
              <button onClick={save}
                disabled={!canWrite || !editing.headline.trim() || !clientLinkValid(editing.link)}
                className="flex-[2] py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-lg shadow-amber-500/10">
                {busy ? 'Saving…' : editing.id ? 'Update Banner' : 'Create Banner'}
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
