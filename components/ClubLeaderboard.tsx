'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { avatarUrl, getInitials } from '@/lib/data'

interface LeaderboardEntry {
  rank: number
  count: number
  user: { id: string; name: string; color: string; profilePhoto: string | null }
}

export default function ClubLeaderboard({ slug }: { slug: string }) {
  const [entries, setEntries]  = useState<LeaderboardEntry[]>([])
  const [loading, setLoading]  = useState(true)

  useEffect(() => {
    fetch(`/app/api/clubs/${slug}/leaderboard`)
      .then(r => r.json())
      .then(d => setEntries(d.leaderboard ?? []))
      .finally(() => setLoading(false))
  }, [slug])

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-card divide-y divide-gray-50">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4 animate-pulse">
            <div className="w-6 h-4 bg-gray-200 rounded" />
            <div className="w-10 h-10 rounded-full bg-gray-200 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 bg-gray-200 rounded w-1/3" />
              <div className="h-3 bg-gray-100 rounded w-1/4" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!entries.length) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-12 text-center">
        <span className="text-4xl block mb-3">🏆</span>
        <p className="text-gray-600">No attendance data yet.</p>
      </div>
    )
  }

  const medals = ['🥇', '🥈', '🥉']

  return (
    <div className="bg-white rounded-2xl shadow-card overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="font-bold text-gray-900">Top attendees</h3>
        <p className="text-xs text-gray-400 mt-0.5">By events attended in this club</p>
      </div>
      <div className="divide-y divide-gray-50">
        {entries.map(entry => {
          const photo = avatarUrl(entry.user.profilePhoto, 64)
          const initials = getInitials(entry.user.name)
          return (
            <Link
              key={entry.user.id}
              href={`/members/${entry.user.id}`}
              className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors"
            >
              <span className="w-7 text-center text-base shrink-0">
                {medals[entry.rank - 1] ?? <span className="text-sm font-bold text-gray-400">{entry.rank}</span>}
              </span>
              {photo ? (
                <img src={photo} alt={entry.user.name} loading="lazy" className="w-10 h-10 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ backgroundColor: entry.user.color }}>
                  {initials}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{entry.user.name}</p>
                <p className="text-xs text-gray-400">{entry.count} event{entry.count !== 1 ? 's' : ''} attended</p>
              </div>
              {entry.rank === 1 && (
                <span className="text-xs font-bold px-2 py-1 rounded-full bg-amber-50 text-amber-600 shrink-0">Top member</span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
