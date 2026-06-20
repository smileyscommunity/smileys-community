'use client'

// Personal "starred" list. Members hit /directory/saved from a chip on
// the directory toolbar. Renders a simplified version of the directory
// card focused on the things you save a business for — name, what it
// is, where, the rating, and a quick "open it on the main directory
// or unsave" pair of actions.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { resolveImageUrl } from '@/lib/data'

interface SavedBusiness {
  id: string
  name: string
  category: string
  description: string
  neighborhood: string | null
  website: string | null
  instagram: string | null
  logo: string | null
  coverImage: string | null
  isExpatOwned: boolean
  isExpatFriendly: boolean
  memberDiscount: string | null
  tags: string[]
  avgRating: number | null
  reviewCount: number
  saveCount: number
  addedBy: string
}

export default function SavedDirectoryPage() {
  const router = useRouter()
  const { isLoggedIn, isLoading } = useAuth()
  const [items, setItems] = useState<SavedBusiness[]>([])
  const [loading, setLoading] = useState(true)

  // Same client-side auth gate the /(member)/ layout uses — but the
  // saved view lives at /directory/saved so we wire it locally.
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login?next=' + encodeURIComponent('/directory/saved'))
  }, [isLoading, isLoggedIn, router])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/app/api/directory/saved', { credentials: 'include' })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        toast.error(d?.error || `Couldn't load saved (HTTP ${r.status})`)
        setItems([])
        return
      }
      const d = await r.json()
      setItems(Array.isArray(d) ? d : [])
    } catch {
      toast.error('Network error — could not load saved')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (isLoggedIn) load() }, [isLoggedIn, load])

  async function unsave(id: string) {
    // Optimistic remove.
    const prev = items
    setItems(s => s.filter(b => b.id !== id))
    try {
      const r = await fetch(`/app/api/directory/${id}/save`, {
        method: 'POST', credentials: 'include',
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        toast.error(d?.error || 'Failed to unsave')
        setItems(prev)
        return
      }
    } catch {
      toast.error('Network error')
      setItems(prev)
    }
  }

  if (isLoading || !isLoggedIn) return null

  return (
    <div className="min-h-screen bg-warm pb-20 md:pb-0">
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-6">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            <div className="flex-1">
              <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">Your list</span>
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">★ Saved businesses</h1>
              {!loading && (
                <p className="text-sm text-gray-600 mt-1">
                  {items.length} {items.length === 1 ? 'place' : 'places'} you starred for later
                </p>
              )}
            </div>
            <Link
              href="/directory"
              className="shrink-0 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors"
            >
              ← Back to directory
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl shadow-sm overflow-hidden animate-pulse h-72" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 max-w-xs mx-auto">
            <div className="text-6xl mb-4">★</div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Nothing saved yet</h3>
            <p className="text-sm text-gray-600 mb-6">
              Tap the star on any business in the directory to add it here.
            </p>
            <Link href="/directory"
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors">
              Browse the directory
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map(b => {
              const cover = resolveImageUrl(b.coverImage)
              const logo  = resolveImageUrl(b.logo)
              return (
                <div key={b.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
                  <div className="relative w-full aspect-[4/3] bg-gray-100">
                    {cover ? (
                      <img src={cover} alt={b.name} loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl text-gray-300">🏢</div>
                    )}
                    <div className="absolute top-2 left-2 flex flex-col gap-1">
                      {b.isExpatOwned    && <span className="bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-tight">Expat-owned</span>}
                      {b.isExpatFriendly && <span className="bg-teal-500  text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-tight">Expat-friendly</span>}
                      {b.memberDiscount  && <span className="bg-fuchsia-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-tight max-w-[140px] truncate">💸 {b.memberDiscount}</span>}
                    </div>
                    {logo && (
                      <div className="absolute bottom-2 right-2 w-9 h-9 rounded-xl overflow-hidden border-2 border-white shadow-sm bg-white">
                        <img src={logo} alt={b.name} className="w-full h-full object-cover" />
                      </div>
                    )}
                  </div>
                  <div className="p-3 flex flex-col gap-2 flex-1">
                    <div>
                      <p className="font-bold text-gray-900 text-sm leading-tight truncate">{b.name}</p>
                      <p className="text-[11px] text-gray-400 truncate mt-0.5">{b.category}{b.neighborhood ? ` · ${b.neighborhood}` : ''}</p>
                      {b.avgRating != null && (
                        <p className="text-[11px] mt-1">
                          <span className="text-amber-500">★</span>{' '}
                          <span className="font-bold text-gray-900">{b.avgRating.toFixed(1)}</span>{' '}
                          <span className="text-gray-400">· {b.reviewCount} review{b.reviewCount === 1 ? '' : 's'}</span>
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-gray-600 line-clamp-2 flex-1">{b.description}</p>
                    {b.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {b.tags.slice(0, 3).map(t => (
                          <span key={t} className="text-[10px] font-semibold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{t}</span>
                        ))}
                      </div>
                    )}
                    {/* Same simplification as the main /directory card —
                        contact links (Website / IG / Call) live on the
                        detail page only. Saved cards now offer just
                        the two actions that matter on this surface:
                        open the detail page or unsave. */}
                    <div className="flex gap-1.5 pt-2 border-t border-gray-50 mt-auto">
                      <Link
                        href={`/directory/${b.id}`}
                        className="flex-1 text-center text-[10px] font-semibold text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 rounded-lg py-1.5 transition-colors"
                      >
                        View details →
                      </Link>
                      <button
                        onClick={() => unsave(b.id)}
                        className="text-[10px] font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg py-1.5 px-2 transition-colors"
                      >
                        Unsave
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
