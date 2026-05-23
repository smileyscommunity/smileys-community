'use client'

import { useState, useEffect } from 'react'
import { resolveImageUrl } from '@/lib/data'

interface Partner {
  id: string
  name: string
  category: string
  discount: string
  address: string
  neighborhood: string
  logo: string | null
  coverImage: string | null
  website: string | null
  instagram: string | null
  isActive: boolean
}

function PartnerCard({ p }: { p: Partner }) {
  const logo  = resolveImageUrl(p.logo)
  const cover = resolveImageUrl(p.coverImage)

  return (
    <div className="bg-white rounded-2xl shadow-card overflow-hidden flex flex-col">
      {/* Cover */}
      <div className="relative h-32 bg-gradient-to-br from-amber-100 to-amber-50">
        {cover ? (
          <img src={cover} alt={p.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl opacity-20">🏪</div>
        )}
        {/* Discount badge */}
        <div className="absolute top-3 right-3 bg-amber-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow">
          {p.discount}
        </div>
      </div>

      {/* Logo + info */}
      <div className="p-4 flex-1 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {logo ? (
            <img src={logo} alt={p.name} className="w-12 h-12 rounded-xl object-cover shrink-0 border border-gray-100" />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-xl shrink-0">
              🏪
            </div>
          )}
          <div className="min-w-0">
            <p className="font-bold text-gray-900 truncate">{p.name}</p>
            <p className="text-xs text-gray-400 truncate">{p.category} · {p.neighborhood}</p>
          </div>
        </div>

        <p className="text-xs text-gray-500 truncate">📍 {p.address}</p>

        {/* Links */}
        <div className="flex gap-2 mt-auto">
          {p.website && (
            <a href={p.website} target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded-xl text-xs font-semibold text-gray-700 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Website
            </a>
          )}
          {p.instagram && (
            <a href={`https://instagram.com/${p.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-pink-50 hover:bg-pink-100 rounded-xl text-xs font-semibold text-pink-600 transition-colors">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
              </svg>
              Instagram
            </a>
          )}
          {!p.website && !p.instagram && (
            <span className="text-xs text-gray-300 italic">No links yet</span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PerksPage() {
  const [partners,  setPartners]  = useState<Partner[]>([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [category,  setCategory]  = useState('All')

  useEffect(() => {
    fetch('/app/api/partners', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setPartners(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false))
  }, [])

  const categories = ['All', ...Array.from(new Set(partners.map(p => p.category))).sort()]

  const visible = partners.filter(p => {
    if (category !== 'All' && p.category !== category) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return p.name.toLowerCase().includes(q) ||
        p.neighborhood.toLowerCase().includes(q) ||
        p.discount.toLowerCase().includes(q)
    }
    return true
  })

  return (
    <div className="min-h-screen bg-warm pb-24 md:pb-0">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-10 pb-0">
          <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">Member Perks</span>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">Local Perks</h1>
          <p className="text-base text-gray-500 mt-1 mb-5">Exclusive discounts at local businesses — just show your Smileys profile.</p>

          <div className="flex gap-3 mb-0">
            <div className="relative flex-1 max-w-sm">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or area…"
                className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
              />
            </div>
          </div>

          {/* Category tabs */}
          <div className="flex gap-1 mt-4 overflow-x-auto pb-0">
            {categories.map(c => (
              <button key={c} onClick={() => setCategory(c)}
                className={`px-4 py-2.5 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
                  category === c ? 'border-amber-500 text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl shadow-card overflow-hidden animate-pulse">
                <div className="h-32 bg-gray-200" />
                <div className="p-4 space-y-3">
                  <div className="flex gap-3">
                    <div className="w-12 h-12 rounded-xl bg-gray-200 shrink-0" />
                    <div className="flex-1 space-y-2 pt-1">
                      <div className="h-4 bg-gray-200 rounded w-2/3" />
                      <div className="h-3 bg-gray-100 rounded w-1/2" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-20">
            <span className="text-5xl block mb-4">🏪</span>
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              {partners.length === 0 ? 'No partners yet' : 'No results'}
            </h3>
            <p className="text-sm text-gray-500">
              {partners.length === 0
                ? 'Check back soon — we\'re adding local businesses.'
                : 'Try a different search or category.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {visible.map(p => <PartnerCard key={p.id} p={p} />)}
          </div>
        )}
      </div>
    </div>
  )
}
