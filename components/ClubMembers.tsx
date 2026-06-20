'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { resolveImageUrl } from '@/lib/data'

interface ClubMember {
  id: string
  firstName: string
  fullName: string | null
  color: string
  photo: string | null
  neighborhood: string | null
  role: string
  connected: boolean
}

function MemberCard({ m }: { m: ClubMember }) {
  const photo = resolveImageUrl(m.photo)
  const initials = m.firstName.slice(0, 2).toUpperCase()

  const avatar = photo ? (
    <img src={photo} alt={m.firstName} loading="lazy"
      className="w-16 h-16 rounded-2xl object-cover" />
  ) : (
    <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-lg font-bold"
      style={{ backgroundColor: m.color }}>
      {initials}
    </div>
  )

  if (m.connected) {
    return (
      <Link href={`/members/${m.id}`}
        className="flex flex-col items-center gap-2 p-3 rounded-2xl hover:bg-gray-50 transition-colors text-center group">
        <div className="relative">
          {avatar}
          {m.role === 'host' && (
            <span className="absolute -top-1 -right-1 text-[9px] font-bold px-1 py-0.5 rounded-full bg-blue-500 text-white leading-none">
              Host
            </span>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-900 truncate max-w-[72px] group-hover:text-amber-600 transition-colors">
            {m.fullName ?? m.firstName}
          </p>
          {m.neighborhood && (
            <p className="text-xs text-gray-400 truncate max-w-[72px]">{m.neighborhood}</p>
          )}
        </div>
      </Link>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2 p-3 rounded-2xl text-center">
      <div className="relative">
        <div className="relative">
          {avatar}
          <div className="absolute inset-0 rounded-2xl bg-white/10" />
        </div>
        {m.role === 'host' && (
          <span className="absolute -top-1 -right-1 text-[9px] font-bold px-1 py-0.5 rounded-full bg-blue-500 text-white leading-none">
            Host
          </span>
        )}
      </div>
      <p className="text-xs font-semibold text-gray-900 truncate max-w-[72px]">{m.firstName}</p>
    </div>
  )
}

export default function ClubMembers({ slug }: { slug: string }) {
  const [members, setMembers] = useState<ClubMember[]>([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')

  useEffect(() => {
    fetch(`/app/api/clubs/${slug}/members`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setMembers(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false))
  }, [slug])

  const filtered = search.trim()
    ? members.filter(m =>
        m.firstName.toLowerCase().includes(search.toLowerCase()) ||
        m.fullName?.toLowerCase().includes(search.toLowerCase()) ||
        m.neighborhood?.toLowerCase().includes(search.toLowerCase())
      )
    : members

  const unconnectedCount = members.filter(m => !m.connected).length

  if (loading) return (
    <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
      {[...Array(12)].map((_, i) => (
        <div key={i} className="flex flex-col items-center gap-2 p-3 animate-pulse">
          <div className="w-16 h-16 rounded-2xl bg-gray-200" />
          <div className="h-3 bg-gray-200 rounded w-10" />
        </div>
      ))}
    </div>
  )

  if (members.length === 0) return (
    <div className="text-center py-12">
      <span className="text-4xl block mb-3">👋</span>
      <p className="text-gray-600">No members yet. Be the first to join!</p>
    </div>
  )

  return (
    <div>
      {members.length > 12 && (
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search members…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-400 placeholder-gray-400"
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-gray-600 text-sm py-6 text-center">No members match your search.</p>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
          {filtered.map(m => <MemberCard key={m.id} m={m} />)}
        </div>
      )}

      {unconnectedCount > 0 && (
        <p className="text-xs text-gray-400 text-center mt-6">
          Connect with members to see their full profile
        </p>
      )}
    </div>
  )
}
