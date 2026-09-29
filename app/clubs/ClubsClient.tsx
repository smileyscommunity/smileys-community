'use client'

import Link from 'next/link'
import { formatDay } from '@/lib/cityTime'
import { useState, useEffect, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { CLUB_FILTER_GROUPS, HEALTH_RANK, type ClubHealthLabel } from '@/lib/clubDiscovery'
import { useAuth } from '@/contexts/AuthContext'
import { resolveImageUrl } from '@/lib/data'
import { clubHref } from '@/lib/clubLink'
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
  // Network-wide total. memberCount is scoped to the city being viewed, so a
  // global club seen from a city nobody has joined from reads 0; the API has
  // carried this alongside it all along (lib/db.ts) and the footer uses it
  // rather than printing a 0 that describes the city, not the club.
  globalMemberCount?: number
  // null = a global club: one community listed in every city that opts in
  // (getCityConfig showGlobalClubs), rather than this city's own. It changes
  // what the member count means, so the card has to say which it is.
  cityId?: string | null
  // lib/db already derives this from cityId. Prefer it: deriving it a second
  // time here meant the card quietly turned every club local if that select
  // were ever narrowed, which is the thing the test guards against.
  isGlobal?: boolean
  isPrivate: boolean
  coverImage?: string | null
  // Discovery enrichment (phase 3) — computed server-side, cached 120s.
  health?: ClubHealthLabel
  upcomingCount?: number
  activityThisWeek?: number
  // What that total is made of. An upcoming event, a hangout that ran and a
  // message on the board are not the same thing, and summing them under
  // "activities" read as "things happening".
  activityParts?: { events: number; posts: number; hangouts: number }
  faces?: { name: string; color: string; profilePhoto: string | null }[]
  nextEvent?: { title: string; date: string } | null
}

interface Membership {
  clubId: string
  status: string
  role: string
}

type Tab = 'explore' | 'mine'

// What "42 members" means depends on which kind of club it is. For a local
// club it is the whole club. For a global one it counts only the people in
// the city you are standing in — so "3 members" on a club of 225 described
// three people here and read as somewhere not worth joining.
//
// Only split the number when splitting it tells you something. Istanbul holds
// nearly every member of nearly every global club today: the real figures are
// 272 of 276, 169 of 172, 118 of 120. Printing "272 here · 276 across
// Smileys" is noise on seven cards to describe a four-person difference. The
// split earns its place when a real share of the club is somewhere else,
// which is the case this is for and the one other cities will create.
const ELSEWHERE_SHARE = 0.8   // local members as a fraction of the whole club

function memberLine(club: Club): string | null {
  const here = club.memberCount
  const all  = club.globalMemberCount
  const plain = here > 0 ? `${here} member${here !== 1 ? 's' : ''}` : null
  if (!(club.isGlobal ?? club.cityId == null)) return plain   // a local club is all of itself
  // A global club nobody local has joined yet: the network figure is the only
  // honest number, and printing "0 members" would describe the city.
  if (!here) return all ? `${all} across Smileys` : null
  return all && here < all * ELSEWHERE_SHARE ? `${here} here · ${all} across Smileys` : plain
}

