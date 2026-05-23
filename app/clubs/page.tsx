'use client'

import Link from 'next/link'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
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
  whatsappUrl?: string | null
  instagramUrl?: string | null
}

interface Membership {
  clubId: string
  status: string
  role: string
}

type Tab = 'explore' | 'mine'

function ClubCard({ club, membership, toggling, onToggle, showLeave }: {
  club: Club
  membership?: Membership
  toggling: string | null
  onToggle: (club: Club) => void
  showLeave?: boolean
}) {
  const photo     = club.coverImage ? resolveImageUrl(club.coverImage) : null
  const isJoined  = membership?.status === 'approved'
  const isPending = membership?.status === 'pending'
  const isHost    = membership?.role === 'host'

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden flex flex-col group">

      {/* Cover / Hero */}
      <Link href={`/clubs/${club.slug}`} className="block">
        {photo ? (
          <div className="relative h-36 overflow-hidden">
            <img src={photo} alt={club.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
            <div className="absolute top-3 left-3 flex items-center gap-1.5">
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/90 ${club.color}`}>
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
        ) : (
          <div className={`relative h-36 ${club.bgColor} flex items-center justify-center overflow-hidden`}>
            <span className="text-5xl opacity-80 select-none">{club.emoji}</span>
            <div className="absolute top-3 left-3 flex items-center gap-1.5">
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/80 backdrop-blur-sm ${club.color}`}>
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
        )}
      </Link>

      {/* Info */}
      <div className="p-4 flex-1 flex flex-col gap-2">
        <div>
          <Link href={`/clubs/${club.slug}`}>
            <h3 className="font-bold text-gray-900 text-sm leading-snug hover:text-amber-600 transition-colors">{club.name}</h3>
          </Link>
          <p className="text-xs text-gray-500 line-clamp-2 mt-1 leading-relaxed">{club.description}</p>
        </div>

        {/* Social links */}
        {(club.whatsappUrl || club.instagramUrl) && (
          <div className="flex gap-2">
            {club.whatsappUrl && (
              <a href={club.whatsappUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors font-medium">
                <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                WhatsApp
              </a>
            )}
            {club.instagramUrl && (
              <a href={club.instagramUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-pink-50 text-pink-700 hover:bg-pink-100 transition-colors font-medium">
                <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                </svg>
                Instagram
              </a>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-50">
          <span className="text-xs text-gray-400">{club.memberCount} member{club.memberCount !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-2">
            {showLeave && isJoined && !isHost && (
              <button onClick={() => onToggle(club)} disabled={toggling === club.id}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors font-medium disabled:opacity-50">
                {toggling === club.id ? '…' : 'Leave'}
              </button>
            )}
            {isPending && (
              <button onClick={() => onToggle(club)} disabled={toggling === club.id}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors font-medium disabled:opacity-50">
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

  function getMembership(clubId: string) {
    return memberships.find(m => m.clubId === clubId)
  }

  async function toggleMembership(club: Club) {
    if (!isLoggedIn) { router.push('/login'); return }
    const membership = getMembership(club.id)
    setToggling(club.id)
    if (membership) {
      const res = await fetch(`/app/api/clubs/${club.slug}/membership`, { method: 'DELETE', credentials: 'include' })
      if (res.ok) {
        setMemberships(prev => prev.filter(m => m.clubId !== club.id))
        if (membership.status === 'approved') {
          setClubs(prev => prev.map(c => c.id === club.id ? { ...c, memberCount: c.memberCount - 1 } : c))
        }
      }
    } else {
      const res = await fetch(`/app/api/clubs/${club.slug}/membership`, { method: 'POST', credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setMemberships(prev => [...prev, { clubId: club.id, status: data.status, role: 'member' }])
        if (data.status === 'approved') {
          setClubs(prev => prev.map(c => c.id === club.id ? { ...c, memberCount: c.memberCount + 1 } : c))
        }
      }
    }
    setToggling(null)
  }

  const categories = useMemo(() => {
    const cats = [...new Set(clubs.map(c => c.category).filter(Boolean))].sort()
    return ['All', ...cats]
  }, [clubs])

  const joinedClubs  = clubs.filter(c => getMembership(c.id)?.status === 'approved')
  const pendingClubs = clubs.filter(c => getMembership(c.id)?.status === 'pending')

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
              <p className="text-base text-gray-500 mt-2">
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
            <p className="text-sm text-gray-500 mb-6">
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
              <p className="text-sm text-gray-500 mb-5">
                <strong className="text-gray-900 font-bold">{displayClubs.length}</strong>{' '}
                {tab === 'mine' ? 'club' : 'club'}{displayClubs.length !== 1 ? 's' : ''}
                {activeCategory !== 'All' && ` in ${activeCategory}`}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {displayClubs.map(club => (
                <ClubCard
                  key={club.id}
                  club={club}
                  membership={getMembership(club.id)}
                  toggling={toggling}
                  onToggle={toggleMembership}
                  showLeave={tab === 'mine'}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
