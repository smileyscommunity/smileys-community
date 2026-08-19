'use client'

import Link from 'next/link'
import { useState, useEffect, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { resolveImageUrl, avatarUrl } from '@/lib/data'
import { CLUB_FILTER_GROUPS, HEALTH_RANK, type ClubHealthLabel } from '@/lib/clubDiscovery'
import AvatarImg from '@/components/AvatarImg'
import { useAuth } from '@/contexts/AuthContext'
import ClubCardSkeleton from '@/components/ClubCardSkeleton'
import AdBannerStrip from '@/components/AdBannerStrip'

interface Club {
  id: string
  name: string
  slug: string
  description: string
  category: string
  emoji: string
  bgColor: string
  color: string
  memberCount: number
  isPrivate: boolean
  coverImage?: string | null
  // Discovery enrichment (phase 3) — computed server-side, cached 120s.
  health?: ClubHealthLabel
  upcomingCount?: number
  activityThisWeek?: number
  faces?: { name: string; color: string; profilePhoto: string | null }[]
  nextEvent?: { title: string; date: string } | null
}

interface Membership {
  clubId: string
  status: string
  role: string
}

type Tab = 'explore' | 'mine'

function ClubCard({ club, membership, toggling, onToggle }: {
  club: Club
  membership?: Membership
  toggling: string | null
  onToggle: (club: Club) => void
}) {
  const photo     = club.coverImage ? resolveImageUrl(club.coverImage) : null
  const isJoined  = membership?.status === 'approved'
  const isPending = membership?.status === 'pending'
  const isHost    = membership?.role === 'host'

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden flex flex-col group">

      {/* Cover / Hero — single overlay structure that floats the badges
          over either the photo or the emoji fallback. The two used to be
          near-identical branches with ~50 lines of duplicated JSX; now
          only the background layer switches. */}
      <Link href={`/clubs/${club.slug}`} className="block">
        <div className="relative h-36 overflow-hidden">
          {photo ? (
            <>
              <img src={photo} alt={club.name} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
            </>
          ) : (
            <div className={`absolute inset-0 ${club.bgColor} flex items-center justify-center`}>
              <span className="text-5xl opacity-80 select-none">{club.emoji}</span>
            </div>
          )}

          {/* Category + Private — slight bg-tone difference between the
              two background variants is preserved (more translucent + a
              backdrop blur on the emoji variant so the chip reads against
              the saturated bgColor). */}
          <div className="absolute top-3 left-3 flex items-center gap-1.5">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${photo ? 'bg-white/90' : 'bg-white/80 backdrop-blur-sm'} ${club.color}`}>
              {club.category}
            </span>
            {club.isPrivate && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-500 text-white">
                Private
              </span>
            )}
          </div>

          {(isJoined || isPending) && (
            <div className="absolute top-3 right-3">
              {isJoined && (
                // Solid amber-500 = active commitment, matches the
                // events page's amber-not-green Going treatment.
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500 text-white">
                  {isHost ? 'Host' : '✓ Joined'}
                </span>
              )}
              {isPending && (
                // Soft amber-100 = in-progress / waiting state, so the
                // Pending badge differentiates from solid Joined without
                // breaking the amber palette.
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                  Pending
                </span>
              )}
            </div>
          )}
        </div>
      </Link>

      {/* Info */}
      <div className="p-4 flex-1 flex flex-col gap-2">
        <div>
          <Link href={`/clubs/${club.slug}`}>
            <h3 className="font-bold text-gray-900 text-sm leading-snug hover:text-amber-600 transition-colors">{club.name}</h3>
          </Link>
          <p className="text-xs text-gray-600 line-clamp-2 mt-1 leading-relaxed">{club.description}</p>
        </div>

        {/* Discovery signals (brief §10): faces + honest activity state.
            Upcoming activity beats a "quiet lately" note; neither fakes
            anything. */}
        {(club.upcomingCount ?? 0) > 0 ? (
          <p className="text-[11px] font-semibold text-green-700"><span aria-hidden="true">📅</span> {club.upcomingCount} upcoming event{club.upcomingCount !== 1 ? 's' : ''}</p>
        ) : club.health === 'quiet' ? (
          <p className="text-[11px] text-gray-400">Quiet lately — be the spark</p>
        ) : null}

        {/* Footer */}
        <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-50">
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            {(club.faces?.length ?? 0) > 0 && (
              <span className="flex -space-x-1.5">
                {club.faces!.slice(0, 3).map((f, i) => (
                  <AvatarImg key={i} src={avatarUrl(f.profilePhoto, 64)} name={f.name} color={f.color}
                    size="w-5 h-5" textSize="text-[9px]" className="ring-2 ring-white rounded-full" />
                ))}
              </span>
            )}
            {club.memberCount} member{club.memberCount !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            {/* Leave is now shown on every tab (was previously gated by a
                tab-specific showLeave prop). A member who lands on a club
                they've already joined while browsing Explore can leave
                without first switching tabs. Hosts never see Leave —
                they need to transfer hosting before leaving. */}
            {/* aria-busy tells the SR rotor the button is mid-request;
                the success/error outcome itself is announced via the
                sonner toast (Toaster is rendered in app/layout.tsx with
                its default aria-live region). */}
            {isJoined && !isHost && (
              <button
                onClick={() => onToggle(club)}
                disabled={toggling === club.id}
                aria-busy={toggling === club.id}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors font-medium disabled:opacity-50">
                {toggling === club.id ? '…' : 'Leave'}
              </button>
            )}
            {isPending && (
              <button
                onClick={() => onToggle(club)}
                disabled={toggling === club.id}
                aria-busy={toggling === club.id}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors font-medium disabled:opacity-50">
                {toggling === club.id ? '…' : 'Cancel'}
              </button>
            )}
            {!isJoined && !isPending && (
              <button
                onClick={() => onToggle(club)}
                disabled={toggling === club.id}
                aria-busy={toggling === club.id}
                className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors font-semibold disabled:opacity-50">
                {toggling === club.id ? '…' : club.isPrivate ? 'Request' : 'Join'}
              </button>
            )}
            <Link href={`/clubs/${club.slug}`}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-600 transition-colors font-medium">
              View →
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

function AppClubsPageInner() {
  const { user, isLoggedIn } = useAuth()
  const router       = useRouter()
  const searchParams = useSearchParams()
  const pathname     = usePathname()

  const [clubs,        setClubs]       = useState<Club[]>([])
  const [memberships,  setMemberships] = useState<Membership[]>([])
  const [loading,      setLoading]     = useState(true)
  const [toggling,     setToggling]    = useState<string | null>(null)
  // tab + activeCategory mirror to/from the URL so refresh + back-button
  // + sharing a filtered URL all work. Same pattern the events page uses.
  const [tab,            setTab]            = useState<Tab>(() =>
    searchParams.get('tab') === 'mine' ? 'mine' : 'explore'
  )
  const [activeCategory, setActiveCategory] = useState<string>(() => searchParams.get('category') ?? 'All')
  const [search,         setSearch]         = useState('')
  // CMS overrides land in this state on mount via /api/content. The
  // default headline used to be 'Clubs' — accurate but file-cabinet
  // bland. 'Find your community' reads as an invitation while leaving
  // the badge + subtitle communicating the actual content.
  const [hero, setHero] = useState({ badge: 'Smileys Clubs', headline: 'Find your people.', subtitle: "Whatever you're into, there's probably someone in Istanbul who's into it too." })
  // The city this grid resolved to, from /api/city/current (the clubs API
  // returns a bare array, so the city can't ride along like it does on
  // /api/events). Separate from `hero` so the CMS fetch — whose copy is
  // default-city-flavored — can't race it back. Only a non-default city
  // overrides the subtitle.
  const [viewCity, setViewCity] = useState<{ name: string; slug: string; isDefault: boolean; viewing?: boolean; homeName?: string | null } | null>(null)
  const cityHero = viewCity && !viewCity.isDefault ? viewCity : null

  // Mirror filter state to the URL. Defaults omitted from the
  // querystring so a "clean" URL means "all defaults".
  useEffect(() => {
    const params = new URLSearchParams()
    if (tab !== 'explore')        params.set('tab',      tab)
    if (activeCategory !== 'All') params.set('category', activeCategory)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [tab, activeCategory, router, pathname])

  // One-shot mount fetches: hero CMS content + clubs + memberships.
  // Batched in a single Promise.all so all three setStates commit in
  // one render instead of the hero fetch sneaking in a second render
  // cycle. Each fetch fails open with `null` so a flaky CMS endpoint
  // doesn't take down the clubs grid.
  useEffect(() => {
    Promise.all([
      fetch('/app/api/content').then(r => r.json()).catch(() => null),
      fetch('/app/api/clubs', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/app/api/clubs/memberships', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/app/api/city/current', { credentials: 'include' }).then(r => r.json()).catch(() => null),
    ]).then(([content, clubData, memberData, cityData]) => {
      if (content?.clubs) setHero(h => ({ ...h, ...content.clubs }))
      setClubs(Array.isArray(clubData) ? clubData : [])
      setMemberships(Array.isArray(memberData) ? memberData : [])
      if (cityData?.slug) setViewCity(cityData)
    }).finally(() => setLoading(false))
  }, [])

  // O(1) clubId → membership lookup. Was memberships.find() called inside
  // a getMembership() function that ran once per card per render — for
  // 50 clubs × 10 memberships that's 500 array scans per paint. The Map
  // is rebuilt only when memberships actually changes.
  const membershipByClubId = useMemo(
    () => new Map(memberships.map(m => [m.clubId, m])),
    [memberships]
  )

  async function toggleMembership(club: Club) {
    if (!isLoggedIn) { router.push('/login'); return }
    const membership = membershipByClubId.get(club.id)
    setToggling(club.id)
    try {
      if (membership) {
        // Leave / cancel pending
        const res = await fetch(`/app/api/clubs/${club.slug}/membership`, { method: 'DELETE', credentials: 'include' })
        if (!res.ok) {
          toast.error(membership.status === 'pending' ? 'Could not cancel request' : `Could not leave ${club.name}`)
          return
        }
        setMemberships(prev => prev.filter(m => m.clubId !== club.id))
        if (membership.status === 'approved') {
          setClubs(prev => prev.map(c => c.id === club.id ? { ...c, memberCount: c.memberCount - 1 } : c))
        }
      } else {
        // Join / request
        const res = await fetch(`/app/api/clubs/${club.slug}/membership`, { method: 'POST', credentials: 'include' })
        if (!res.ok) {
          toast.error(club.isPrivate ? 'Could not request to join' : `Could not join ${club.name}`)
          return
        }
        const data = await res.json()
        setMemberships(prev => [...prev, { clubId: club.id, status: data.status, role: 'member' }])
        if (data.status === 'approved') {
          setClubs(prev => prev.map(c => c.id === club.id ? { ...c, memberCount: c.memberCount + 1 } : c))
          toast.success(`Joined ${club.name}`)
        } else if (data.status === 'pending') {
          toast.success(`Request sent to ${club.name}`)
        }
      }
    } catch {
      // Network error — fetch rejected before getting a response.
      toast.error('Network error — check your connection')
    } finally {
      // Guarantees the button leaves the "…" state even if anything above
      // throws or returns early.
      setToggling(null)
    }
  }

  // Browse filters are the 9 display-level groups (brief §8), not the 16
  // raw DB categories. Only groups that actually contain clubs render.
  const groups = useMemo(() => {
    const cats = new Set(clubs.map(c => c.category))
    return CLUB_FILTER_GROUPS.filter(g => g.categories.some(c => cats.has(c)))
  }, [clubs])
  const groupOf = (club: Club) => CLUB_FILTER_GROUPS.find(g => g.categories.includes(club.category))?.value

  // Memoized so they don't re-filter on unrelated rerenders (typing in a
  // search box, hover state, etc). joinedClubs / pendingClubs feed the
  // hero + tab-pill counts as well as the my-clubs grid, so they're
  // cheap to compute but re-running them on every paint is wasted work.
  const joinedClubs  = useMemo(
    () => clubs.filter(c => membershipByClubId.get(c.id)?.status === 'approved'),
    [clubs, membershipByClubId]
  )
  const pendingClubs = useMemo(
    () => clubs.filter(c => membershipByClubId.get(c.id)?.status === 'pending'),
    [clubs, membershipByClubId]
  )

  const q = search.trim().toLowerCase()
  const matches = (c: Club) =>
    (activeCategory === 'All' || groupOf(c) === activeCategory) &&
    (!q || `${c.name} ${c.description} ${c.category}`.toLowerCase().includes(q))

  // Health-ranked discovery (brief §36): Active first, New second, Quiet
  // last; ties broken by this-week activity, then size.
  const exploreClubs = useMemo(
    () => clubs.filter(matches).sort((a, b) =>
      (HEALTH_RANK[a.health ?? 'quiet'] - HEALTH_RANK[b.health ?? 'quiet'])
      || ((b.activityThisWeek ?? 0) - (a.activityThisWeek ?? 0))
      || (b.memberCount - a.memberCount)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clubs, activeCategory, q]
  )

  const myClubs = useMemo(
    () => [...joinedClubs, ...pendingClubs].filter(matches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [joinedClubs, pendingClubs, activeCategory, q]
  )

  // "Active this week" strip (brief §11) — real activity only, never
  // membership size. Silent when nothing qualifies.
  const activeThisWeek = useMemo(
    () => clubs.filter(c => (c.activityThisWeek ?? 0) > 0)
      .sort((a, b) => (b.activityThisWeek ?? 0) - (a.activityThisWeek ?? 0))
      .slice(0, 4),
    [clubs]
  )

  // "Coming up in your clubs" (brief §43) — next events across the
  // viewer's joined clubs, soonest first.
  const comingUp = useMemo(
    () => joinedClubs
      .filter(c => c.nextEvent)
      .sort((a, b) => (a.nextEvent!.date).localeCompare(b.nextEvent!.date))
      .slice(0, 3),
    [joinedClubs]
  )

  const displayClubs = tab === 'mine' ? myClubs : exploreClubs

  return (
    <div className="min-h-screen bg-warm pb-20 md:pb-0">
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-5">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-3 py-1.5 mb-4">
                {/* Named for every city, default included — same reason as the
                    directory eyebrow: a bare badge beside a "· <City>" one
                    reads as "the city we don't have to mention". This appends
                    to the CMS badge rather than replacing it, so nothing an
                    editor wrote is lost. The SUBTITLE below still only
                    overrides for a non-default city, because there the CMS copy
                    IS the default city's copy and replacing it would discard
                    editorial work. */}
                🏛️ {viewCity ? `${hero.badge} · ${viewCity.name}` : hero.badge}
              </span>
              {/* Same escape hatch as the events page — the view-city
                  cookie lives a year, so viewing another city needs a
                  visible way back. */}
              {viewCity?.viewing && viewCity.homeName && (
                // eslint-disable-next-line @next/next/no-html-link-for-pages -- route handler that must run server-side to clear the cookie; <Link> would client-navigate past it
                <a href="/app/api/city/enter?clear=1&to=clubs"
                  className="inline-flex items-center gap-1.5 ml-2 mb-4 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors">
                  ✕ Back to {viewCity.homeName}
                </a>
              )}
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">{hero.headline}</h1>
              <p className="text-base text-gray-600 mt-2">{cityHero ? `Whatever you're into, there's probably someone in ${cityHero.name} who's into it too.` : hero.subtitle}</p>
              {/* (Total-clubs count used to be merged here as "354 clubs ·
                  Discover communities…". Awkward "·" merge AND duplicated
                  the filtered count above the grid. Kept only the
                  filtered count below, which is the more useful number.) */}
            </div>
            {isLoggedIn && user.role === 'admin' && (
              <Link href="/admin/clubs"
                className="hidden sm:flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors shrink-0 shadow-sm">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create Club
              </Link>
            )}
          </div>

          <AdBannerStrip page="clubs" />

          {/* Tab pills — role=tab + aria-selected so the SR rotor picks
              them up as proper tabs. The grid below is the implicit
              tabpanel (single panel that swaps content); no separate
              role=tabpanel since we'd just be wrapping the existing
              grid for the SR semantics. */}
          <div role="tablist" aria-label="Filter clubs by membership" className="flex flex-wrap gap-2 mb-4">
            {(isLoggedIn
              ? [['explore', 'Explore', clubs.length], ['mine', 'My Clubs', joinedClubs.length + pendingClubs.length]] as [Tab, string, number][]
              : [['explore', 'Explore', clubs.length]] as [Tab, string, number][]
            ).map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                role="tab"
                aria-selected={tab === key}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap transition-all ${
                  tab === key
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}>
                {label}
                {!loading && count > 0 && (
                  <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${tab === key ? 'bg-white/20' : 'bg-gray-100 text-gray-400'}`}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Search (brief §7) */}
          <div className="relative mb-3 max-w-md">
            <svg aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search interests, activities or clubs…"
              className="w-full pl-9 pr-8 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition" />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"><span aria-hidden="true">×</span></button>
            )}
          </div>

          {/* Interest-group pills (brief §8) — 9 display groups, not the
              16 raw categories. */}
          {!loading && groups.length > 1 && (
            <div className="flex flex-wrap gap-2 pb-1">
              {[{ value: 'All', label: 'All', emoji: '🗂️' }, ...groups].map(g => (
                <button key={g.value} onClick={() => setActiveCategory(g.value)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border whitespace-nowrap transition-all ${
                    activeCategory === g.value
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}>
                  <span aria-hidden="true">{g.emoji}</span> {g.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Your Clubs (brief §5) — members with clubs never rediscover
            them; the row leads the page on the explore tab. */}
        {!loading && tab === 'explore' && joinedClubs.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-extrabold tracking-tight text-gray-900 mb-3">Your clubs</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {joinedClubs.map(c => (
                <Link key={c.id} href={`/clubs/${c.slug}`}
                  className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-amber-200 hover:shadow-md transition-all group">
                  <div className="flex items-center gap-2.5 mb-2">
                    <span aria-hidden="true" className="text-2xl shrink-0">{c.emoji}</span>
                    <p className="font-bold text-gray-900 leading-snug truncate group-hover:text-amber-700 transition-colors">{c.name}</p>
                  </div>
                  {c.nextEvent ? (
                    <p className="text-xs text-gray-600">
                      <span className="font-semibold text-amber-700">Next:</span> {c.nextEvent.title.slice(0, 40)}
                      <span className="block text-gray-400 mt-0.5">{new Date(c.nextEvent.date + 'T12:00:00+03:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400">Nothing planned yet</p>
                  )}
                  <span className="inline-block text-xs font-bold text-amber-600 mt-2">Open club →</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Coming up in your clubs (brief §43). */}
        {!loading && tab === 'explore' && comingUp.length > 0 && (
          <div className="mb-8 bg-amber-50 border border-amber-100 rounded-2xl p-5">
            <h2 className="text-sm font-extrabold text-amber-800 uppercase tracking-widest mb-3">Coming up in your clubs</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {comingUp.map(c => (
                <Link key={c.id} href={`/clubs/${c.slug}`} className="flex items-start gap-3 bg-white rounded-xl border border-amber-100 px-4 py-3 hover:border-amber-300 transition-colors">
                  <span aria-hidden="true" className="text-xl shrink-0">{c.emoji}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{c.nextEvent!.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {new Date(c.nextEvent!.date + 'T12:00:00+03:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {c.name}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* What are you into? (brief §6) — members without clubs get
            interest chips instead of a wall of cards. */}
        {!loading && isLoggedIn && joinedClubs.length === 0 && pendingClubs.length === 0 && tab === 'explore' && activeCategory === 'All' && !q && (
          <div className="mb-8 bg-amber-50 border border-amber-100 rounded-2xl p-6">
            <h2 className="text-xl font-extrabold tracking-tight text-gray-900">What are you into?</h2>
            <p className="text-sm text-gray-600 mt-1 mb-4">Pick an interest and we&apos;ll show you where your people are.</p>
            <div className="flex flex-wrap gap-2">
              {groups.map(g => (
                <button key={g.value} onClick={() => setActiveCategory(g.value)}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-amber-200 rounded-2xl text-sm font-bold text-gray-800 hover:border-amber-400 hover:-translate-y-0.5 transition-all">
                  <span aria-hidden="true">{g.emoji}</span> {g.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Active this week (brief §11) — real activity, not size. */}
        {!loading && tab === 'explore' && activeCategory === 'All' && !q && activeThisWeek.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-extrabold text-gray-600 uppercase tracking-widest mb-3"><span aria-hidden="true">🔥</span> Active this week</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {activeThisWeek.map(c => (
                <Link key={c.id} href={`/clubs/${c.slug}`}
                  className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-amber-200 hover:shadow-md transition-all group">
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className="text-xl shrink-0">{c.emoji}</span>
                    <p className="text-sm font-bold text-gray-900 truncate group-hover:text-amber-700 transition-colors">{c.name}</p>
                  </div>
                  <p className="text-xs text-gray-500 mt-1.5">{c.activityThisWeek} activit{(c.activityThisWeek ?? 0) !== 1 ? 'ies' : 'y'} this week</p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => <ClubCardSkeleton key={i} />)}
          </div>
        ) : displayClubs.length === 0 ? (
          <div className="text-center py-20 max-w-xs mx-auto">
            <div className="text-6xl mb-4">🏛️</div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">
              {tab === 'mine' ? 'No clubs yet' : 'No clubs found'}
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              {tab === 'mine'
                ? 'Join clubs to meet people who share your interests.'
                : activeCategory !== 'All' ? `No ${activeCategory} clubs yet.` : 'Check back soon.'}
            </p>
            <div className="flex flex-col gap-2 items-center">
              {tab === 'mine' && (
                <button onClick={() => setTab('explore')}
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors">
                  Explore clubs
                </button>
              )}
              {activeCategory !== 'All' && (
                <button onClick={() => setActiveCategory('All')}
                  className="px-5 py-2.5 bg-white border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:border-gray-300 transition-colors">
                  Show all categories
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {!loading && (
              <p className="text-sm text-gray-600 mb-5">
                <strong className="text-gray-900 font-bold">{displayClubs.length}</strong>{' '}
                club{displayClubs.length !== 1 ? 's' : ''}
                {activeCategory !== 'All' && ` in ${activeCategory}`}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {displayClubs.map(club => (
                <ClubCard
                  key={club.id}
                  club={club}
                  membership={membershipByClubId.get(club.id)}
                  toggling={toggling}
                  onToggle={toggleMembership}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function AppClubsPage() {
  // Suspense wrapper is required by useSearchParams() in Next.js App Router.
  return (
    <Suspense>
      <AppClubsPageInner />
    </Suspense>
  )
}
