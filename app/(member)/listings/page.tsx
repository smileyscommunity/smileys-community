'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { useSearchParams } from 'next/navigation'
import { resolveImageUrl, ISTANBUL_NEIGHBORHOODS } from '@/lib/data'
import { toast } from 'sonner'

const CATEGORIES = [
  { id: 'ALL',      label: 'All',             emoji: '🗂️', activeCls: 'bg-gray-900 text-white border-gray-900'           },
  { id: 'SAVED',    label: 'Saved',           emoji: '❤️', activeCls: 'bg-red-500 text-white border-red-500'             },
  { id: 'ROOMS',    label: 'Rooms',           emoji: '🏠', activeCls: 'bg-blue-500 text-white border-blue-500'           },
  { id: 'JOBS',     label: 'Jobs',            emoji: '💼', activeCls: 'bg-green-500 text-white border-green-500'         },
  { id: 'SERVICES', label: 'Services',        emoji: '🛠️', activeCls: 'bg-orange-500 text-white border-orange-500'       },
  { id: 'BUY_SELL', label: 'Buy & Sell',      emoji: '🛍️', activeCls: 'bg-purple-500 text-white border-purple-500'       },
  { id: 'FREE',     label: 'Free stuff',      emoji: '🎁', activeCls: 'bg-teal-500 text-white border-teal-500'           },
  { id: 'RECO',     label: 'Recommendations', emoji: '⭐', activeCls: 'bg-amber-500 text-white border-amber-500'         },
]

const ALERT_CATS = [
  { id: 'ROOMS',    label: 'Rooms',           emoji: '🏠' },
  { id: 'JOBS',     label: 'Jobs',            emoji: '💼' },
  { id: 'SERVICES', label: 'Services',        emoji: '🛠️' },
  { id: 'BUY_SELL', label: 'Buy & Sell',      emoji: '🛍️' },
  { id: 'FREE',     label: 'Free stuff',      emoji: '🎁' },
  { id: 'RECO',     label: 'Recommendations', emoji: '⭐' },
]

const CAT_META: Record<string, { label: string; badge: string; header: string }> = {
  ROOMS:    { label: 'Room',           badge: 'bg-blue-100 text-blue-700',    header: 'from-blue-400 to-blue-500'     },
  JOBS:     { label: 'Job',            badge: 'bg-green-100 text-green-700',  header: 'from-green-400 to-green-500'   },
  SERVICES: { label: 'Service',        badge: 'bg-orange-100 text-orange-700',header: 'from-orange-400 to-orange-500' },
  BUY_SELL: { label: 'Buy / Sell',     badge: 'bg-purple-100 text-purple-700',header: 'from-purple-400 to-purple-500' },
  FREE:     { label: 'Free',           badge: 'bg-teal-100 text-teal-700',    header: 'from-teal-400 to-teal-500'     },
  RECO:     { label: 'Recommendation', badge: 'bg-amber-100 text-amber-700',  header: 'from-amber-400 to-amber-500'   },
}

const CAT_EMOJI: Record<string, string> = {
  ROOMS: '🏠', JOBS: '💼', SERVICES: '🛠️', BUY_SELL: '🛍️', FREE: '🎁', RECO: '⭐',
}

interface Listing {
  id: string
  category: string
  title: string
  description: string
  price: string | null
  photo: string | null
  contact: string | null
  neighborhood: string | null
  status: string
  expiresAt: string
  createdAt: string
  user: { id: string; name: string; color: string; profilePhoto: string | null }
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return d === 1 ? '1 day ago' : `${d} days ago`
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function shareUrl(id: string) {
  return `${window.location.origin}/app/listings/${id}`
}

async function copyShare(id: string): Promise<boolean> {
  const url = shareUrl(id)
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    prompt('Copy this link:', url)
    return false
  }
}

