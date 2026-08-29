'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { confirmToast } from '@/lib/confirmToast'

interface NeighborhoodEntry {
  name: string
  slug: string
  meta: { emoji: string; vibe: string; side: string }
  hasGuide: boolean
  hasImage: boolean
  // Present only for non-default cities — the DB row identity + raw
  // attributes the inline editor works on. The default city's attributes are
  // authored in code (NEIGHBORHOOD_META), so its entries stay read-only.
  id?: string
  cost?: number
  lat?: number | null
  lng?: number | null
}

// Inline editor draft — lat/lng kept as strings so a half-typed "-27." doesn't
// fight the input; parsed and validated on save.
interface AttrDraft {
  emoji: string
  vibe: string
  area: string
  cost: number
  lat: string
  lng: string
}

interface CityOption {
  id: string
  name: string
  slug: string
  isDefault: boolean
}

const SIDE_COLOR: Record<string, string> = {
  Central:  'bg-amber-500/10 text-amber-400 border-amber-500/20',
  European: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Asian:    'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  Coastal:  'bg-sky-500/10 text-sky-400 border-sky-500/20',
  Islands:  'bg-purple-500/10 text-purple-400 border-purple-500/20',
  Emerging: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
}

// Suspense wrapper because useSearchParams forces it. Mirrors the
// pattern on /admin/payments — the city selection lives in the URL so
// the editor's back link can land on the same city's list.
export default function AdminNeighborhoodsPage() {
  return <Suspense><AdminNeighborhoodsPageInner /></Suspense>
}

function AdminNeighborhoodsPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [neighborhoods, setNeighborhoods] = useState<NeighborhoodEntry[]>([])
  const [cities, setCities] = useState<CityOption[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'with-guide' | 'no-guide'>('all')
  const [search, setSearch] = useState('')
  // '' means the default city — the URL stays param-free so pre-multi-city
  // bookmarks keep their exact behavior.
  const citySlug = searchParams.get('city') ?? ''

  // Inline attribute editor (non-default cities only).
  const [editingSlug, setEditingSlug] = useState<string | null>(null)
  const [attrDraft, setAttrDraft]     = useState<AttrDraft | null>(null)
  const [savingAttrs, setSavingAttrs] = useState(false)

  // The PATCH needs the city's id; the cities fetch already carries it.
  const currentCity = cities.find(c => (citySlug ? c.slug === citySlug : c.isDefault))
  const editable = citySlug !== '' && !!currentCity

  useEffect(() => {
    fetch('/app/api/admin/cities', { credentials: 'include' })
      .then(async r => (r.ok ? r.json() : []))
      .then(d => {
        if (!Array.isArray(d)) return
        // Default city first, so the dropdown opens on the familiar list.
        setCities([...(d as CityOption[])].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)))
      })
      .catch(() => { /* dropdown just doesn't render — the default list still loads */ })
  }, [])

  useEffect(() => {
    setLoading(true)
    setEditingSlug(null) // a half-open editor must not survive a city switch
    fetch(`/app/api/admin/neighborhoods${citySlug ? `?city=${encodeURIComponent(citySlug)}` : ''}`, { credentials: 'include' })
      .then(async r => {
        // Previously `.then(setNeighborhoods)` was called on whatever
        // the response body deserialized to. A failed GET returns
        // { error: '...' } and the later `.filter(...)` blew up on a
        // non-array. Guard the parse here.
        if (!r.ok) {
          const d = await r.json().catch(() => ({}))
          toast.error(d?.error ?? `Couldn't load neighborhoods (HTTP ${r.status})`)
          return [] as NeighborhoodEntry[]
        }
        const d = await r.json()
        return Array.isArray(d) ? (d as NeighborhoodEntry[]) : []
      })
      .then(setNeighborhoods)
      .catch(() => toast.error('Network error — could not load neighborhoods'))
      .finally(() => setLoading(false))
  }, [citySlug])

  const filtered = neighborhoods.filter(n => {
    if (filter === 'with-guide' && !n.hasGuide) return false
    if (filter === 'no-guide' && n.hasGuide) return false
    if (search && !n.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const withGuide = neighborhoods.filter(n => n.hasGuide).length
  const withImage = neighborhoods.filter(n => n.hasImage).length

  function startEdit(n: NeighborhoodEntry) {
    setEditingSlug(n.slug)
    setAttrDraft({
      emoji: n.meta.emoji,
      vibe:  n.meta.vibe,
      area:  n.meta.side,
      cost:  n.cost ?? 2,
      lat:   n.lat != null ? String(n.lat) : '',
      lng:   n.lng != null ? String(n.lng) : '',
    })
  }

  async function saveAttrs(n: NeighborhoodEntry) {
    if (!currentCity || !n.id || !attrDraft || savingAttrs) return
    const lat = attrDraft.lat.trim()
    const lng = attrDraft.lng.trim()
    if ((lat && !Number.isFinite(Number(lat))) || (lng && !Number.isFinite(Number(lng)))) {
      toast.error('Coordinates must be numbers'); return
    }
    setSavingAttrs(true)
    try {
      const res = await fetch(`/app/api/admin/cities/${currentCity.id}/neighborhoods`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          neighborhoodId: n.id,
          emoji: attrDraft.emoji.trim() || '📍',
          vibe:  attrDraft.vibe.trim()  || null,
          area:  attrDraft.area.trim()  || null,
          cost:  attrDraft.cost,
          lat:   lat ? Number(lat) : null,
          lng:   lng ? Number(lng) : null,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d?.error ?? 'Could not save'); return }
      const u = d.neighborhood
      setNeighborhoods(prev => prev.map(x => x.slug === n.slug
        ? { ...x, meta: { emoji: u.emoji, vibe: u.vibe ?? '', side: u.area ?? '' }, cost: u.cost, lat: u.lat, lng: u.lng }
        : x))
      setEditingSlug(null)
      toast.success(`Saved ${n.name}`)
    } finally { setSavingAttrs(false) }
  }

  // Same soft-hide as the cities panel's semantics: the row leaves pickers
  // and public pages, content tagged with the name stays readable.
  async function deactivate(n: NeighborhoodEntry) {
    if (!currentCity || !n.id || savingAttrs) return
    if (!(await confirmToast(`Hide ${n.name}? It disappears from pickers and pages; tagged content stays readable. Re-add it by pasting the name on the Cities page.`))) return
    setSavingAttrs(true)
    try {
      const res = await fetch(`/app/api/admin/cities/${currentCity.id}/neighborhoods`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ neighborhoodId: n.id, active: false }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d?.error ?? 'Could not hide neighborhood'); return }
      setNeighborhoods(prev => prev.filter(x => x.slug !== n.slug))
      setEditingSlug(null)
      toast.success(`${n.name} hidden — ${d.total} active remain`)
    } finally { setSavingAttrs(false) }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Neighborhoods</h1>
        <p className="text-zinc-500 text-sm mt-1">Edit guides, tips, and banner images for each neighborhood.</p>
      </div>

      {/* Stats — 2-up on phones so the text-2xl figures don't
          squeeze, 3-up from sm+. "Have banners" takes the orphan
          slot full-width on row 2 to avoid the half-row-stranded
          look. */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: 'Total', value: neighborhoods.length, color: 'text-white' },
            { label: 'Have guides', value: withGuide, color: 'text-amber-400' },
            { label: 'Have banners', value: withImage, color: 'text-emerald-400', span: true as const },
          ].map(s => (
            <div key={s.label} className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ${s.span ? 'col-span-2 sm:col-span-1' : ''}`}>
              <div className="text-xs text-zinc-500 mb-1">{s.label}</div>
              <div className={`text-2xl font-extrabold ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        {cities.length > 1 && (
          <select
            value={citySlug}
            onChange={e => router.replace(`/admin/neighborhoods${e.target.value ? `?city=${encodeURIComponent(e.target.value)}` : ''}`)}
            className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            {cities.map(c => (
              <option key={c.id} value={c.isDefault ? '' : c.slug}>{c.name}</option>
            ))}
          </select>
        )}
        <input
          type="text"
          placeholder="Search neighborhoods..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-48 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
        <div className="flex gap-1.5">
          {(['all', 'with-guide', 'no-guide'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                filter === f
                  ? 'bg-amber-500 text-white'
                  : 'bg-zinc-900 border border-zinc-700 text-zinc-400 hover:text-white'
              }`}
            >
              {f === 'all' ? 'All' : f === 'with-guide' ? 'Has guide' : 'No guide'}
            </button>
          ))}
        </div>
      </div>

      {/* The default city's attributes are hand-authored in code
          (NEIGHBORHOOD_META in lib/neighborhoods.ts) and override the DB at
          render, so offering DB edits here would save cleanly and change
          nothing on the site. Say so instead. */}
      {!citySlug && cities.length > 1 && !loading && (
        <p className="text-xs text-zinc-600 bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2">
          This city&apos;s emoji, vibe, cost and coordinates are hand-authored in code
          (<code className="text-zinc-500">NEIGHBORHOOD_META</code>) and read-only here.
          Attribute editing is available for the other cities via the dropdown.
        </p>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-24 bg-zinc-900 rounded-2xl border border-zinc-800 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(n => (editingSlug === n.slug && attrDraft && editable && n.id) ? (
            // Inline attribute editor — replaces the card while open, spanning
            // the row so six small inputs don't fight one grid cell.
            <div key={n.slug} className="bg-zinc-900 border border-amber-500/40 rounded-2xl p-4 sm:col-span-2 lg:col-span-3">
              <div className="flex items-baseline justify-between gap-2 mb-3">
                <span className="font-semibold text-white text-sm">{n.name}</span>
                <span className="text-[10px] text-zinc-600">/{n.slug}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {([
                  { key: 'emoji', label: 'Emoji',                  placeholder: '📍' },
                  { key: 'area',  label: 'Area group',             placeholder: 'e.g. Coastal' },
                  { key: 'lat',   label: 'Latitude',               placeholder: '38.4192' },
                  { key: 'lng',   label: 'Longitude',              placeholder: '27.1287' },
                ] as const).map(f => (
                  <div key={f.key}>
                    <label className="block text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">{f.label}</label>
                    <input
                      value={attrDraft[f.key]}
                      onChange={e => setAttrDraft(d => d ? { ...d, [f.key]: e.target.value } : d)}
                      placeholder={f.placeholder}
                      inputMode={f.key === 'lat' || f.key === 'lng' ? 'decimal' : undefined}
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                ))}
                <div className="col-span-2 sm:col-span-3">
                  <label className="block text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Vibe</label>
                  <input
                    value={attrDraft.vibe}
                    onChange={e => setAttrDraft(d => d ? { ...d, vibe: e.target.value } : d)}
                    maxLength={200}
                    placeholder="One line on what the neighborhood feels like"
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Cost</label>
                  <select
                    value={attrDraft.cost}
                    onChange={e => setAttrDraft(d => d ? { ...d, cost: Number(e.target.value) } : d)}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value={1}>€ budget</option>
                    <option value={2}>€€ mid</option>
                    <option value={3}>€€€ upscale</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-4">
                <button onClick={() => saveAttrs(n)} disabled={savingAttrs}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-40">
                  {savingAttrs ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditingSlug(null)} disabled={savingAttrs}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-lg transition-colors disabled:opacity-40">
                  Cancel
                </button>
                <button onClick={() => deactivate(n)} disabled={savingAttrs}
                  className="ml-auto text-xs text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-40">
                  Hide neighborhood
                </button>
              </div>
            </div>
          ) : (
            <Link
              key={n.slug}
              href={`/admin/neighborhoods/${n.slug}${citySlug ? `?city=${encodeURIComponent(citySlug)}` : ''}`}
              className="group bg-zinc-900 border border-zinc-800 rounded-2xl p-4 hover:border-amber-500/40 hover:bg-zinc-900/80 transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">{n.meta.emoji}</span>
                  <span className="font-semibold text-white text-sm group-hover:text-amber-400 transition-colors">
                    {n.name}
                  </span>
                </div>
                {/* Area badge — SIDE_COLOR only knows the default city's six
                    sides; other cities' vocab ("North Bay", "Peninsula"…)
                    falls back to the neutral zinc, and '' (city hasn't
                    grouped its neighborhoods) renders no badge at all. */}
                {n.meta.side && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${SIDE_COLOR[n.meta.side] ?? SIDE_COLOR.Emerging}`}>
                    {n.meta.side}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 mb-3 truncate">{n.meta.vibe}</p>
              <div className="flex gap-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  n.hasGuide ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-600'
                }`}>
                  {n.hasGuide ? '✓ Guide' : '· Guide'}
                </span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  n.hasImage ? 'bg-blue-500/10 text-blue-400' : 'bg-zinc-800 text-zinc-600'
                }`}>
                  {n.hasImage ? '✓ Banner' : '· Banner'}
                </span>
                {/* Attribute editor — only where the DB is what renders. The
                    button lives inside the guide-edit Link, so stop the click
                    from navigating. */}
                {editable && n.id && (
                  <button
                    onClick={e => { e.preventDefault(); e.stopPropagation(); startEdit(n) }}
                    className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 hover:text-amber-400 transition-colors"
                  >
                    ✎ Attributes
                  </button>
                )}
              </div>
            </Link>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-3 text-center py-12 text-zinc-500 text-sm">
              No neighborhoods match your filter.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
