'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { resolveImageUrl } from '@/lib/data'
import { BUSINESS_CATEGORIES } from '@/lib/directory'
import { isSafeHref } from '@/lib/safeUrl'
import DirectoryReviews from '@/components/DirectoryReviews'
import DirectoryReportButton from '@/components/DirectoryReportButton'
import DirectoryOwnerEdit from '@/components/DirectoryOwnerEdit'
import DirectorySaveButton from '@/components/DirectorySaveButton'
import { getOpenStatus } from '@/lib/businessHours'
import dynamic from 'next/dynamic'

// Leaflet hits `window` on import, so the map can't render during SSR
// or the static-paths analysis. Dynamic-import with ssr:false keeps the
// list view fast (no Leaflet bundle until the user toggles to Map).
const DirectoryMap = dynamic(() => import('@/components/DirectoryMap'), { ssr: false })

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
  // Aggregate review stats (non-hidden reviews only).
  avgRating:   number | null
  reviewCount: number
  // Optional precise coordinates — set by admin via /admin/directory.
  // Map view falls back to neighborhood centroid + jitter when null.
  latitude:  number | null
  longitude: number | null
  // Weekly opening hours, free-form member-discount perk.
  hours: Record<string, string | null> | null
  memberDiscount: string | null
  // Admin-curated sub-tags ("Vegan", "Brunch", "Late-night", ...).
  tags: string[]
  // Save state — isSaved is the caller's flag (false for anon); count
  // is the aggregate over all users.
  isSaved: boolean
  saveCount: number
  // Truncated submitter attribution ("Sarah K." / "a member").
  addedBy: string
}

// Claim status mirrors the BusinessClaim.status DB enum plus a
// `none` sentinel for "no claim yet, you can submit one".
type ClaimState = 'loading' | 'none' | 'pending' | 'approved' | 'rejected' | 'owned'