function ListingModal({ listing, currentUserId, isSaved, onToggleSave, onClose, onDelete, onMarkFilled, onRenew }: {
  listing: Listing
  currentUserId: string
  isSaved: boolean
  onToggleSave: (id: string) => void
  onClose: () => void
  onDelete: (id: string) => void
  onMarkFilled: (id: string) => void
  onRenew: (id: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const isOwner  = listing.user.id === currentUserId
  const photo    = resolveImageUrl(listing.photo)
  const avatar   = resolveImageUrl(listing.user.profilePhoto)
  const cat      = CAT_META[listing.category]
  const emoji    = CAT_EMOJI[listing.category] ?? '📌'
  const daysLeft = Math.ceil((new Date(listing.expiresAt).getTime() - Date.now()) / 86400000)

  async function handleShare() {
    const ok = await copyShare(listing.id)
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000) }
    else toast.success('Link copied!')
  }

  const waHref = listing.contact
    ? (listing.contact.startsWith('http')
        ? listing.contact
        : `https://wa.me/${listing.contact.replace(/\D/g, '')}`)
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Photo or gradient header */}
        {photo ? (
          <div style={{ position: 'relative', height: '220px', flexShrink: 0, backgroundColor: '#f3f4f6' }}>
            <img src={photo} alt={listing.title} style={{ width: '100%', height: '220px', objectFit: 'cover', display: 'block' }} />
            <div style={{ position: 'absolute', top: '12px', right: '12px' }} className="flex items-center gap-2">
              <button onClick={() => onToggleSave(listing.id)} className={`w-8 h-8 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors ${isSaved ? 'bg-red-500 text-white' : 'bg-black/30 text-white hover:bg-black/50'}`} title={isSaved ? 'Unsave' : 'Save'}>
                <svg className="w-4 h-4" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </button>
              <button onClick={handleShare} className="w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/50 transition-colors" title="Copy link">
                {copied ? '✓' : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                )}
              </button>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/50 transition-colors">✕</button>
            </div>
          </div>
        ) : (
          <div className={`relative h-28 shrink-0 bg-gradient-to-br ${cat?.header ?? 'from-amber-400 to-amber-500'} flex items-center justify-center`}>
            <span className="text-6xl opacity-70 select-none">{emoji}</span>
            <div className="absolute top-3 right-3 flex items-center gap-2">
              <button onClick={() => onToggleSave(listing.id)} className={`w-8 h-8 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors ${isSaved ? 'bg-red-500 text-white' : 'bg-black/20 text-white hover:bg-black/40'}`} title={isSaved ? 'Unsave' : 'Save'}>
                <svg className="w-4 h-4" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </button>
              <button onClick={handleShare} className="w-8 h-8 rounded-full bg-black/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/40 transition-colors" title="Copy link">
                {copied ? '✓' : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                )}
              </button>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-black/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/40 transition-colors">✕</button>
            </div>
          </div>
        )}

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {cat && <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${cat.badge}`}>{cat.label}</span>}
            {listing.neighborhood && (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">📍 {listing.neighborhood}</span>
            )}
            {listing.price && <span className="text-sm font-bold text-gray-900 bg-gray-100 px-2.5 py-1 rounded-full">{listing.price}</span>}
            <span className="text-xs text-gray-400 ml-auto">{timeAgo(listing.createdAt)}</span>
          </div>
          <h2 className="text-lg font-extrabold text-gray-900 leading-snug">{listing.title}</h2>
          <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{listing.description}</p>
          <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
            {avatar
              ? <img src={avatar} alt={listing.user.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
              : <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ backgroundColor: listing.user.color || '#f59e0b' }}>{listing.user.name[0]}</div>
            }
            <div>
              <p className="text-sm font-semibold text-gray-900">{listing.user.name}</p>
              <p className="text-xs text-gray-400">Posted {timeAgo(listing.createdAt)}</p>
            </div>
            {isOwner && <span className="ml-auto text-xs text-gray-400">Your listing</span>}
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-gray-100 space-y-2 shrink-0">
          {waHref && (
            <a href={waHref} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full py-3 bg-[#25D366] hover:bg-[#1ebe5d] text-white text-sm font-bold rounded-2xl transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.134.558 4.133 1.534 5.864L.057 23.57a.5.5 0 00.612.612l5.706-1.477A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.794 9.794 0 01-5.002-1.374l-.358-.213-3.724.964.991-3.621-.234-.373A9.79 9.79 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/>
              </svg>
              Contact on WhatsApp
            </a>
          )}
          {isOwner && (
            <div className="flex gap-2">
              {daysLeft <= 7
                ? <button onClick={() => { onRenew(listing.id); onClose() }} className="flex-1 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white py-2.5 rounded-xl transition-colors">Renew listing</button>
                : <button onClick={() => { onMarkFilled(listing.id); onClose() }} className="flex-1 text-sm font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-xl transition-colors">Mark as done</button>
              }
              <button onClick={() => { onDelete(listing.id); onClose() }} className="text-sm font-semibold text-red-500 hover:text-red-600 hover:bg-red-50 px-4 py-2.5 rounded-xl transition-colors">Delete</button>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

function ListingCard({ listing, onClick, isSaved, onToggleSave }: {
  listing: Listing
  onClick: () => void
  isSaved: boolean
  onToggleSave: (id: string) => void
}) {
  const photo = resolveImageUrl(listing.photo)
  const avatar = resolveImageUrl(listing.user.profilePhoto)
  const cat   = CAT_META[listing.category]
  const emoji = CAT_EMOJI[listing.category] ?? '📌'

  return (
    <button onClick={onClick} className="text-left bg-white rounded-2xl shadow-sm border border-gray-100 group hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 w-full" style={{ overflow: 'hidden', display: 'block' }}>

      {/* Visual header */}
      {photo ? (
        <div style={{ width: '100%', backgroundColor: '#f3f4f6', position: 'relative', overflow: 'hidden', lineHeight: 0 }}>
          <img
            src={photo}
            alt={listing.title}
            style={{ width: '100%', height: '200px', display: 'block', objectFit: 'cover' }}
          />
          <div style={{ position: 'absolute', top: '12px', left: '12px' }} className="flex items-center gap-1.5 flex-wrap">
            {cat && (
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${cat.badge}`}>
                {cat.label}
              </span>
            )}
            {listing.price && (
              <span className="text-xs font-bold bg-white/95 text-gray-900 px-2.5 py-1 rounded-full shadow-sm">
                {listing.price}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className={`relative bg-gradient-to-br ${cat?.header ?? 'from-amber-400 to-amber-500'} flex items-center justify-center overflow-hidden`} style={{ height: '180px' }}>
          <span className="text-7xl opacity-60 select-none">{emoji}</span>
          <div className="absolute inset-0 bg-black/5" />
          <div className="absolute top-3 left-3 flex items-center gap-1.5">
            {cat && (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-white/25 text-white backdrop-blur-sm">
                {cat.label}
              </span>
            )}
            {listing.price && (
              <span className="text-xs font-bold bg-white/95 text-gray-900 px-2.5 py-1 rounded-full shadow-sm">
                {listing.price}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="p-4 flex flex-col gap-2.5">
        <h3 className="font-bold text-gray-900 text-sm leading-snug line-clamp-2 group-hover:text-amber-600 transition-colors">{listing.title}</h3>
        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{listing.description}</p>
        {listing.neighborhood && (
          <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 self-start px-2 py-0.5 rounded-full">
            📍 {listing.neighborhood}
          </p>
        )}

        <div className="flex items-center gap-2 pt-2 border-t border-gray-50">
          {avatar ? (
            <img src={avatar} alt={listing.user.name} className="w-6 h-6 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
              style={{ backgroundColor: listing.user.color || '#f59e0b' }}>
              {listing.user.name[0]}
            </div>
          )}
          <p className="text-[11px] text-gray-500 truncate flex-1">{listing.user.name}</p>
          <button
            onClick={async e => {
              e.stopPropagation()
              onToggleSave(listing.id)
            }}
            className={`p-1 transition-colors shrink-0 ${isSaved ? 'text-red-500' : 'text-gray-300 hover:text-red-400'}`}
            title={isSaved ? 'Unsave' : 'Save'}>
            <svg className="w-3.5 h-3.5" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </button>
          <button
            onClick={async e => {
              e.stopPropagation()
              const ok = await copyShare(listing.id)
              if (ok) toast.success('Link copied!')
            }}
            className="p-1 text-gray-300 hover:text-amber-500 transition-colors shrink-0"
            title="Copy link">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </button>
        </div>
      </div>
    </button>
  )
}

function ListingsInner() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const [category, setCategory] = useState('ALL')
  const [neighborhood, setNeighborhood] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [listings, setListings] = useState<Listing[]>([])
  const [total, setTotal]       = useState(0)
  const [hasMore, setHasMore]   = useState(false)
  const [loading, setLoading]   = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<Listing | null>(null)
  const [savedSet, setSavedSet] = useState<Set<string>>(new Set())
  const [alertCategories, setAlertCategories] = useState<string[]>([])
  const [showAlertMenu, setShowAlertMenu] = useState(false)
  const alertMenuRef = useRef<HTMLDivElement>(null)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Close alert menu on outside click
  useEffect(() => {
    if (!showAlertMenu) return
    function close(e: MouseEvent) {
      if (alertMenuRef.current && !alertMenuRef.current.contains(e.target as Node)) {
        setShowAlertMenu(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [showAlertMenu])

  // Load alert preferences once
  useEffect(() => {
    fetch('/app/api/me/listing-alerts', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setAlertCategories(d.listingAlerts ?? []))
      .catch(() => {})
  }, [])

  const fetchListings = useCallback(async (cat: string, nbhd: string, q: string, offset: number, append = false) => {
    const params = new URLSearchParams({ offset: String(offset) })
    if (cat === 'SAVED') {
      params.set('saved', 'true')
    } else if (cat !== 'ALL') {
      params.set('category', cat)
    }
    if (nbhd) params.set('neighborhood', nbhd)
    if (q) params.set('q', q)
    const res  = await fetch(`/app/api/listings?${params}`, { credentials: 'include' })
    const data = await res.json()
    setListings(prev => append ? [...prev, ...data.listings] : data.listings)
    setSavedSet(prev => {
      const next = new Set(append ? prev : [])
      for (const id of (data.savedIds ?? [])) next.add(id)
      return next
    })
    setTotal(data.total)
    setHasMore(data.hasMore)
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchListings(category, neighborhood, debouncedSearch, 0).finally(() => setLoading(false))
  }, [category, neighborhood, debouncedSearch, fetchListings])

  // Auto-open listing from ?l= legacy share link
  const deepLinkId = searchParams.get('l')
  useEffect(() => {
    if (!deepLinkId) return
    fetch(`/app/api/listings/${deepLinkId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.id) setSelected(data) })
      .catch(() => {})
  }, [deepLinkId])

  async function loadMore() {
    setLoadingMore(true)
    await fetchListings(category, neighborhood, debouncedSearch, listings.length, true)
    setLoadingMore(false)
  }

  async function toggleSave(listingId: string) {
    const wasSaved = savedSet.has(listingId)
    setSavedSet(prev => {
      const next = new Set(prev)
      wasSaved ? next.delete(listingId) : next.add(listingId)
      return next
    })
    if (category === 'SAVED' && wasSaved) {
      setListings(prev => prev.filter(l => l.id !== listingId))
      setTotal(t => t - 1)
    }
    try {
      const res = await fetch(`/app/api/listings/${listingId}/save`, { method: 'POST', credentials: 'include' })
      if (!res.ok) throw new Error()
      toast.success(wasSaved ? 'Removed from saved' : 'Saved!')
    } catch {
      setSavedSet(prev => {
        const next = new Set(prev)
        wasSaved ? next.add(listingId) : next.delete(listingId)
        return next
      })
    }
  }

  async function toggleAlert(catId: string) {
    const next = alertCategories.includes(catId)
      ? alertCategories.filter(c => c !== catId)
      : [...alertCategories, catId]
    setAlertCategories(next)
    try {
      await fetch('/app/api/me/listing-alerts', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingAlerts: next }),
      })
    } catch {
      setAlertCategories(alertCategories)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this listing?')) return
    await fetch(`/app/api/listings/${id}`, { method: 'DELETE', credentials: 'include' })
    setListings(prev => prev.filter(l => l.id !== id))
    setTotal(t => t - 1)
  }

  async function handleMarkFilled(id: string) {
    const res = await fetch(`/app/api/listings/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'filled' }),
    })
    if (res.ok) {
      setListings(prev => prev.filter(l => l.id !== id))
      setTotal(t => t - 1)
    }
  }

  async function handleRenew(id: string) {
    const res = await fetch(`/app/api/listings/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ renew: true }),
    })
    if (res.ok) {
      const updated = await res.json()
      setListings(prev => prev.map(l => l.id === id ? { ...l, expiresAt: updated.expiresAt } : l))
    }
  }

  const activeCat = CATEGORIES.find(c => c.id === category)

  return (
    <div className="min-h-screen bg-warm pb-24 md:pb-0">
      {selected && (
        <ListingModal
          listing={selected}
          currentUserId={user?.id ?? ''}
          isSaved={savedSet.has(selected.id)}
          onToggleSave={toggleSave}
          onClose={() => setSelected(null)}
          onDelete={id => { handleDelete(id); setSelected(null) }}
          onMarkFilled={id => { handleMarkFilled(id); setSelected(null) }}
          onRenew={handleRenew}
        />
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-5">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-3 py-1.5 mb-4">
                Members only
              </span>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">Community Board</h1>
              <p className="text-base text-gray-500 mt-2 max-w-xl">
                Rooms, jobs, services & more — posted by Smileys members for Smileys members.
              </p>
            </div>
            <Link
              href="/listings/new"
              className="hidden sm:flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors shrink-0 shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Post a listing
            </Link>
          </div>

          {/* Search bar */}
          <div className="relative mb-4">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search listings…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            )}
          </div>

          {/* Category pills + alerts bell */}
          <div className="flex items-center gap-2">
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 flex-1 min-w-0">
              {CATEGORIES.map(cat => {
                const isActive = category === cat.id
                return (
                  <button
                    key={cat.id}
                    onClick={() => setCategory(cat.id)}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap transition-all ${
                      isActive
                        ? cat.activeCls
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <span>{cat.emoji}</span>
                    {cat.label}
                    {cat.id === 'ALL' && !loading && !debouncedSearch && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20' : 'bg-gray-100 text-gray-400'}`}>
                        {total}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Neighborhood filter */}
            <select
              value={neighborhood}
              onChange={e => setNeighborhood(e.target.value)}
              className={`shrink-0 text-xs font-semibold px-3 py-2 rounded-full border whitespace-nowrap transition-colors ${
                neighborhood
                  ? 'bg-amber-50 border-amber-300 text-amber-700'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
              title="Filter by neighborhood"
            >
              <option value="">📍 All areas</option>
              {ISTANBUL_NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>

            {/* Alert bell */}
            <div className="relative shrink-0" ref={alertMenuRef}>
              <button
                onClick={() => setShowAlertMenu(v => !v)}
                className={`relative flex items-center justify-center w-9 h-9 rounded-full border transition-all ${
                  alertCategories.length > 0
                    ? 'bg-amber-500 border-amber-500 text-white'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                }`}
                title="Listing alerts"
              >
                <svg className="w-4 h-4" fill={alertCategories.length > 0 ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {alertCategories.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {alertCategories.length}
                  </span>
                )}
              </button>

              {showAlertMenu && (
                <div className="absolute right-0 top-full mt-2 bg-white rounded-2xl shadow-xl border border-gray-100 p-4 z-20 w-60">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Email me when new…</p>
                  <div className="space-y-1">
                    {ALERT_CATS.map(cat => (
                      <label key={cat.id} className="flex items-center gap-3 py-1.5 cursor-pointer group">
                        <div
                          onClick={() => toggleAlert(cat.id)}
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                            alertCategories.includes(cat.id)
                              ? 'bg-amber-500 border-amber-500'
                              : 'border-gray-300 group-hover:border-amber-400'
                          }`}
                        >
                          {alertCategories.includes(cat.id) && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <span onClick={() => toggleAlert(cat.id)} className="text-sm text-gray-700 select-none">{cat.emoji} {cat.label}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-3 leading-relaxed">You'll get one email per new listing that matches.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Mobile post button */}
        <div className="sm:hidden mb-6">
          <Link
            href="/listings/new"
            className="flex items-center justify-center gap-2 w-full py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Post a listing
          </Link>
        </div>

        {/* Active filter label */}
        {!loading && listings.length > 0 && (
          <p className="text-sm text-gray-500 mb-5">
            {debouncedSearch
              ? <><strong className="text-gray-900 font-bold">{total}</strong> result{total !== 1 ? 's' : ''} for &ldquo;{debouncedSearch}&rdquo;</>
              : <><strong className="text-gray-900 font-bold">{total}</strong>{' '}
                  {category === 'ALL' ? 'active listing' : category === 'SAVED' ? 'saved listing' : activeCat?.label.toLowerCase() + ' listing'}{total !== 1 ? 's' : ''}</>
            }
          </p>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl overflow-hidden border border-gray-100">
                <div className="h-28 bg-gray-100 animate-pulse" />
                <div className="p-4 space-y-3">
                  <div className="h-4 bg-gray-100 animate-pulse rounded-lg w-3/4" />
                  <div className="h-3 bg-gray-100 animate-pulse rounded-lg" />
                  <div className="h-3 bg-gray-100 animate-pulse rounded-lg w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : listings.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-6xl mb-4">
              {debouncedSearch ? '🔍' : category === 'SAVED' ? '❤️' : activeCat?.emoji ?? '📋'}
            </div>
            <p className="text-xl font-bold text-gray-700">
              {debouncedSearch
                ? `No results for "${debouncedSearch}"`
                : category === 'SAVED'
                ? 'No saved listings yet'
                : category === 'ALL' ? 'No listings yet' : `No ${activeCat?.label.toLowerCase()} listings`}
            </p>
            <p className="text-sm text-gray-400 mt-2 mb-8">
              {debouncedSearch
                ? 'Try a different search term'
                : category === 'SAVED'
                ? 'Tap the heart on any listing to save it for later'
                : category === 'ALL'
                ? 'Be the first to post something for the community'
                : `Switch to All to see everything, or post a ${activeCat?.label.toLowerCase()} listing`}
            </p>
            {category !== 'SAVED' && !debouncedSearch && (
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <Link
                  href="/listings/new"
                  className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold px-6 py-3 rounded-xl transition-colors shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Post a listing
                </Link>
                {category !== 'ALL' && (
                  <button
                    onClick={() => setCategory('ALL')}
                    className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-600 text-sm font-semibold px-6 py-3 rounded-xl hover:border-gray-300 transition-colors"
                  >
                    View all listings
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {listings.map(l => (
                <ListingCard
                  key={l.id}
                  listing={l}
                  onClick={() => setSelected(l)}
                  isSaved={savedSet.has(l.id)}
                  onToggleSave={toggleSave}
                />
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center mt-10">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-8 py-3 rounded-2xl bg-white border-2 border-gray-200 text-gray-600 font-semibold text-sm hover:border-amber-400 hover:text-amber-600 transition-colors disabled:opacity-50"
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function ListingsPage() {
  return (
    <Suspense>
      <ListingsInner />
    </Suspense>
  )
}
