'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useAuth } from '@/contexts/AuthContext'
import { resolveImageUrl } from '@/lib/data'
import { BUSINESS_CATEGORIES } from '@/lib/directory-constants'
import DirectoryReviews from '@/components/DirectoryReviews'
import DirectorySaveButton from '@/components/DirectorySaveButton'
import { getOpenStatus } from '@/lib/businessHours'
import dynamic from 'next/dynamic'
import { SkeletonCard } from '@/components/Skeleton'

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
  // Server-projected booleans replacing the raw claimedById CUID.
  // The previous shape leaked the owner's user id to anonymous
  // scrapers; the API now derives these two flags server-side and
  // hides the underlying id.
  hasClaimedOwner: boolean
  isMine: boolean
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
  // Server-batched claim status for the caller against this business —
  // ClaimWidget reads from this instead of firing its own fetch per card.
  myClaimStatus: 'none' | 'pending' | 'approved' | 'rejected'
}

// Claiming and reporting moved to the detail page (/directory/[id]) —
// the grid card stays focused on the business itself.
function BusinessCard({
  b, onOpenReviews, onTagClick,
}: {
  b: Business
  onOpenReviews: () => void
  onTagClick: (tag: string) => void
}) {
  const logo  = resolveImageUrl(b.logo)
  const cover = resolveImageUrl(b.coverImage)
  const openStatus = getOpenStatus(b.hours)

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col hover:-translate-y-0.5 hover:shadow-md hover:border-gray-200 transition-all duration-200 relative">
      {/* Cover */}
      <div className="relative w-full aspect-[4/3] bg-gray-100">
        {/* Cover links to the business. Overlays below (save / badges / logo)
            come later in the DOM so they render above this link and stay
            independently clickable. */}
        <Link href={`/directory/${b.id}`} aria-label={b.name} className="block absolute inset-0">
          {cover ? (
            <Image src={cover} alt={b.name} fill sizes="(min-width: 1280px) 240px, (min-width: 1024px) 280px, (min-width: 640px) 320px, 50vw"
              className="object-cover" />
          ) : (
            <div aria-hidden="true" className="w-full h-full flex items-center justify-center text-4xl text-gray-300">🏢</div>
          )}
        </Link>

        {/* Expat badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {b.isExpatOwned && (
            <span className="bg-amber-500 text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full leading-tight">Expat-owned</span>
          )}
          {b.isExpatFriendly && (
            <span className="bg-teal-500 text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full leading-tight">Expat-friendly</span>
          )}
          {/* Member-discount perk — top-left strip alongside the other
              identity badges. Truncated so a wordy admin entry doesn't
              overflow the cover. */}
          {b.memberDiscount && (
            <span className="bg-fuchsia-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-tight max-w-[140px] truncate" title={b.memberDiscount}>
              <span aria-hidden="true">💸 </span>{b.memberDiscount}
            </span>
          )}
        </div>

        {/* Top-right: save toggle only. Anon viewers get bounced to
            login on click. The open-now badge used to live here too
            but competed for the same corner on the narrow mobile
            2-col grid — it now lives bottom-left, away from Save. */}
        <div className="absolute top-2 right-2">
          <DirectorySaveButton
            businessId={b.id}
            businessName={b.name}
            initialSaved={b.isSaved}
          />
        </div>

        {/* Open-now badge — bottom-left, opposite the logo (bottom-right).
            Hides when hours aren't configured. */}
        {openStatus && (
          <div className="absolute bottom-2 left-2">
            {openStatus.open ? (
              <span className="bg-emerald-500 text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full leading-tight shadow-sm">
                Open · until {openStatus.closesAt}
              </span>
            ) : (
              <span className="bg-white/95 text-gray-700 text-[11px] font-bold px-1.5 py-0.5 rounded-full leading-tight shadow-sm">
                Closed{openStatus.opensAt ? ` · opens ${openStatus.opensAt}` : ''}
              </span>
            )}
          </div>
        )}

        {/* Logo */}
        {logo && (
          <div className="absolute bottom-2 right-2 w-9 h-9 rounded-xl overflow-hidden border-2 border-white shadow-sm bg-white">
            <Image src={logo} alt={b.name} width={36} height={36} className="w-full h-full object-cover" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div>
          <div className="flex items-center gap-1.5">
            <Link href={`/directory/${b.id}`} className="font-bold text-gray-900 text-sm leading-tight truncate hover:text-amber-700 transition-colors">
              {b.name}
            </Link>
            {/* Verified-owner check next to the title — same position
                Google + Twitter use, so the badge reads as "this name
                is verified" rather than as a standalone CTA. */}
            {b.hasClaimedOwner && (
              <span title="Verified owner" className="text-emerald-500 text-xs shrink-0">
                <span aria-hidden="true">✓</span>
                <span className="sr-only">Verified owner</span>
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-400 truncate mt-0.5">
            {b.category}{b.neighborhood ? ` · ${b.neighborhood}` : ''}
          </p>
          {/* Rating — one compact line; tapping opens the reviews
              drawer. The write-review CTA lives on the detail page. */}
          <button
            onClick={onOpenReviews}
            className="flex items-center gap-1 text-[11px] mt-1 group/r hover:underline"
            aria-label="See reviews"
          >
            {b.avgRating != null ? (
              <>
                <span aria-hidden="true" className="text-amber-500">★</span>
                <span className="font-bold text-gray-900">{b.avgRating.toFixed(1)}</span>
                <span className="text-gray-400">· {b.reviewCount}</span>
              </>
            ) : (
              <span className="text-gray-400 group-hover/r:text-amber-700">No reviews yet</span>
            )}
          </button>
        </div>

        <p className="text-xs text-gray-600 line-clamp-2 flex-1">{b.description}</p>

        {/* Sub-tag chips. Capped to 4 visible (overflow truncates) so
            the card height stays predictable. Clicking a chip writes
            the tag into the parent search box — the in-memory filter
            already matches against tags, so the grid narrows to other
            entries carrying the same tag. 'We meet here' is hidden on
            cards — nearly every listing carries it, so on the grid it
            was pure repetition; it still shows on the detail page and
            still matches in search. */}
        {(() => {
          const cardTags = b.tags.filter(t => t !== 'We meet here')
          if (!cardTags.length) return null
          return (
            <div className="flex flex-wrap gap-1">
              {cardTags.slice(0, 4).map(t => (
                <button
                  key={t}
                  onClick={(e) => { e.stopPropagation(); onTagClick(t) }}
                  className="text-[11px] font-semibold bg-gray-100 text-gray-600 hover:bg-amber-100 hover:text-amber-700 px-2 py-0.5 rounded-full transition-colors"
                >
                  {t}
                </button>
              ))}
              {cardTags.length > 4 && (
                <span className="text-[11px] text-gray-400">+{cardTags.length - 4}</span>
              )}
            </div>
          )
        })()}

        {b.languages && (
          <p className="text-[11px] text-gray-400"><span aria-hidden="true">🗣 </span>{b.languages}</p>
        )}

        {/* Single "View details" CTA replacing the previous three-link
            row (Website / Instagram / Call). Those contact actions now
            live exclusively on the detail page at /directory/[id]
            where the visitor can see the full info card alongside
            hours, address, map, etc. — keeps the grid cards uniform
            in height and pushes traffic to the SEO-indexed detail
            route. */}
        <Link
          href={`/directory/${b.id}`}
          className="block text-center text-[11px] font-semibold text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 rounded-lg py-1.5 mt-auto transition-colors"
        >
          View details →
        </Link>
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
  // Filters hydrate from the URL on mount and write back on every
  // change, so the current view is shareable. Earlier shape only
  // honored ?neighborhood= for deep-links from the neighborhood
  // pages; the rest of the filter state was lost on copy/paste.
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()
  const { user, isLoggedIn } = useAuth()
  const currentUserId = isLoggedIn ? user.id : null
  // Only one reviews drawer open at a time. Track open business id +
  // a refresh tick so a write inside the drawer re-fetches the parent
  // grid (so the rating badge on the card updates).
  const [openReviewsFor, setOpenReviewsFor] = useState<Business | null>(null)

  const [businesses,   setBusinesses]   = useState<Business[]>([])
  const [loading,      setLoading]      = useState(true)
  const [category,     setCategory]     = useState(searchParams.get('category') ?? 'all')
  const [type,         setType]         = useState<TypeFilter>((searchParams.get('type') as TypeFilter) ?? 'all')
  const [search,       setSearch]       = useState(searchParams.get('q') ?? '')
  const [neighborhood, setNeighborhood] = useState(searchParams.get('neighborhood') ?? '')
  // "We meet here" toggle — browse only the venues that host Smileys
  // events. Client-side filter on the tag (nearly all-or-nothing today,
  // so a server param isn't worth it).
  const [meetOnly,     setMeetOnly]     = useState(searchParams.get('meet') === '1')
  // List vs map. Default to list because it works for everyone on
  // every device; map is a one-tap toggle away.
  const [viewMode,     setViewMode]     = useState<'list' | 'map'>('list')
  // Sort axis. 'recent' (default) = createdAt DESC, what the directory
  // has always shown. 'trending' = re-orders by saves in the last 7 days.
  const [sort,         setSort]         = useState<'recent' | 'trending'>(
    (searchParams.get('sort') as 'recent' | 'trending') ?? 'recent'
  )

  // Sync filter state back to the URL on every change so the current
  // view is bookmarkable / shareable. Uses replace so each keystroke
  // in the search box doesn't pile up browser history entries.
  useEffect(() => {
    const params = new URLSearchParams()
    if (category    !== 'all')    params.set('category',    category)
    if (type        !== 'all')    params.set('type',        type)
    if (sort        !== 'recent') params.set('sort',        sort)
    if (search)                   params.set('q',           search)
    if (neighborhood)             params.set('neighborhood', neighborhood)
    if (meetOnly)                 params.set('meet',        '1')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [category, type, sort, search, neighborhood, meetOnly, pathname, router])

  // total is the unpaginated server count from X-Total-Count — used to
  // surface "showing first 200 of N" when the server-side cap kicks in.
  const [total, setTotal] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (category !== 'all') params.set('category', category)
    if (type !== 'all')     params.set('type', type)
    if (neighborhood)       params.set('neighborhood', neighborhood)
    if (sort !== 'recent')  params.set('sort', sort)
    fetch(`/app/api/directory?${params}`, { credentials: 'include' })
      .then(async r => {
        if (!r.ok) return { items: [] as Business[], total: 0 }
        const items = await r.json() as Business[]
        const t = Number(r.headers.get('X-Total-Count'))
        return { items, total: Number.isFinite(t) ? t : items.length }
      })
      .then(({ items, total }) => {
        setBusinesses(items)
        setTotal(total)
      })
      .catch(() => { setBusinesses([]); setTotal(0) })
      .finally(() => setLoading(false))
  }, [category, type, neighborhood, sort])

  useEffect(() => { load() }, [load])

  // Memoize the pin-click callback so the DirectoryMap effect doesn't
  // tear down and rebuild every marker on every parent re-render
  // (every keystroke in the search box was thrashing the marker layer).
  const onPinClick = useCallback((id: string) => {
    const biz = businesses.find(b => b.id === id)
    if (biz) setOpenReviewsFor(biz)
  }, [businesses])

  const visible = businesses.filter(b => {
    if (meetOnly && !b.tags.includes('We meet here')) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      b.name.toLowerCase().includes(q) ||
      b.description.toLowerCase().includes(q) ||
      (b.neighborhood ?? '').toLowerCase().includes(q) ||
      b.category.toLowerCase().includes(q) ||
      // Tags participate in the same in-memory match so a tag-chip
      // click ("Vegan") narrows the grid to other entries carrying
      // that tag too, not just the one card clicked.
      b.tags.some(t => t.toLowerCase().includes(q))
    )
  })

  return (
    <div className="min-h-screen bg-warm pb-20 md:pb-0">
      {/* Page header — matches members page style */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-0">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-6">
            <div className="flex-1">
              <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">🧭 Discover</span>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">Directory</h1>
              {!loading && (
                <p className="text-base text-gray-600 mt-1">
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
                      viewMode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-700'
                    }`}
                  >
                    <span aria-hidden="true">{m === 'list' ? '☰' : '📍'}</span> {m === 'list' ? 'List' : 'Map'}
                  </button>
                ))}
              </div>
              <Link href={isLoggedIn ? '/directory/submit' : '/login?return=/directory/submit'}
                className="shrink-0 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors">
                {isLoggedIn ? '+ Submit' : 'Sign in to submit'}
              </Link>
            </div>
          </div>

          {/* Active neighborhood chip — visible when a deep-link from a
              neighborhood page pre-selected the filter. Clearable so the
              user can broaden the search without bouncing routes. */}
          {neighborhood && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-gray-600">Filtered to:</span>
              <button
                onClick={() => setNeighborhood('')}
                aria-label={`Clear ${neighborhood} filter`}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold hover:bg-amber-200 transition-colors"
              >
                <span aria-hidden="true">📍 </span>{neighborhood}
                <span aria-hidden="true" className="text-amber-600">✕</span>
              </button>
            </div>
          )}

          {/* Filter pills — relative wrapper so the right-edge fade
              (sibling absolute div below the scroll row) signals that
              more pills sit off-screen on narrow viewports. */}
          <div className="relative">
            <div className="flex gap-2 pb-4 overflow-x-auto scrollbar-hide">
            {/* Saved-only quick link → personal /directory/saved sub-page
                (bookmarkable + shareable). Member-only — guests don't have
                anything to show there. */}
            {isLoggedIn && (
              <Link
                href="/directory/saved"
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap bg-amber-500 text-white border-amber-500 hover:bg-amber-600 hover:border-amber-600 transition-all"
              >
                ★ Saved
              </Link>
            )}

            {/* Sort pill — toggles between Recent (default) and Trending
                (last 7 days by save count). Sits at the front of the
                filter row so the active sort axis is the first thing
                the user sees. */}
            {(['recent', 'trending'] as const).map(s => (
              <button key={s} onClick={() => setSort(s)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap transition-all ${
                  sort === s
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}>
                <span aria-hidden="true">{s === 'recent' ? '🆕' : '🔥'}</span> {s === 'recent' ? 'Recent' : 'Trending'}
              </button>
            ))}

            <div className="w-px bg-gray-200 my-1.5 shrink-0" />

            {/* Type filters */}
            {([
              { id: 'all',            icon: null,  label: 'All'             },
              { id: 'expat-owned',    icon: '👤',  label: 'Expat-owned'     },
              { id: 'expat-friendly', icon: '🌍',  label: 'Expat-friendly'  },
            ] as const).map(f => (
              <button key={f.id} onClick={() => setType(f.id)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap transition-all ${
                  type === f.id
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}>
                {f.icon && <span aria-hidden="true">{f.icon}</span>} {f.label}
              </button>
            ))}

            {/* "We meet here" — venues that host Smileys events. */}
            <button onClick={() => setMeetOnly(v => !v)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap transition-all ${
                meetOnly
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}>
              <span aria-hidden="true">🤝</span> We meet here
            </button>

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
            {/* Right-edge fade — signals horizontal scroll when the
                pill row overflows. pointer-events-none so clicks
                still reach the rightmost pill underneath. */}
            <div aria-hidden="true" className="pointer-events-none absolute right-0 top-0 bottom-4 w-12 bg-gradient-to-l from-white to-transparent" />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-20 max-w-xs mx-auto">
            <div aria-hidden="true" className="text-6xl mb-4">🏢</div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">No businesses found</h3>
            <p className="text-sm text-gray-600 mb-6">
              {search ? 'Try a different search term or clear your filters.' : 'Be the first to add one!'}
            </p>
            <div className="flex flex-col gap-2 items-center">
              {(search || category !== 'all' || type !== 'all' || meetOnly) && (
                <button onClick={() => { setSearch(''); setCategory('all'); setType('all'); setMeetOnly(false) }}
                  className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl transition-colors">
                  Clear filters
                </button>
              )}
              <Link href={isLoggedIn ? '/directory/submit' : '/login?return=/directory/submit'}
                className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors">
                {isLoggedIn ? 'Submit a Business' : 'Sign in to submit'}
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
            onPinClick={onPinClick}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {visible.map(b => (
                <BusinessCard
                  key={b.id}
                  b={b}
                  onOpenReviews={() => setOpenReviewsFor(b)}
                  onTagClick={setSearch}
                />
              ))}
            </div>
            {/* Truncation hint when the server cap took effect. Only
                shows once we've crossed the page-size threshold; below
                that the grid IS the whole directory. */}
            {total != null && total > businesses.length && (
              <p className="text-xs text-gray-400 text-center mt-6">
                Showing first {businesses.length} of {total} businesses · use filters above to narrow down
              </p>
            )}
          </>
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
          currentUserId={currentUserId}
          isOwner={openReviewsFor.isMine}
          onChange={load}
          onClose={() => setOpenReviewsFor(null)}
        />
      )}
    </div>
  )
}
