'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Club {
  id: string
  name: string
  emoji: string
  slug: string
  memberCount: number
}

export default function HostClubsPage() {
  const [clubs,   setClubs]   = useState<Club[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/app/api/host/clubs', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setClubs(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold text-white">My Clubs</h1>
        <p className="text-zinc-400 text-sm mt-1">Manage announcements, spotlight, rules, resources and photos.</p>
      </div>

      {loading ? (
        <div className="text-zinc-500 text-sm">Loading…</div>
      ) : clubs.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">🏛️</div>
          <div className="text-zinc-300 font-medium mb-1">No clubs assigned</div>
          <div className="text-zinc-500 text-sm">Ask an admin to assign you as a host of a club.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {clubs.map(club => (
            <Link
              key={club.id}
              href={`/host/clubs/${club.slug}`}
              className="bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-xl p-4 flex items-center gap-4 transition-colors group"
            >
              <div className="w-14 h-14 rounded-xl bg-zinc-800 flex items-center justify-center text-3xl shrink-0">
                {club.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white group-hover:text-amber-400 transition-colors">{club.name}</div>
                <div className="text-xs text-zinc-500 mt-0.5">{club.memberCount} members</div>
              </div>
              <div className="text-xs text-zinc-600 group-hover:text-amber-500 transition-colors shrink-0">
                Manage →
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
