'use client'

import { useState, useEffect } from 'react'

// What the host's events have done, from /api/host/impact: only events that
// went ahead and are over, and only guests who actually came (host and
// co-hosts excluded). The card used to be captioned "Vanity metrics for
// being an awesome host" and counted RSVPs to future events as "Social
// Moments" — the opposite of what the community asks hosts to aim for.
interface ImpactData {
  eventsHeld:     number
  guestVisits:    number
  distinctGuests: number
  averageRating:  number
  reviewCount:    number
}

export default function HostImpactStats() {
  const [data, setData] = useState<ImpactData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/app/api/host/impact', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (!d.error) setData(d)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-24 bg-zinc-900 border border-zinc-800 rounded-2xl animate-pulse" />
      ))}
    </div>
  )

  if (!data || data.eventsHeld === 0) return null

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-4 px-1">
        <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">What your events have done</h2>
        <span className="text-xs text-zinc-600 font-medium">Past events · guests who came</span>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Events */}
        <div className="bg-gradient-to-br from-zinc-900 to-zinc-800 border border-zinc-800 rounded-2xl p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
            <span className="text-4xl">🗓️</span>
          </div>
          <p className="text-3xl font-black text-white">{data.eventsHeld}</p>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mt-1">Events held</p>
        </div>

        {/* Different people */}
        <div className="bg-gradient-to-br from-zinc-900 to-zinc-800 border border-zinc-800 rounded-2xl p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
            <span className="text-4xl">🤝</span>
          </div>
          <p className="text-3xl font-black text-amber-500">{data.distinctGuests}</p>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mt-1">Different guests</p>
        </div>

        {/* Attendances: one guest at three events is three */}
        <div className="bg-gradient-to-br from-zinc-900 to-zinc-800 border border-zinc-800 rounded-2xl p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
            <span className="text-4xl">✨</span>
          </div>
          <p className="text-3xl font-black text-violet-500">{data.guestVisits}</p>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mt-1">Guest attendances</p>
        </div>

        {/* Rating */}
        <div className="bg-gradient-to-br from-zinc-900 to-zinc-800 border border-zinc-800 rounded-2xl p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
            <span className="text-4xl">⭐</span>
          </div>
          <div className="flex items-end gap-1.5">
            <p className="text-3xl font-black text-green-400">{data.averageRating > 0 ? data.averageRating : '—'}</p>
            {data.reviewCount > 0 && <span className="text-xs text-zinc-600 font-bold mb-1">({data.reviewCount})</span>}
          </div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mt-1">Average review</p>
        </div>
      </div>
    </div>
  )
}