function ClubCard({ club, membership, toggling, onToggle, href }: {
  club: Club
  // Where the card links — clubHref(…), so a guest goes to the application
  // instead of the members-only club page (lib/clubLink).
  href: string
  membership?: Membership
  toggling: string | null
  onToggle: (club: Club) => void
}) {
  const isJoined  = membership?.status === 'approved'
  const isPending = membership?.status === 'pending'
  const isHost    = membership?.role === 'host'
  const isGlobal  = club.isGlobal ?? club.cityId == null
  const c = club

  // Compact on purpose (2026-09-29): the card was ~300px of cover and a
  // two-line description that read the same on 107 clubs ("A curated social
  // club for…"). What a member decides on is what's on and when, so that
  // leads; the description stays on the club's own page.
  // A club with something coming up gets its cover as a hero (Nate,
  // 2026-09-29): those are the clubs worth a look, and all 14 have one.
  // ?w=800: the file route's preview size — one cover was a 3 MB PNG.
  const heroSrc = club.nextEvent && club.coverImage ? resolveImageUrl(club.coverImage) : null
  const hero = heroSrc && heroSrc.startsWith('/app/api/files/') ? `${heroSrc}?w=800` : heroSrc

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:border-amber-200 transition-all overflow-hidden flex flex-col">
      {hero && (
        <Link href={href} tabIndex={-1} aria-hidden="true" className="block relative h-32 overflow-hidden">
          <img src={hero} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
        </Link>
      )}
    <div className="p-4 flex items-start gap-3">
      <Link href={href} tabIndex={-1} aria-hidden="true"
        className={`w-12 h-12 rounded-xl ${club.bgColor} flex items-center justify-center text-2xl shrink-0`}>
        {club.emoji}
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Link href={href}>
            <h3 className="font-bold text-gray-900 text-sm leading-snug hover:text-amber-700 transition-colors">{club.name}</h3>
          </Link>
          {club.isPrivate && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">Private</span>
          )}
          {/* Global clubs sit in every opted-in city's list, so a low local
              count reads as a club whose people are mostly elsewhere. */}
          {isGlobal && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700">🌍 Across Smileys</span>
          )}
          {isJoined && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500 text-white">{isHost ? 'Host' : '✓ Joined'}</span>
          )}
          {isPending && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">Pending</span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          {club.category}{memberLine(club) ? <> · {memberLine(club)}</> : null}
        </p>
        {/* What's on: the next event, else what the week held. */}
        {club.nextEvent ? (
          <p className="text-xs text-green-800 font-semibold mt-1 truncate">
            <span aria-hidden="true">📅 </span>{formatDay(club.nextEvent.date)} · {club.nextEvent.title}
            {(club.upcomingCount ?? 0) > 1 && <span className="font-normal text-gray-500"> · +{(club.upcomingCount ?? 0) - 1} more</span>}
          </p>
        ) : (c.activityThisWeek ?? 0) > 0 ? (
          <p className="text-xs text-gray-600 mt-1">{activitySummary(c)}</p>
        ) : null}
      </div>
      <div className="shrink-0">
        {/* aria-busy tells the SR rotor the button is mid-request; the
            outcome is announced by the sonner toast. Hosts never see Leave —
            they transfer hosting first. */}
        {isJoined && !isHost && (
          <button onClick={() => onToggle(club)} disabled={toggling === club.id} aria-busy={toggling === club.id}
            aria-label={`Leave ${club.name}`}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors font-medium disabled:opacity-50">
            {toggling === club.id ? '…' : 'Leave'}
          </button>
        )}
        {isPending && (
          <button onClick={() => onToggle(club)} disabled={toggling === club.id} aria-busy={toggling === club.id}
            aria-label={`Cancel your request to join ${club.name}`}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors font-medium disabled:opacity-50">
            {toggling === club.id ? '…' : 'Cancel'}
          </button>
        )}
        {!isJoined && !isPending && (
          <button onClick={() => onToggle(club)} disabled={toggling === club.id} aria-busy={toggling === club.id}
            aria-label={`${club.isPrivate ? 'Request to join' : 'Join'} ${club.name}`}
            className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors font-semibold disabled:opacity-50">
            {toggling === club.id ? '…' : club.isPrivate ? 'Request' : 'Join'}
          </button>
        )}
      </div>
    </div>
    </div>
  )
}

