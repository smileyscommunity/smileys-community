'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'

interface NeighborhoodEntry {
  name: string
  slug: string
  meta: { emoji: string; vibe: string; side: string }
  hasGuide: boolean
  hasImage: boolean
}

const SIDE_COLOR: Record<string, string> = {
  Central:  'bg-amber-500/10 text-amber-400 border-amber-500/20',
  European: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Asian:    'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  Coastal:  'bg-sky-500/10 text-sky-400 border-sky-500/20',
  Islands:  'bg-purple-500/10 text-purple-400 border-purple-500/20',
  Emerging: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
}

export default function AdminNeighborhoodsPage() {
  const [neighborhoods, setNeighborhoods] = useState<NeighborhoodEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'with-guide' | 'no-guide'>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/app/api/admin/neighborhoods', { credentials: 'include' })
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
  }, [])

  const filtered = neighborhoods.filter(n => {
    if (filter === 'with-guide' && !n.hasGuide) return false
    if (filter === 'no-guide' && n.hasGuide) return false
    if (search && !n.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const withGuide = neighborhoods.filter(n => n.hasGuide).length
  const withImage = neighborhoods.filter(n => n.hasImage).length

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

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-24 bg-zinc-900 rounded-2xl border border-zinc-800 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(n => (
            <Link
              key={n.slug}
              href={`/admin/neighborhoods/${n.slug}`}
              className="group bg-zinc-900 border border-zinc-800 rounded-2xl p-4 hover:border-amber-500/40 hover:bg-zinc-900/80 transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">{n.meta.emoji}</span>
                  <span className="font-semibold text-white text-sm group-hover:text-amber-400 transition-colors">
                    {n.name}
                  </span>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${SIDE_COLOR[n.meta.side] ?? SIDE_COLOR.Emerging}`}>
                  {n.meta.side}
                </span>
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
