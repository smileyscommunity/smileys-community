'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { resolveImageUrl } from '@/lib/data'
import { isSafeHref } from '@/lib/safeUrl'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import EmptyState from '@/components/EmptyState'
import { SkeletonCard } from '@/components/Skeleton'

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

// Rendered links only when they are what they claim to be. The admin form
// validates both now, but rows saved before that pass through untouched —
// an "instagram.com/foo" website became a relative link into the app.
const websiteHref   = (w: string | null) => (w && w.startsWith('https://') && isSafeHref(w) ? w : null)
const instagramUser = (h: string | null) => {
  const u = (h ?? '').trim().replace(/^@/, '')
  return /^[A-Za-z0-9._]{1,30}$/.test(u) ? u : null
}

function PartnerCard({ p }: { p: Partner }) {
  const logo  = resolveImageUrl(p.logo)
  const cover = resolveImageUrl(p.coverImage)
  const site  = websiteHref(p.website)
  const insta = instagramUser(p.instagram)

  return (
    <div className="bg-white rounded-2xl shadow-card overflow-hidden flex flex-col">
      {/* Cover — decorative; the name is in the card below. */}
      <div className="relative h-32 bg-gradient-to-br from-amber-100 to-amber-50">
        {cover ? (
          <img src={cover} alt="" className="w-full h-full object-cover" />
        ) : (
          <div aria-hidden="true" className="w-full h-full flex items-center justify-center text-4xl opacity-20">🏪</div>
        )}
        {/* Discount badge — dark text on the amber (white read at ~2:1). */}
        <div className="absolute top-3 right-3 bg-amber-500 text-amber-950 text-xs font-bold px-2.5 py-1 rounded-full shadow">
          {p.discount}
        </div>
      </div>

      {/* Logo + info */}
      <div className="p-4 flex-1 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {logo ? (
            <img src={logo} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0 border border-gray-100" />
          ) : (
            <div aria-hidden="true" className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-xl shrink-0">
              🏪
            </div>
          )}
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900 truncate">{p.name}</h2>
            <p className="text-xs text-gray-500 truncate">{p.category} · {p.neighborhood}</p>
          </div>
        </div>

        <p className="text-xs text-gray-600 truncate"><span aria-hidden="true">📍 </span>{p.address}</p>

        {/* Links */}
        <div className="flex gap-2 mt-auto">
          {site && (
            <a href={site} target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded-xl text-xs font-semibold text-gray-700 transition-colors">
              <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Website<span className="sr-only"> of {p.name}</span>
            </a>
          )}
          {insta && (
            <a href={`https://instagram.com/${insta}`} target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-pink-50 hover:bg-pink-100 rounded-xl text-xs font-semibold text-pink-700 transition-colors">
              <svg aria-hidden="true" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
              </svg>
              Instagram<span className="sr-only"> of {p.name}</span>
            </a>
          )}
          {!site && !insta && (
            <span className="text-xs text-gray-500 italic">No links yet</span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PerksPage() {
  const city = useCurrentCity()
  const [partners,  setPartners]  = useState<Partner[]>([])
  const [loading,   setLoading]   = useState(true)
  const [failed,    setFailed]    = useState(false)
  const [search,    setSearch]    = useState('')
  const [category,  setCategory]  = useState('All')

  // A failed load (401, 500, offline) read as "No partners yet". It's an
  // error with a retry now.
  const load = useCallback(() => {
    setLoading(true); setFailed(false)
    fetch('/app/api/partners', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => setPartners(Array.isArray(d) ? d : []))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const categories = ['All', ...Array.from(new Set(partners.map(p => p.category))).sort()]

  // Everything a card shows can be searched for, and nothing it doesn't.
  const visible = partners.filter(p => {
    if (category !== 'All' && p.category !== category) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [p.name, p.neighborhood, p.category, p.discount, p.address].some(f => f.toLowerCase().includes(q))
  })

  // Suggest a place: the contact form's partnership topic, carrying the city.
  const suggestHref = `/contact?topic=partnership${city?.slug ? `&city=${city.slug}` : ''}`

  return (
    <div className="min-h-screen bg-warm pb-24 md:pb-0">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-10 pb-0">
          <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">Member Perks</span>
          {/* The city these perks are in — they follow the city you're viewing. */}
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">
            Local Perks{city?.name ? ` in ${city.name}` : ''}
          </h1>
          {/* How to claim: the member card's live pass (app/(member)/card),
              which a business can tell from a screenshot. "Show your
              profile" asked them to trust one. */}
          <p className="text-base text-gray-600 mt-1 mb-5">
            Discounts at local businesses for members. To claim one, open your{' '}
            <Link href="/card" className="font-semibold text-amber-700 hover:underline">member card</Link>{' '}
            and show the live pass at the till.
          </p>

          <div className="flex gap-3 mb-0">
            <div className="relative flex-1 max-w-sm">
              <svg aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <label htmlFor="perks-search" className="sr-only">Search perks</label>
              <input
                id="perks-search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name, area or category…"
                className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
              />
            </div>
          </div>

          {/* Category filter */}
          <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-1 mt-4 pb-0">
            {categories.map(c => (
              <button key={c} onClick={() => setCategory(c)} aria-pressed={category === c}
                className={`px-4 py-2.5 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
                  category === c ? 'border-amber-500 text-amber-700' : 'border-transparent text-gray-600 hover:text-gray-800'
                }`}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[...Array(6)].map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : failed ? (
          <div role="alert" className="bg-white rounded-2xl shadow-card p-8 text-center max-w-md mx-auto">
            <p className="font-bold text-gray-900 mb-1">We couldn&apos;t load the perks</p>
            <p className="text-sm text-gray-600 mb-4">Check your connection and try again.</p>
            <button onClick={load} className="btn-primary text-sm">Try again</button>
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon="🏪"
            title={partners.length === 0 ? `No perks${city?.name ? ` in ${city.name}` : ''} yet` : 'No results'}
            body={partners.length === 0
              ? 'We add a place when it agrees to a real discount for members.'
              : 'Try a different search or category.'}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {visible.map(p => <PartnerCard key={p.id} p={p} />)}
          </div>
        )}

        {!loading && !failed && (
          <p className="text-sm text-gray-600 text-center mt-8">
            Know a place that would offer members a perk?{' '}
            <Link href={suggestHref} className="font-semibold text-amber-700 hover:underline">Tell us about it</Link>
          </p>
        )}
      </div>
    </div>
  )
}
