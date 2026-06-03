'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { resolveImageUrl } from '@/lib/data'
import { BUSINESS_CATEGORIES } from '@/lib/directory'
import { isSafeHref } from '@/lib/safeUrl'

const CATEGORIES = [
  { id: 'all', label: 'All' },
  ...BUSINESS_CATEGORIES.map(c => ({ id: c, label: c })),
]

interface Business {
  id: string
  name: string
  category: string
  description: string
  neighborhood: string | null
  address: string | null
  phone: string | null
  website: string | null
  instagram: string | null
  logo: string | null
  coverImage: string | null
  isExpatOwned: boolean
  isExpatFriendly: boolean
  languages: string | null
  // True when an admin has approved a BusinessClaim — surfaced as a
  // "✓ Verified owner" badge and hides the Claim CTA.
  claimedById: string | null
}

// Claim status mirrors the BusinessClaim.status DB enum plus a
// `none` sentinel for "no claim yet, you can submit one".
type ClaimState = 'loading' | 'none' | 'pending' | 'approved' | 'rejected' | 'owned'

function ClaimWidget({ b, isLoggedIn }: { b: Business; isLoggedIn: boolean }) {
  const [state,   setState]   = useState<ClaimState>('loading')
  const [open,    setOpen]    = useState(false)
  const [message, setMessage] = useState('')
  const [busy,    setBusy]    = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!isLoggedIn) { setState('none'); return }
    if (b.claimedById) { setState('owned'); return }
    fetch(`/app/api/directory/${b.id}/claim`, { credentials: 'include' })
      .then(async r => r.ok ? r.json() : ({ claim: null }))
      .then(d => {
        if (cancelled) return
        const status = d?.claim?.status as string | undefined
        setState(status === 'pending' || status === 'approved' || status === 'rejected' ? status : 'none')
      })
      .catch(() => { if (!cancelled) setState('none') })
    return () => { cancelled = true }
  }, [b.id, b.claimedById, isLoggedIn])

  // Already-verified owner badge replaces the claim button. The owner's
  // identity isn't exposed on the public endpoint, only the existence
  // of an owner, so we can't say WHO claimed it.
  if (b.claimedById) {
    return (
      <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 rounded-lg py-1.5 px-2 flex items-center justify-center gap-1">
        <span>✓</span> Verified owner
      </span>
    )
  }

  if (!isLoggedIn) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent('/directory')}`}
        className="text-[10px] font-semibold text-zinc-600 hover:text-amber-700 bg-gray-50 hover:bg-amber-50 rounded-lg py-1.5 px-2 text-center transition-colors"
      >
        Claim this
      </Link>
    )
  }

  if (state === 'loading') return null

  if (state === 'pending') {
    return <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 rounded-lg py-1.5 px-2 text-center">Claim pending</span>
  }

  async function submit() {
    if (!message.trim()) {
      toast.error('Tell us why you own this business')
      return
    }
    setBusy(true)
    try {
      const r = await fetch(`/app/api/directory/${b.id}/claim`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d?.error || 'Failed to submit claim'); return }
      toast.success('Claim submitted — an admin will review it')
      setOpen(false)
      setMessage('')
      setState('pending')
    } catch {
      toast.error('Network error — not submitted')
    } finally {
      setBusy(false)
    }
  }

  if (open) {
    return (
      <div className="absolute inset-x-2 bottom-2 bg-white border border-gray-200 rounded-xl shadow-lg p-3 z-10">
        <p className="text-xs font-bold text-gray-900 mb-1.5">Claim "{b.name}"</p>
        <p className="text-[10px] text-gray-500 mb-2 leading-tight">
          How are you the owner? An email at the business domain, your name on the lease, or anything verifiable.
        </p>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          rows={3}
          maxLength={1000}
          autoFocus
          placeholder="e.g. I'm the founder; my email is owner@example.com"
          className="w-full text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
        />
        <div className="flex gap-1.5 mt-2">
          <button
            onClick={submit}
            disabled={busy}
            className="flex-1 text-[10px] font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-lg py-1.5 transition-colors disabled:opacity-50"
          >
            {busy ? 'Submitting…' : 'Submit claim'}
          </button>
          <button
            onClick={() => { setOpen(false); setMessage('') }}
            className="text-[10px] font-semibold text-gray-500 hover:text-gray-700 rounded-lg py-1.5 px-2 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  const label = state === 'rejected' ? 'Claim rejected — try again' : 'Claim this business'
  return (
    <button
      onClick={() => setOpen(true)}
      className="text-[10px] font-semibold text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 rounded-lg py-1.5 px-2 text-center transition-colors"
    >
      {label}
    </button>
  )
}

function BusinessCard({ b, isLoggedIn }: { b: Business; isLoggedIn: boolean }) {
  const logo  = resolveImageUrl(b.logo)
  const cover = resolveImageUrl(b.coverImage)

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col hover:-translate-y-0.5 hover:shadow-md hover:border-gray-200 transition-all duration-200 relative">
      {/* Cover */}
      <div className="relative w-full aspect-[4/3] bg-gray-100">
        {cover ? (
          <img src={cover} alt={b.name} loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl text-gray-300">🏢</div>
        )}

        {/* Expat badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {b.isExpatOwned && (
            <span className="bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-tight">Expat-owned</span>
          )}
          {b.isExpatFriendly && (
            <span className="bg-teal-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-tight">Expat-friendly</span>
          )}
        </div>

        {/* Logo */}
        {logo && (
          <div className="absolute bottom-2 right-2 w-9 h-9 rounded-xl overflow-hidden border-2 border-white shadow-sm bg-white">
            <img src={logo} alt={b.name} className="w-full h-full object-cover" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div>
          <p className="font-bold text-gray-900 text-sm leading-tight truncate">{b.name}</p>
          <p className="text-[11px] text-gray-400 truncate mt-0.5">
            {b.category}{b.neighborhood ? ` · ${b.neighborhood}` : ''}
          </p>
        </div>

        <p className="text-xs text-gray-500 line-clamp-2 flex-1">{b.description}</p>

        {b.languages && (
          <p className="text-[10px] text-gray-400">🗣 {b.languages}</p>
        )}

        {/* Links. Each href passes through isSafeHref / the IG handle
            regex so a historical row with an unsanitized javascript:
            URL can't fire — render-time defense-in-depth on top of the
            API-level validation. */}
        <div className="flex gap-1.5 pt-2 border-t border-gray-50 mt-auto">
          {b.website && isSafeHref(b.website) && (
            <a href={b.website} target="_blank" rel="noopener noreferrer nofollow"
              className="flex-1 text-center text-[10px] font-semibold text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg py-1.5 transition-colors">
              Website
            </a>
          )}
          {b.instagram && /^[A-Za-z0-9._]{1,30}$/.test(b.instagram.replace(/^@/, '')) && (
            <a href={`https://instagram.com/${b.instagram.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer nofollow"
              className="flex-1 text-center text-[10px] font-semibold text-pink-600 hover:text-pink-700 bg-pink-50 hover:bg-pink-100 rounded-lg py-1.5 transition-colors">
              Instagram
            </a>
          )}
          {b.phone && /^[+\d\s\-()]{4,40}$/.test(b.phone) && (
            <a href={`tel:${b.phone.replace(/[^\d+]/g, '')}`}
              className="flex-1 text-center text-[10px] font-semibold text-green-600 hover:text-green-700 bg-green-50 hover:bg-green-100 rounded-lg py-1.5 transition-colors">
              Call
            </a>
          )}
          {!b.website && !b.instagram && !b.phone && (
            <span className="text-[10px] text-gray-300 italic flex-1">No links</span>
          )}
        </div>

        {/* Claim widget — pinned at the bottom so all cards in the grid
            line up regardless of how many link buttons rendered above. */}
        <div className="grid grid-cols-1">
          <ClaimWidget b={b} isLoggedIn={isLoggedIn} />
        </div>
      </div>
    </div>
  )
}

