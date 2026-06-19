'use client'

import Link from 'next/link'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { resolveImageUrl } from '@/lib/data'
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
              <img src={photo} alt={club.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
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
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-green-500 text-white">
                  {isHost ? 'Host' : '✓ Joined'}
                </span>
              )}
              {isPending && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-400 text-white">
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


        {/* Footer */}
        <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-50">
          <span className="text-xs text-gray-400">{club.memberCount} member{club.memberCount !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-2">
            {/* Leave is now shown on every tab (was previously gated by a
                tab-specific showLeave prop). A member who lands on a club
                they've already joined while browsing Explore can leave
                without first switching tabs. Hosts never see Leave —
                they need to transfer hosting before leaving. */}
            {isJoined && !isHost && (
              <button onClick={() => onToggle(club)} disabled={toggling === club.id}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors font-medium disabled:opacity-50">
                {toggling === club.id ? '…' : 'Leave'}
              </button>
            )}
            {isPending && (
              <button onClick={() => onToggle(club)} disabled={toggling === club.id}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors font-medium disabled:opacity-50">
                {toggling === club.id ? '…' : 'Cancel'}
              </button>
            )}
            {!isJoined && !isPending && (
              <button onClick={() => onToggle(club)} disabled={toggling === club.id}
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

export default function AppClubsPage() {
  const { user, isLoggedIn } = useAuth()
  const router = useRouter()
  const [clubs,        setClubs]       = useState<Club[]>([])
  const [memberships,  setMemberships] = useState<Membership[]>([])
  const [loading,      setLoading]     = useState(true)
  const [toggling,     setToggling]    = useState<string | null>(null)
  const [tab,          setTab]         = useState<Tab>('explore')
  const [activeCategory, setActiveCategory] = useState('All')
  const [hero, setHero] = useState({ badge: 'Community', headline: 'Clubs', subtitle: 'Discover communities and manage your memberships.' })

  useEffect(() => {
    fetch('/app/api/content').then(r => r.json()).then(d => {
      if (d.clubs) setHero(h => ({ ...h, ...d.clubs }))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    Promise.all([
      fetch('/app/api/clubs', { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/clubs/memberships', { credentials: 'include' }).then(r => r.json()),
    ]).then(([clubData, memberData]) => {
      setClubs(Array.isArray(clubData) ? clubData : [])
      setMemberships(Array.isArray(memberData) ? memberData : [])
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

  const categories = useMemo(() => {
    const cats = [...new Set(clubs.map(c => c.category).filter(Boolean))].sort()
    return ['All', ...cats]
  }, [clubs])

  const joinedClubs  = clubs.filter(c => membershipByClubId.get(c.id)?.status === 'approved')
  const pendingClubs = clubs.filter(c => membershipByClubId.get(c.id)?.status === 'pending')

  const exploreClubs = clubs.filter(c =>
    activeCategory === 'All' || c.category === activeCategory
  )

  const myClubs = [...joinedClubs, ...pendingClubs].filter(c =>
    activeCategory === 'All' || c.category === activeCategory
  )

  const displayClubs = tab === 'mine' ? myClubs : exploreClubs

  return (
    <div className="min-h-screen bg-warm pb-20 md:pb-0">
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-5">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-3 py-1.5 mb-4">
                {hero.badge}
              </span>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">{hero.headline}</h1>
              <p className="text-base text-gray-600 mt-2">
                {!loading && (
                  <><strong className="text-gray-900 font-bold">{clubs.length}</strong> clubs · </>
                )}
                {hero.subtitle}
              </p>
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

          {/* Tab pills */}
          <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-hide">
            {(isLoggedIn
              ? [['explore', 'Explore', clubs.length], ['mine', 'My Clubs', joinedClubs.length + pendingClubs.length]] as [Tab, string, number][]
              : [['explore', 'Explore', clubs.length]] as [Tab, string, number][]
            ).map(([key, label, count]) => (
              <button key={key} onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap transition-all ${
                  tab === key
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}>
                {label}
                {!loading && count > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === key ? 'bg-white/20' : 'bg-gray-100 text-gray-400'}`}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Category filter pills */}
          {!loading && categories.length > 2 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
              {categories.map(cat => (
                <button key={cat} onClick={() => setActiveCategory(cat)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border whitespace-nowrap transition-all ${
                    activeCategory === cat
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}>
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => <ClubCardSkeleton key={i} />)}
          </div>
        ) : displayClubs.length === 0 ? (
          <div className="text-center py-20 max-w-xs mx-auto">
            <div className="text-6xl mb-4">🏛️</div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              {tab === 'mine' ? 'No clubs yet' : 'No clubs found'}
            </h3>
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
