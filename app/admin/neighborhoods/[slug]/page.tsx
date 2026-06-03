'use client'

import { useState, useEffect, useRef, use } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { slugToNeighborhood } from '@/lib/neighborhoods'

interface PlaceItem {
  name: string
  description: string
  address: string
  tip: string
  badge: string
}
interface PlaceCategory {
  category: string
  emoji: string
  items: PlaceItem[]
}
interface Guide {
  tagline: string
  image?: string
  imagePosition?: number
  season?: string
  transport: string[]
  languages: string[]
  groupLink?: string
  groupLabel?: string
  spotlight?: { quote: string; name: string; since?: string }
  places: PlaceCategory[]
  tips: string[]
}

const BADGE_OPTIONS = ['', 'Smileys Pick', 'Must Visit', 'Must Try', 'Must Do', 'Hidden Gem', 'Landmark']

const inputCls  = 'w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500'
const labelCls  = 'block text-xs font-bold text-zinc-400 uppercase tracking-wide mb-1.5'
const textareaCls = `${inputCls} resize-none`

function emptyItem(): PlaceItem { return { name: '', description: '', address: '', tip: '', badge: '' } }
function emptyCategory(): PlaceCategory { return { category: '', emoji: '📍', items: [emptyItem()] } }

export default function EditNeighborhoodPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const name = slugToNeighborhood(slug) ?? slug

  const [guide,   setGuide]   = useState<Guide>({ tagline: '', transport: [], languages: [], places: [], tips: [] })
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [uploading, setUploading] = useState(false)
  const [expandedCat, setExpandedCat] = useState<number | null>(0)
  const [expandedItem, setExpandedItem] = useState<string | null>(null) // "catI-itemI"
  // Inline-confirm state for nuking a whole category. Was a hair-trigger
  // single-click delete — easy misclick to lose dozens of places.
  const [confirmRemoveCat, setConfirmRemoveCat] = useState<number | null>(null)
  // Snapshot of the last loaded/saved state used to compute the dirty
  // flag — without this Save was always enabled and admin could spam-
  // write the same JSON to disk repeatedly.
  const [baseline, setBaseline] = useState<string>('')
  const dirty = JSON.stringify(guide) !== baseline
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`/app/api/admin/neighborhoods/${slug}`, { credentials: 'include' })
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}))
          toast.error(d?.error ?? `Couldn't load guide (HTTP ${r.status})`)
          return null
        }
        return r.json()
      })
      .then(data => {
        if (!data) return
        const next: Guide = {
          tagline:    data.tagline ?? '',
          image:      data.image,
          season:     data.season ?? '',
          transport:  data.transport ?? [],
          languages:  data.languages ?? [],
          groupLink:  data.groupLink ?? '',
          groupLabel: data.groupLabel ?? '',
          spotlight:  data.spotlight ?? undefined,
          places:    (data.places ?? []).map((cat: PlaceCategory) => ({
            ...cat,
            items: (cat.items ?? []).map((item: PlaceItem) => ({
              name: item.name ?? '',
              description: item.description ?? '',
              address: item.address ?? '',
              tip: item.tip ?? '',
              badge: item.badge ?? '',
            }))
          })),
          tips: data.tips ?? [],
        }
        setGuide(next)
        // Seed the dirty-state baseline with what the server returned.
        setBaseline(JSON.stringify(next))
      })
      .catch(() => toast.error('Network error — could not load guide'))
      .finally(() => setLoading(false))
  }, [slug])

  async function save() {
    if (!dirty) return
    setSaving(true)
    try {
      const res = await fetch(`/app/api/admin/neighborhoods/${slug}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(guide),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Surface the server's actual error — previously
        // `throw new Error()` discarded it and the catch fell through
        // to a generic "Failed to save".
        toast.error(data?.error ?? 'Failed to save')
        return
      }
      // Refresh the dirty baseline so the Save button disables again.
      setBaseline(JSON.stringify(guide))
      toast.success('Saved ✓')
    } catch { toast.error('Network error — please try again') }
    finally { setSaving(false) }
  }

  // Warn before leaving the page if there are unsaved edits — guards
  // against tab-close, refresh, and in-app navigation that would
  // otherwise drop the entire edit silently.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return
      e.preventDefault()
      e.returnValue = '' // required by older browsers for the prompt
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  async function uploadImage(file: File) {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/app/api/admin/neighborhoods/${slug}/image`, {
        method: 'POST', credentials: 'include', body: fd,
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Upload failed'); return }
      setGuide(g => ({ ...g, image: data.url }))
      toast.success('Banner uploaded ✓')
    } catch { toast.error('Upload failed') }
    finally { setUploading(false) }
  }

  // Tips helpers
  function addTip() { setGuide(g => ({ ...g, tips: [...g.tips, ''] })) }
  function updateTip(i: number, v: string) {
    setGuide(g => { const tips = [...g.tips]; tips[i] = v; return { ...g, tips } })
  }
  function removeTip(i: number) {
    setGuide(g => ({ ...g, tips: g.tips.filter((_, idx) => idx !== i) }))
  }

  // Category helpers
  function addCategory() {
    setGuide(g => ({ ...g, places: [...g.places, emptyCategory()] }))
    setExpandedCat(guide.places.length)
  }
  function updateCategory(ci: number, field: keyof PlaceCategory, value: string) {
    setGuide(g => {
      const places = [...g.places]
      places[ci] = { ...places[ci], [field]: value }
      return { ...g, places }
    })
  }
  function removeCategory(ci: number) {
    setGuide(g => ({ ...g, places: g.places.filter((_, i) => i !== ci) }))
    if (expandedCat === ci) setExpandedCat(null)
  }
  function moveCategoryUp(ci: number) {
    if (ci === 0) return
    setGuide(g => {
      const places = [...g.places];
      [places[ci - 1], places[ci]] = [places[ci], places[ci - 1]]
      return { ...g, places }
    })
  }
  function moveCategoryDown(ci: number) {
    setGuide(g => {
      if (ci >= g.places.length - 1) return g
      const places = [...g.places];
      [places[ci], places[ci + 1]] = [places[ci + 1], places[ci]]
      return { ...g, places }
    })
  }

  // Item helpers
  function addItem(ci: number) {
    setGuide(g => {
      const places = [...g.places]
      places[ci] = { ...places[ci], items: [...places[ci].items, emptyItem()] }
      return { ...g, places }
    })
    const newIdx = guide.places[ci]?.items.length ?? 0
    setExpandedItem(`${ci}-${newIdx}`)
  }
  function updateItem(ci: number, ii: number, field: keyof PlaceItem, value: string) {
    setGuide(g => {
      const places = [...g.places]
      const items = [...places[ci].items]
      items[ii] = { ...items[ii], [field]: value }
      places[ci] = { ...places[ci], items }
      return { ...g, places }
    })
  }
  function removeItem(ci: number, ii: number) {
    setGuide(g => {
      const places = [...g.places]
      places[ci] = { ...places[ci], items: places[ci].items.filter((_, i) => i !== ii) }
      return { ...g, places }
    })
  }

  if (loading) return (
    <div className="p-6 space-y-4">
      {[1,2,3].map(i => <div key={i} className="h-20 bg-zinc-900 rounded-2xl border border-zinc-800 animate-pulse" />)}
    </div>
  )

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/admin/neighborhoods" className="text-zinc-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-lg font-bold text-white">{name}</h1>
            <p className="text-xs text-zinc-500">Neighborhood guide editor</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/neighborhoods/${slug}`}
            target="_blank"
            className="px-3 py-2 text-xs font-semibold text-zinc-400 hover:text-white border border-zinc-700 rounded-xl transition-colors"
          >
            View page ↗
          </Link>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      {/* Banner Image */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-zinc-800">
          <h2 className="text-sm font-bold text-white">Banner Image</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Shown at the top of the neighborhood page. Recommended: landscape photo, 1600×560px.</p>
        </div>
        <div className="p-5">
          {guide.image ? (
            <div className="space-y-3">
              <div className="relative w-full h-40 rounded-xl overflow-hidden bg-zinc-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={guide.image}
                  alt={name}
                  className="w-full h-full object-cover"
                  style={{ objectPosition: `center ${guide.imagePosition ?? 50}%` }}
                />
                <div className="absolute inset-0 flex items-end p-3 bg-gradient-to-t from-black/40 to-transparent">
                  <span className="text-xs text-white/70 truncate">{guide.image}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-zinc-500 shrink-0">Top</span>
                <input
                  type="range" min={0} max={100}
                  value={guide.imagePosition ?? 50}
                  onChange={e => setGuide(g => ({ ...g, imagePosition: Number(e.target.value) }))}
                  className="flex-1 h-1 accent-amber-500 cursor-pointer"
                />
                <span className="text-[10px] text-zinc-500 shrink-0">Bottom</span>
                <span className="text-[10px] text-zinc-400 shrink-0 w-12 text-right">
                  {(guide.imagePosition ?? 50) === 50 ? 'Center' : `${guide.imagePosition ?? 50}%`}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="px-3 py-2 text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl transition-colors disabled:opacity-50"
                >
                  {uploading ? 'Uploading…' : 'Replace'}
                </button>
                <button
                  onClick={() => setGuide(g => ({ ...g, image: undefined }))}
                  className="px-3 py-2 text-xs font-semibold text-red-400 hover:text-red-300 border border-zinc-700 rounded-xl transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="w-full border-2 border-dashed border-zinc-700 hover:border-amber-500/50 rounded-xl p-8 text-center transition-colors group"
            >
              <div className="text-3xl mb-2">🖼️</div>
              <div className="text-sm font-semibold text-zinc-400 group-hover:text-white transition-colors">
                {uploading ? 'Uploading…' : 'Click to upload banner image'}
              </div>
              <div className="text-xs text-zinc-600 mt-1">JPG, PNG, WebP — max 10MB</div>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = '' }}
          />
        </div>
      </section>

      {/* Tagline */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
        <label className={labelCls}>Tagline</label>
        <input
          type="text"
          value={guide.tagline}
          onChange={e => setGuide(g => ({ ...g, tagline: e.target.value }))}
          placeholder="One-sentence description of the neighborhood..."
          className={inputCls}
        />
        <p className="text-xs text-zinc-600 mt-1.5">Shown in the banner and in the city guide card.</p>
      </section>

      {/* Season + Transport */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
        <div>
          <label className={labelCls}>Best Season</label>
          <select
            value={guide.season ?? ''}
            onChange={e => setGuide(g => ({ ...g, season: e.target.value }))}
            className={`${inputCls} bg-zinc-800`}
          >
            <option value="">— not set —</option>
            <option value="☀️ Great in summer">☀️ Great in summer</option>
            <option value="🍂 Best in autumn">🍂 Best in autumn</option>
            <option value="🌸 Best in spring">🌸 Best in spring</option>
            <option value="❄️ Good in winter">❄️ Good in winter</option>
            <option value="🌿 Year-round">🌿 Year-round</option>
          </select>
          <p className="text-xs text-zinc-600 mt-1.5">Shows as a pill in the neighborhood banner.</p>
        </div>
        <div>
          <label className={labelCls}>Transport Links</label>
          <p className="text-xs text-zinc-500 mb-2">Add one per line e.g. 🚇 M4 Metro · ⛴️ Ferry · 🚌 Bus</p>
          {(guide.transport ?? []).map((t, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input
                type="text"
                value={t}
                onChange={e => {
                  const transport = [...(guide.transport ?? [])]
                  transport[i] = e.target.value
                  setGuide(g => ({ ...g, transport }))
                }}
                placeholder="🚇 M2 Metro"
                className={`${inputCls} flex-1`}
              />
              <button
                onClick={() => setGuide(g => ({ ...g, transport: (g.transport ?? []).filter((_, idx) => idx !== i) }))}
                className="p-2.5 text-zinc-500 hover:text-red-400 border border-zinc-700 rounded-xl transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          <button
            onClick={() => setGuide(g => ({ ...g, transport: [...(g.transport ?? []), ''] }))}
            className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold rounded-xl transition-colors"
          >
            + Add transport
          </button>
        </div>
      </section>

      {/* Languages */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="text-sm font-bold text-white">Languages & Expat Info</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Tags shown in the banner e.g. "🌍 English-friendly"</p>
          </div>
          <button onClick={() => setGuide(g => ({ ...g, languages: [...(g.languages ?? []), ''] }))}
            className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold rounded-xl transition-colors">
            + Add
          </button>
        </div>
        {(guide.languages ?? []).map((l, i) => (
          <div key={i} className="flex gap-2">
            <input type="text" value={l}
              onChange={e => {
                const languages = [...(guide.languages ?? [])]
                languages[i] = e.target.value
                setGuide(g => ({ ...g, languages }))
              }}
              placeholder="🌍 English-friendly"
              className={`${inputCls} flex-1`} />
            <button onClick={() => setGuide(g => ({ ...g, languages: (g.languages ?? []).filter((_, idx) => idx !== i) }))}
              className="p-2.5 text-zinc-500 hover:text-red-400 border border-zinc-700 rounded-xl transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </section>

      {/* Group link */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
        <h2 className="text-sm font-bold text-white">Community Group Link</h2>
        <p className="text-xs text-zinc-500">WhatsApp, Telegram, or any group link shown as a button in the banner.</p>
        <div>
          <label className={labelCls}>Link URL</label>
          <input type="text" value={guide.groupLink ?? ''}
            onChange={e => setGuide(g => ({ ...g, groupLink: e.target.value }))}
            placeholder="https://chat.whatsapp.com/..."
            className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Button label</label>
          <input type="text" value={guide.groupLabel ?? ''}
            onChange={e => setGuide(g => ({ ...g, groupLabel: e.target.value }))}
            placeholder="Join WhatsApp Group"
            className={inputCls} />
        </div>
      </section>

      {/* Spotlight quote */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">Member Spotlight</h2>
            <p className="text-xs text-zinc-500 mt-0.5">A real quote from a member who lives here.</p>
          </div>
          {!guide.spotlight && (
            <button onClick={() => setGuide(g => ({ ...g, spotlight: { quote: '', name: '', since: '' } }))}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold rounded-xl transition-colors">
              + Add quote
            </button>
          )}
        </div>
        {guide.spotlight && (
          <>
            <div>
              <label className={labelCls}>Quote</label>
              <textarea rows={3} value={guide.spotlight.quote}
                onChange={e => setGuide(g => ({ ...g, spotlight: { ...g.spotlight!, quote: e.target.value } }))}
                placeholder="I chose Cihangir because the brunch spots are unreal and I can walk everywhere..."
                className={textareaCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Member name</label>
                <input type="text" value={guide.spotlight.name}
                  onChange={e => setGuide(g => ({ ...g, spotlight: { ...g.spotlight!, name: e.target.value } }))}
                  placeholder="Sarah K." className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Since (optional)</label>
                <input type="text" value={guide.spotlight.since ?? ''}
                  onChange={e => setGuide(g => ({ ...g, spotlight: { ...g.spotlight!, since: e.target.value } }))}
                  placeholder="Member since 2023" className={inputCls} />
              </div>
            </div>
            <button onClick={() => setGuide(g => ({ ...g, spotlight: undefined }))}
              className="text-xs text-red-400 hover:text-red-300 transition-colors">
              Remove spotlight
            </button>
          </>
        )}
      </section>

      {/* Places / Categories */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">Local Favorites</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Add categories (Coffee, Food, Things to Do…) with places inside each.</p>
          </div>
          <button
            onClick={addCategory}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold rounded-xl transition-colors"
          >
            + Add category
          </button>
        </div>

        {guide.places.length === 0 && (
          <div className="bg-zinc-900 border border-zinc-800 border-dashed rounded-2xl p-8 text-center text-zinc-500 text-sm">
            No categories yet. Add one to get started.
          </div>
        )}

        {guide.places.map((cat, ci) => (
          <div key={ci} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            {/* Category header */}
            <div className="flex items-center gap-3 p-4 border-b border-zinc-800">
              <button
                onClick={() => setExpandedCat(expandedCat === ci ? null : ci)}
                className="flex-1 flex items-center gap-3 text-left"
              >
                <span className="text-lg">{cat.emoji || '📍'}</span>
                <span className="font-semibold text-white text-sm">
                  {cat.category || 'New Category'}
                </span>
                <span className="text-xs text-zinc-500">{cat.items.length} place{cat.items.length !== 1 ? 's' : ''}</span>
                <svg
                  className={`w-4 h-4 text-zinc-500 ml-auto transition-transform ${expandedCat === ci ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div className="flex items-center gap-1">
                <button onClick={() => moveCategoryUp(ci)} disabled={ci === 0}
                  className="p-1.5 text-zinc-500 hover:text-white disabled:opacity-30 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <button onClick={() => moveCategoryDown(ci)} disabled={ci === guide.places.length - 1}
                  className="p-1.5 text-zinc-500 hover:text-white disabled:opacity-30 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {/* Two-click confirm so a misclick doesn't wipe an
                    entire category and its places. First click flips
                    the trash icon to a red "Delete?" pill; second
                    click within the same UI state actually removes. */}
                {confirmRemoveCat === ci ? (
                  <div className="flex items-center gap-1">
                    <button onClick={() => { removeCategory(ci); setConfirmRemoveCat(null) }}
                      className="px-2 py-1 text-[10px] font-bold bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors">
                      Delete?
                    </button>
                    <button onClick={() => setConfirmRemoveCat(null)}
                      className="px-2 py-1 text-[10px] font-bold text-zinc-400 hover:text-white bg-zinc-800 rounded-md transition-colors">
                      ✕
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmRemoveCat(ci)}
                    className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors"
                    title="Delete category">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {expandedCat === ci && (
              <div className="p-4 space-y-4">
                {/* Category name + emoji */}
                <div className="grid grid-cols-[72px_1fr] gap-3">
                  <div>
                    <label className={labelCls}>Emoji</label>
                    <input
                      type="text"
                      value={cat.emoji}
                      onChange={e => updateCategory(ci, 'emoji', e.target.value)}
                      placeholder="☕"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Category name</label>
                    <input
                      type="text"
                      value={cat.category}
                      onChange={e => updateCategory(ci, 'category', e.target.value)}
                      placeholder="Coffee, Food, Things to Do..."
                      className={inputCls}
                    />
                  </div>
                </div>

                {/* Items */}
                <div className="space-y-2">
                  {cat.items.map((item, ii) => {
                    const key = `${ci}-${ii}`
                    const isOpen = expandedItem === key
                    return (
                      <div key={ii} className="bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden">
                        {/* Item header */}
                        <div className="flex items-center gap-2 px-3 py-2.5">
                          <button
                            onClick={() => setExpandedItem(isOpen ? null : key)}
                            className="flex-1 flex items-center gap-2 text-left"
                          >
                            <span className="text-sm text-white font-medium">
                              {item.name || 'New place'}
                            </span>
                            {item.badge && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                                {item.badge}
                              </span>
                            )}
                            <svg
                              className={`w-3.5 h-3.5 text-zinc-500 ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => removeItem(ci, ii)}
                            className="p-1 text-zinc-500 hover:text-red-400 transition-colors shrink-0"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>

                        {isOpen && (
                          <div className="px-3 pb-3 space-y-3 border-t border-zinc-700 pt-3">
                            <div>
                              <label className={labelCls}>Name</label>
                              <input type="text" value={item.name}
                                onChange={e => updateItem(ci, ii, 'name', e.target.value)}
                                placeholder="Place name" className={inputCls} />
                            </div>
                            <div>
                              <label className={labelCls}>Description</label>
                              <textarea value={item.description} rows={2}
                                onChange={e => updateItem(ci, ii, 'description', e.target.value)}
                                placeholder="What makes this place worth visiting..." className={textareaCls} />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className={labelCls}>Address</label>
                                <input type="text" value={item.address}
                                  onChange={e => updateItem(ci, ii, 'address', e.target.value)}
                                  placeholder="Street, Neighborhood" className={inputCls} />
                              </div>
                              <div>
                                <label className={labelCls}>Badge</label>
                                <select value={item.badge}
                                  onChange={e => updateItem(ci, ii, 'badge', e.target.value)}
                                  className={inputCls}>
                                  {BADGE_OPTIONS.map(b => (
                                    <option key={b} value={b}>{b || '— none —'}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div>
                              <label className={labelCls}>Insider tip (optional)</label>
                              <textarea value={item.tip} rows={2}
                                onChange={e => updateItem(ci, ii, 'tip', e.target.value)}
                                placeholder="A local tip for getting the most out of this place..." className={textareaCls} />
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}

                  <button
                    onClick={() => addItem(ci)}
                    className="w-full py-2 border border-dashed border-zinc-600 hover:border-amber-500/50 text-zinc-500 hover:text-white text-xs font-semibold rounded-xl transition-colors"
                  >
                    + Add place
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Tips */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="text-sm font-bold text-white">Local Tips</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Practical info shown at the bottom of the guide.</p>
          </div>
          <button
            onClick={addTip}
            className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold rounded-xl transition-colors"
          >
            + Add tip
          </button>
        </div>

        {guide.tips.length === 0 && (
          <p className="text-xs text-zinc-600 text-center py-4">No tips yet.</p>
        )}

        {guide.tips.map((tip, i) => (
          <div key={i} className="flex gap-2">
            <input
              type="text"
              value={tip}
              onChange={e => updateTip(i, e.target.value)}
              placeholder="Practical tip for visitors..."
              className={`${inputCls} flex-1`}
            />
            <button
              onClick={() => removeTip(i)}
              className="p-2.5 text-zinc-500 hover:text-red-400 border border-zinc-700 rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </section>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 inset-x-0 p-4 bg-zinc-950 border-t border-white/5 flex items-center justify-between gap-4 z-20 md:hidden">
        <span className="text-xs text-zinc-500">Remember to save your changes</span>
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