type TypeFilter = 'all' | 'expat-owned' | 'expat-friendly'

// Suspense wrapper is required by Next 15 when useSearchParams is read
// from a client component — without it the static-paths optimizer bails
// out on the whole page tree at build time.
export default function DirectoryPage() {
  return (
    <Suspense fallback={null}>
      <DirectoryPageInner />
    </Suspense>
  )
}

function DirectoryPageInner() {
  // Read ?neighborhood= once on mount so deep-links from the neighborhood
  // pages (`/neighborhoods/<slug>` → "See all →") arrive with the filter
  // pre-selected. Stored as state so the user can clear it via the chip;
  // we deliberately don't keep it in the URL after the first read because
  // every other filter (category/type/search) is also state-only.
  const searchParams = useSearchParams()
  const initialNeighborhood = searchParams.get('neighborhood') ?? ''
  const { isLoggedIn } = useAuth()

  const [businesses,   setBusinesses]   = useState<Business[]>([])
  const [loading,      setLoading]      = useState(true)
  const [category,     setCategory]     = useState('all')
  const [type,         setType]         = useState<TypeFilter>('all')
  const [search,       setSearch]       = useState('')
  const [neighborhood, setNeighborhood] = useState(initialNeighborhood)

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (category !== 'all') params.set('category', category)
    if (type !== 'all')     params.set('type', type)
    if (neighborhood)       params.set('neighborhood', neighborhood)
    fetch(`/app/api/directory?${params}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setBusinesses)
      .catch(() => setBusinesses([]))
      .finally(() => setLoading(false))
  }, [category, type, neighborhood])

  useEffect(() => { load() }, [load])

  const visible = businesses.filter(b => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      b.name.toLowerCase().includes(q) ||
      b.description.toLowerCase().includes(q) ||
      (b.neighborhood ?? '').toLowerCase().includes(q) ||
      b.category.toLowerCase().includes(q)
    )
  })

  return (
    <div className="min-h-screen bg-warm pb-20 md:pb-0">
      {/* Page header — matches members page style */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-0">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-6">
            <div className="flex-1">
              <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">Discover</span>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">Directory</h1>
              {!loading && (
                <p className="text-base text-gray-500 mt-1">
                  {visible.length} {visible.length === 1 ? 'business' : 'businesses'} · expat-owned &amp; expat-friendly in Istanbul
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-72">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search businesses…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
              </div>
              <Link href="/directory/submit"
                className="shrink-0 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors">
                + Submit
              </Link>
            </div>
          </div>

          {/* Active neighborhood chip — visible when a deep-link from a
              neighborhood page pre-selected the filter. Clearable so the
              user can broaden the search without bouncing routes. */}
          {neighborhood && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-gray-500">Filtered to:</span>
              <button
                onClick={() => setNeighborhood('')}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold hover:bg-amber-200 transition-colors"
              >
                📍 {neighborhood}
                <span className="text-amber-600">✕</span>
              </button>
            </div>
          )}

          {/* Filter pills */}
          <div className="flex gap-2 pb-4 overflow-x-auto scrollbar-hide">
            {/* Type filters */}
            {([
              { id: 'all',            label: 'All'            },
              { id: 'expat-owned',    label: '👤 Expat-owned'    },
              { id: 'expat-friendly', label: '🌍 Expat-friendly' },
            ] as const).map(f => (
              <button key={f.id} onClick={() => setType(f.id)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap transition-all ${
                  type === f.id
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}>
                {f.label}
              </button>
            ))}

            <div className="w-px bg-gray-200 my-1.5 shrink-0" />

            {/* Category filters */}
            {CATEGORIES.filter(c => c.id !== 'all').map(c => (
              <button key={c.id} onClick={() => setCategory(category === c.id ? 'all' : c.id)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap transition-all ${
                  category === c.id
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-amber-200'
                }`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl shadow-sm overflow-hidden animate-pulse">
                <div className="w-full aspect-[4/3] bg-gray-200" />
                <div className="p-3 space-y-2">
                  <div className="h-3.5 bg-gray-200 rounded-full w-3/4" />
                  <div className="h-3 bg-gray-200 rounded-full w-1/2" />
                  <div className="h-8 bg-gray-100 rounded-lg mt-3" />
                </div>
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-20 max-w-xs mx-auto">
            <div className="text-6xl mb-4">🏢</div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">No businesses found</h3>
            <p className="text-sm text-gray-500 mb-6">
              {search ? 'Try a different search term or clear your filters.' : 'Be the first to add one!'}
            </p>
            <div className="flex flex-col gap-2 items-center">
              {(search || category !== 'all' || type !== 'all') && (
                <button onClick={() => { setSearch(''); setCategory('all'); setType('all') }}
                  className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl transition-colors">
                  Clear filters
                </button>
              )}
              <Link href="/directory/submit"
                className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors">
                Submit a Business
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {visible.map(b => <BusinessCard key={b.id} b={b} isLoggedIn={isLoggedIn} />)}
          </div>
        )}
      </div>
    </div>
  )
}