function AppClubsPageInner() {
  const { user, isLoggedIn, isLoading: authLoading } = useAuth()
  const router       = useRouter()
  const searchParams = useSearchParams()
  // ?city=<slug>: the /clubs server page pins the city in the URL so the
  // address bar is a shareable link (lib/cityPageParam). It has to reach the
  // grid and heading fetches and survive the URL sync, or the grid would
  // follow the cookie while the page's metadata names the pinned city.
  const pinnedCity = searchParams.get('city') ?? ''
  const cityQs     = pinnedCity ? `?city=${encodeURIComponent(pinnedCity)}` : ''
  const pathname     = usePathname()

  const [clubs,        setClubs]       = useState<Club[]>([])
  const [memberships,  setMemberships] = useState<Membership[]>([])
  const [loading,      setLoading]     = useState(true)
  const [loadError,    setLoadError]   = useState(false)
  const [reloadKey,    setReloadKey]   = useState(0)
  const [toggling,     setToggling]    = useState<string | null>(null)
  // tab + activeCategory mirror to/from the URL so refresh + back-button
  // + sharing a filtered URL all work. Same pattern the events page uses.
  const [tab,            setTab]            = useState<Tab>(() =>
    searchParams.get('tab') === 'mine' ? 'mine' : 'explore'
  )
  // The chip's words, not the internal value ("No food clubs yet").
  const categoryLabel = (v: string) => groups.find(g => g.value === v)?.label ?? v
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
  // Guests go to the application for the city on screen (lib/clubLink);
  // while sign-in is still resolving, links stay on the club page.
  const viewer = authLoading ? 'unknown' as const : isLoggedIn ? 'member' as const : 'guest' as const
  const clubLinkFor = (slug: string) => clubHref(slug, viewer, viewCity?.slug ?? (pinnedCity || null))

  // Mirror filter state to the URL. Defaults omitted from the
  // querystring so a "clean" URL means "all defaults".
  useEffect(() => {
    const params = new URLSearchParams()
    if (pinnedCity)               params.set('city',     pinnedCity)
    if (tab !== 'explore')        params.set('tab',      tab)
    if (activeCategory !== 'All') params.set('category', activeCategory)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [pinnedCity, tab, activeCategory, router, pathname])

  // One-shot mount fetches: hero CMS content + clubs + memberships.
  // Batched in a single Promise.all so all three setStates commit in
  // one render instead of the hero fetch sneaking in a second render
  // cycle. Each fetch fails open with `null` so a flaky CMS endpoint
  // doesn't take down the clubs grid.
  useEffect(() => {
    setLoading(true); setLoadError(false)
    Promise.all([
      fetch('/app/api/content').then(r => r.json()).catch(() => null),
      // The clubs fetch alone must not fail open: a 500 used to become []
      // and render "No clubs found — Check back soon." as if the city had none.
      fetch(`/app/api/clubs${cityQs}`, { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/app/api/clubs/memberships', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch(`/app/api/city/current${cityQs}`, { credentials: 'include' }).then(r => r.json()).catch(() => null),
    ]).then(([content, clubData, memberData, cityData]) => {
      if (content?.clubs) setHero(h => ({ ...h, ...content.clubs }))
      setClubs(Array.isArray(clubData) ? clubData : [])
      setLoadError(!Array.isArray(clubData))
      setMemberships(Array.isArray(memberData) ? memberData : [])
      if (cityData?.slug) setViewCity(cityData)
    }).finally(() => setLoading(false))
  }, [cityQs, reloadKey])

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
          // The server's reason ("join the city first") beats a shrug.
          const d = await res.json().catch(() => null)
          toast.error(typeof d?.error === 'string' ? d.error : (club.isPrivate ? 'Could not request to join' : `Could not join ${club.name}`))
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
  // Explore is for clubs you're NOT in: your own are in "Your clubs" at the
  // top and on the My Clubs tab, and the grid showed them a third time.
  const mineIds = useMemo(
    () => new Set([...joinedClubs, ...pendingClubs].map(c => c.id)),
    [joinedClubs, pendingClubs]
  )
  const notMine = useMemo(() => clubs.filter(c => !mineIds.has(c.id)), [clubs, mineIds])

  const exploreBase = useMemo(
    () => notMine.filter(matches).sort((a, b) =>
      (HEALTH_RANK[a.health ?? 'quiet'] - HEALTH_RANK[b.health ?? 'quiet'])
      || ((b.activityThisWeek ?? 0) - (a.activityThisWeek ?? 0))
      || (b.memberCount - a.memberCount)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notMine, activeCategory, q]
  )

  // Your clubs with an event coming up, soonest first — the top row.
  const myUpcoming = useMemo(
    () => joinedClubs.filter(c => c.nextEvent).sort((a, b) => a.nextEvent!.date.localeCompare(b.nextEvent!.date)),
    [joinedClubs]
  )
  // My Clubs tab: planned first (by date), then the rest.
  const myClubs = useMemo(
    () => [...joinedClubs, ...pendingClubs].filter(matches).sort((a, b) =>
      (a.nextEvent ? 0 : 1) - (b.nextEvent ? 0 : 1)
      || (a.nextEvent && b.nextEvent ? a.nextEvent.date.localeCompare(b.nextEvent.date) : a.name.localeCompare(b.name))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [joinedClubs, pendingClubs, activeCategory, q]
  )

  // Explore in four sections (2026-09-29). 14 of Istanbul's 148 clubs had
  // anything coming up and 107 had never met, so one grid sorted by health
  // made members scroll ~23 screens of dormant clubs to find the live ones.
  // Each club lands in the first section it qualifies for.
  const sections = useMemo(() => {
    const soon = exploreBase.filter(c => c.nextEvent)
      .sort((a, b) => a.nextEvent!.date.localeCompare(b.nextEvent!.date))
    const lately = exploreBase.filter(c => !c.nextEvent && (c.health === 'active' || c.health === 'new'))
    const taken  = new Set([...soon, ...lately].map(c => c.id))
    const global = exploreBase.filter(c => !taken.has(c.id) && (c.isGlobal ?? c.cityId == null))
    const quiet  = exploreBase.filter(c => !taken.has(c.id) && !(c.isGlobal ?? c.cityId == null))
    return { soon, lately, global, quiet }
  }, [exploreBase])

  // The long tails open on request: 32 language/culture clubs and ~105
  // dormant ones made the page ~10,000px even as compact rows.
  const [showAllGlobal, setShowAllGlobal] = useState(false)
  const [showAllQuiet,  setShowAllQuiet]  = useState(false)
  const GLOBAL_PREVIEW = 6
  const QUIET_PREVIEW  = 10
  // A search or a category filter is a request to see everything that matches.
  const filtering = !!q || activeCategory !== 'All'
  const renderCard = (club: Club) => (
    <ClubCard
      key={club.id}
      href={clubLinkFor(club.slug)}
      club={club}
      membership={membershipByClubId.get(club.id)}
      toggling={toggling}
      onToggle={toggleMembership}
    />
  )
  // Hosting is for members; a guest applies first (as on /get-involved).
  const offerHostHref = isLoggedIn
    ? `/contact?topic=host${viewCity?.slug ? `&city=${viewCity.slug}` : ''}`
    : `/apply${viewCity?.slug ? `?city=${viewCity.slug}` : ''}`
  // The count says how many clubs match — the strip's four included — not
  // how many cards happen to sit in the grid under it.
  const shownCount   = tab === 'mine' ? myClubs.length : exploreBase.length

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
              ? [['explore', 'Explore', notMine.length], ['mine', 'My Clubs', joinedClubs.length + pendingClubs.length]] as [Tab, string, number][]
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
        {/* Your clubs — only the ones with something coming up, soonest
            first. It listed every club a member had joined as a large card,
            and half of a typical 14 said "Nothing planned yet" above
            everything else (2026-09-29). The rest are one tap away. */}
        {!loading && tab === 'explore' && joinedClubs.length > 0 && (
          <div className="mb-8">
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <h2 className="text-xl font-extrabold tracking-tight text-gray-900">Coming up in your clubs</h2>
              <button onClick={() => setTab('mine')} className="text-sm font-semibold text-amber-700 hover:underline shrink-0">
                All your clubs ({joinedClubs.length + pendingClubs.length}) →
              </button>
            </div>
            {myUpcoming.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {myUpcoming.slice(0, 4).map(c => (
                  <Link key={c.id} href={`/clubs/${c.slug}`}
                    className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-amber-200 hover:shadow-md transition-all group">
                    <div className="flex items-center gap-2.5 mb-2">
                      <span aria-hidden="true" className="text-2xl shrink-0">{c.emoji}</span>
                      <p className="font-bold text-gray-900 leading-snug truncate group-hover:text-amber-700 transition-colors">{c.name}</p>
                    </div>
                    <p className="text-xs font-semibold text-green-800">{formatDay(c.nextEvent!.date)}</p>
                    <p className="text-xs text-gray-700 truncate">{c.nextEvent!.title}</p>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-600">None of your clubs has anything planned right now.</p>
            )}
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

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => <ClubCardSkeleton key={i} />)}
          </div>
        ) : loadError ? (
          <div role="alert" className="text-center py-20 max-w-xs mx-auto">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Couldn&apos;t load clubs</h2>
            <p className="text-sm text-gray-600 mb-6">Something went wrong on our side — please try again.</p>
            <button type="button" onClick={() => setReloadKey(k => k + 1)}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors">
              Try again
            </button>
          </div>
        ) : shownCount === 0 ? (
          <div className="text-center py-20 max-w-xs mx-auto">
            <div className="text-6xl mb-4">🏛️</div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">
              {tab === 'mine' ? 'No clubs yet' : 'No clubs found'}
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              {tab === 'mine'
                ? 'Join clubs to meet people who share your interests.'
                : activeCategory !== 'All' ? `No ${categoryLabel(activeCategory)} clubs yet.` : 'Check back soon.'}
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
                <strong className="text-gray-900 font-bold">{shownCount}</strong>{' '}
                club{shownCount !== 1 ? 's' : ''}
                {activeCategory !== 'All' && ` in ${categoryLabel(activeCategory)}`}
              </p>
            )}
            {tab === 'mine' ? (
              <div className="space-y-8">
                {myClubs.some(c => c.nextEvent) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {myClubs.filter(c => c.nextEvent).map(club => renderCard(club))}
                  </div>
                )}
                {myClubs.some(c => !c.nextEvent) && (
                  <section aria-labelledby="mine-quiet">
                    <h2 id="mine-quiet" className="text-sm font-bold text-gray-600 uppercase tracking-widest mb-3">Nothing planned right now</h2>
                    <ul className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100">
                      {myClubs.filter(c => !c.nextEvent).map(club => {
                        const m = membershipByClubId.get(club.id)
                        return (
                          <li key={club.id} className="flex items-center gap-3 px-4 py-2.5">
                            <span aria-hidden="true" className="text-xl shrink-0">{club.emoji}</span>
                            <Link href={`/clubs/${club.slug}`} className="min-w-0 flex-1 group">
                              <p className="text-sm font-semibold text-gray-900 truncate group-hover:text-amber-700">{club.name}</p>
                              <p className="text-xs text-gray-500 truncate">{club.category}{memberLine(club) ? ` · ${memberLine(club)}` : ''}{m?.status === 'pending' ? ' · Request pending' : m?.role === 'host' ? ' · You host' : ''}</p>
                            </Link>
                            {m && m.role !== 'host' && (
                              <button onClick={() => toggleMembership(club)} disabled={toggling === club.id} aria-busy={toggling === club.id}
                                aria-label={`${m.status === 'pending' ? 'Cancel your request to join' : 'Leave'} ${club.name}`}
                                className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors font-medium disabled:opacity-50 shrink-0">
                                {toggling === club.id ? '…' : m.status === 'pending' ? 'Cancel' : 'Leave'}
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )}
              </div>
            ) : (
              <div className="space-y-10">
                {sections.soon.length > 0 && (
                  <section aria-labelledby="clubs-soon">
                    <h2 id="clubs-soon" className="text-lg font-extrabold text-gray-900 mb-1">Happening soon</h2>
                    <p className="text-sm text-gray-600 mb-4">Clubs with an event coming up, soonest first.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {sections.soon.map(club => renderCard(club))}
                    </div>
                  </section>
                )}
                {sections.lately.length > 0 && (
                  <section aria-labelledby="clubs-lately">
                    <h2 id="clubs-lately" className="text-lg font-extrabold text-gray-900 mb-1">Active lately</h2>
                    <p className="text-sm text-gray-600 mb-4">Met, talked or planned something in the last two months — or just started.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {sections.lately.map(club => renderCard(club))}
                    </div>
                  </section>
                )}
                {sections.global.length > 0 && (
                  <section aria-labelledby="clubs-global">
                    <h2 id="clubs-global" className="text-lg font-extrabold text-gray-900 mb-1">Languages &amp; cultures</h2>
                    <p className="text-sm text-gray-600 mb-4">One community across every Smileys city.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {(showAllGlobal || filtering ? sections.global : sections.global.slice(0, GLOBAL_PREVIEW)).map(club => renderCard(club))}
                    </div>
                    {!showAllGlobal && !filtering && sections.global.length > GLOBAL_PREVIEW && (
                      <button onClick={() => setShowAllGlobal(true)}
                        className="mt-3 text-sm font-semibold text-amber-700 hover:underline">
                        Show all {sections.global.length} language &amp; culture clubs
                      </button>
                    )}
                  </section>
                )}
                {sections.quiet.length > 0 && (
                  <section aria-labelledby="clubs-quiet">
                    <h2 id="clubs-quiet" className="text-lg font-extrabold text-gray-900 mb-1">Looking for a host</h2>
                    <p className="text-sm text-gray-600 mb-4">
                      These clubs haven&apos;t met lately. Join one to hear when it does — or{' '}
                      <Link href={offerHostHref} className="font-semibold text-amber-700 hover:underline">offer to host it</Link>.
                    </p>
                    <ul className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100">
                      {(showAllQuiet || filtering ? sections.quiet : sections.quiet.slice(0, QUIET_PREVIEW)).map(club => {
                        const m = membershipByClubId.get(club.id)
                        return (
                          <li key={club.id} className="flex items-center gap-3 px-4 py-2.5">
                            <span aria-hidden="true" className="text-xl shrink-0">{club.emoji}</span>
                            <Link href={clubLinkFor(club.slug)} className="min-w-0 flex-1 group">
                              <p className="text-sm font-semibold text-gray-900 truncate group-hover:text-amber-700">{club.name}</p>
                              <p className="text-xs text-gray-500 truncate">{club.category}{memberLine(club) ? ` · ${memberLine(club)}` : ''}</p>
                            </Link>
                            {!m && (
                              <button onClick={() => toggleMembership(club)} disabled={toggling === club.id} aria-busy={toggling === club.id}
                                aria-label={`${club.isPrivate ? 'Request to join' : 'Join'} ${club.name}`}
                                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:border-amber-300 hover:text-amber-700 transition-colors font-semibold disabled:opacity-50 shrink-0">
                                {toggling === club.id ? '…' : club.isPrivate ? 'Request' : 'Join'}
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                    {!showAllQuiet && !filtering && sections.quiet.length > QUIET_PREVIEW && (
                      <button onClick={() => setShowAllQuiet(true)}
                        className="mt-3 text-sm font-semibold text-amber-700 hover:underline">
                        Show all {sections.quiet.length} clubs looking for a host
                      </button>
                    )}
                  </section>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// What a club's week actually consisted of: "1 event · 1 post", not
// "2 activities". The total is three different things added together — an
// event in the next seven days, a hangout from the last seven, a board post
// from the last seven — and one word for all three made the number look
// wrong to anyone who knew what was on. Book Club's "2 activities" were one
// Book Club Meeting and one Book Swap post.
//
// Parts that are zero are left out, so a club with one event reads "1 event"
// and nothing else. Falls back to the bare total for a cached response from
// before the parts existed.
function activitySummary(c: { activityThisWeek?: number; activityParts?: { events: number; posts: number; hangouts: number } }): string {
  const p = c.activityParts
  const n = c.activityThisWeek ?? 0
  if (!p) return `${n} activit${n !== 1 ? 'ies' : 'y'} this week`
  const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
  const bits = [
    p.events   ? plural(p.events,   'event')   : null,
    p.hangouts ? plural(p.hangouts, 'hangout') : null,
    p.posts    ? plural(p.posts,    'post')    : null,
  ].filter(Boolean)
  return bits.length ? bits.join(' · ') : `${n} activit${n !== 1 ? 'ies' : 'y'} this week`
}

export default function ClubsClient() {
  // Suspense wrapper is required by useSearchParams() in Next.js App Router.
  return (
    <Suspense>
      <AppClubsPageInner />
    </Suspense>
  )
}