// Inline claim trigger — lives inside the info block, styled as a small
// text link rather than a full-width button. Lighter visual footprint
// so it doesn't fight with the Website/Instagram/Call action row above.
// The popover form (when open) overlays the card.
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

  // Verified owner state renders nothing here — the badge lives next to
  // the business name (see BusinessCard) so it sits with the title
  // rather than as a CTA-shaped block at the bottom.
  if (b.claimedById) return null

  if (!isLoggedIn) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent('/directory')}`}
        className="text-[11px] text-gray-400 hover:text-amber-600 hover:underline transition-colors"
      >
        Is this your business?
      </Link>
    )
  }

  if (state === 'loading') return null

  if (state === 'pending') {
    return <p className="text-[11px] text-amber-600 italic">Claim pending review</p>
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
        <p className="text-xs font-bold text-gray-900 mb-1.5">Verify you own "{b.name}"</p>
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

  const label = state === 'rejected' ? 'Claim rejected — try again' : 'Is this your business?'
  return (
    <button
      onClick={() => setOpen(true)}
      className="text-[11px] text-gray-400 hover:text-amber-600 hover:underline transition-colors self-start"
    >
      {label}
    </button>
  )
}

function BusinessCard({
  b, isLoggedIn, currentUserId, onOpenReviews, onEdited,
}: {
  b: Business
  isLoggedIn: boolean
  currentUserId: string | null
  onOpenReviews: () => void
  onEdited: () => void
}) {
  const logo  = resolveImageUrl(b.logo)
  const cover = resolveImageUrl(b.coverImage)
  const isOwner = currentUserId != null && b.claimedById === currentUserId
  const openStatus = getOpenStatus(b.hours)

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
          {/* Member-discount perk — top-left strip alongside the other
              identity badges. Truncated so a wordy admin entry doesn't
              overflow the cover. */}
          {b.memberDiscount && (
            <span className="bg-fuchsia-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-tight max-w-[140px] truncate" title={b.memberDiscount}>
              💸 {b.memberDiscount}
            </span>
          )}
        </div>

        {/* Top-right cluster: save toggle on top, open-now badge below.
            Save is always visible (anon viewers get bounced to login on
            click); open-now hides when hours aren't set. */}
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
          <DirectorySaveButton
            businessId={b.id}
            businessName={b.name}
            initialSaved={b.isSaved}
            isLoggedIn={isLoggedIn}
          />
          {openStatus && (
            openStatus.open ? (
              <span className="bg-emerald-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-tight shadow-sm">
                Open · until {openStatus.closesAt}
              </span>
            ) : (
              <span className="bg-white/95 text-gray-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-tight shadow-sm">
                Closed{openStatus.opensAt ? ` · opens ${openStatus.opensAt}` : ''}
              </span>
            )
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
          <div className="flex items-center gap-1.5">
            <p className="font-bold text-gray-900 text-sm leading-tight truncate">{b.name}</p>
            {/* Verified-owner check next to the title — same position
                Google + Twitter use, so the badge reads as "this name
                is verified" rather than as a standalone CTA. */}
            {b.claimedById && (
              <span title="Verified owner" className="text-emerald-500 text-xs shrink-0">✓</span>
            )}
          </div>
          <p className="text-[11px] text-gray-400 truncate mt-0.5">
            {b.category}{b.neighborhood ? ` · ${b.neighborhood}` : ''}
          </p>
          {/* Rating badge — clickable; opens the reviews drawer. Even
              when there are no reviews we surface "No reviews yet" as
              a CTA so members can be the first. Small footprint, big
              affordance for the new feature. */}
          <button
            onClick={onOpenReviews}
            className="flex items-center gap-1 text-[11px] mt-1 group/r hover:underline"
            aria-label="See reviews"
          >
            {b.avgRating != null ? (
              <>
                <span className="text-amber-500">★</span>
                <span className="font-bold text-gray-900">{b.avgRating.toFixed(1)}</span>
                <span className="text-gray-400">·</span>
                <span className="text-gray-500 group-hover/r:text-amber-700">{b.reviewCount} review{b.reviewCount === 1 ? '' : 's'}</span>
              </>
            ) : (
              <span className="text-gray-400 group-hover/r:text-amber-700">No reviews yet — be the first</span>
            )}
          </button>
          {/* Claim trigger sits inside the info block as a small link
              right under the meta line — discoverable but visually
              quiet. Renders nothing when the business is already
              claimed (badge above replaces it). */}
          <div className="mt-1">
            <ClaimWidget b={b} isLoggedIn={isLoggedIn} />
          </div>
        </div>

        <p className="text-xs text-gray-500 line-clamp-2 flex-1">{b.description}</p>

        {/* Sub-tag chips. Capped to 4 visible (overflow truncates) so
            the card height stays predictable. Each chip is just visual
            — clicking a chip on a future iteration could filter the
            grid by that tag. */}
        {b.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {b.tags.slice(0, 4).map(t => (
              <span key={t} className="text-[10px] font-semibold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {t}
              </span>
            ))}
            {b.tags.length > 4 && (
              <span className="text-[10px] text-gray-400">+{b.tags.length - 4}</span>
            )}
          </div>
        )}

        {b.languages && (
          <p className="text-[10px] text-gray-400">🗣 {b.languages}</p>
        )}

        {/* Attribution line — "Added by Sarah K." plus optional save
            count for social proof. addedBy is already server-truncated
            so no surname leaks here. */}
        <p className="text-[10px] text-gray-400">
          Added by <span className="text-gray-500">{b.addedBy}</span>
          {b.saveCount > 0 && (
            <span> · ★ saved by {b.saveCount} {b.saveCount === 1 ? 'member' : 'members'}</span>
          )}
        </p>

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

        {/* Bottom row: owner-edit (verified owners only) + report.
            Both render as tiny inline text links so they don't fight
            with the link buttons above. */}
        <div className="flex items-center justify-between gap-2 -mt-1">
          {isOwner ? (
            <DirectoryOwnerEdit b={b} onSaved={onEdited} />
          ) : (
            <span />
          )}
          <DirectoryReportButton businessId={b.id} businessName={b.name} />
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
  const { isLoggedIn, user } = useAuth()
  const currentUserId = isLoggedIn && user.id !== 'guest' ? user.id : null
  // Only one reviews drawer open at a time. Track open business id +
  // a refresh tick so a write inside the drawer re-fetches the parent
  // grid (so the rating badge on the card updates).
  const [openReviewsFor, setOpenReviewsFor] = useState<Business | null>(null)

  const [businesses,   setBusinesses]   = useState<Business[]>([])
  const [loading,      setLoading]      = useState(true)
  const [category,     setCategory]     = useState('all')
  const [type,         setType]         = useState<TypeFilter>('all')
  const [search,       setSearch]       = useState('')
  const [neighborhood, setNeighborhood] = useState(initialNeighborhood)
  // List vs map. Default to list because it works for everyone on
  // every device; map is a one-tap toggle away.
  const [viewMode,     setViewMode]     = useState<'list' | 'map'>('list')

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
              {/* List/Map toggle — same shape as the type filter pills
                  below so it reads as part of the directory toolset. */}
              <div className="flex bg-gray-100 rounded-xl p-0.5 text-xs font-bold">
                {(['list', 'map'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setViewMode(m)}
                    className={`px-3 py-1.5 rounded-lg capitalize transition-colors ${
                      viewMode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {m === 'list' ? '☰ List' : '📍 Map'}
                  </button>
                ))}
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
            {/* Saved-only quick link — visible only when logged in. Takes
                members straight to their personal /directory/saved list
                rather than filtering in place, so the route is
                bookmarkable + shareable as a sub-page. */}
            {isLoggedIn && (
              <Link
                href="/directory/saved"
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap bg-amber-500 text-white border-amber-500 hover:bg-amber-600 hover:border-amber-600 transition-all"
              >
                ★ Saved
              </Link>
            )}

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
        ) : viewMode === 'map' ? (
          <DirectoryMap
            businesses={visible.map(b => ({
              id: b.id, name: b.name, category: b.category,
              neighborhood: b.neighborhood,
              latitude: b.latitude, longitude: b.longitude,
              avgRating: b.avgRating, reviewCount: b.reviewCount,
            }))}
            onPinClick={(id) => {
              const biz = visible.find(b => b.id === id)
              if (biz) setOpenReviewsFor(biz)
            }}
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {visible.map(b => (
              <BusinessCard
                key={b.id}
                b={b}
                isLoggedIn={isLoggedIn}
                currentUserId={currentUserId}
                onOpenReviews={() => setOpenReviewsFor(b)}
                onEdited={load}
              />
            ))}
          </div>
        )}
      </div>

      {/* Reviews drawer mounts at the page root so it overlays the grid
          regardless of which card opened it. `onChange` reloads the
          parent list so the rating badge on the card refreshes after
          the member posts/edits/deletes a review. */}
      {openReviewsFor && (
        <DirectoryReviews
          businessId={openReviewsFor.id}
          businessName={openReviewsFor.name}
          isLoggedIn={isLoggedIn}
          currentUserId={currentUserId}
          isOwner={currentUserId != null && openReviewsFor.claimedById === currentUserId}
          onChange={load}
          onClose={() => setOpenReviewsFor(null)}
        />
      )}
    </div>
  )
}
