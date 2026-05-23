'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

interface ImpactData {
  eventsHosted:   number
  totalAttendees: number
  uniqueMembers:  number
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

  if (!data || data.eventsHosted === 0) return null

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-4 px-1">
        <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Your Community Impact</h2>
        <span className="text-xs text-zinc-600 font-medium italic">Vanity metrics for being an awesome host</span>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Events */}
        <div className="bg-gradient-to-br from-zinc-900 to-zinc-800 border border-zinc-800 rounded-2xl p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
            <span className="text-4xl">🗓️</span>
          </div>
          <p className="text-3xl font-black text-white">{data.eventsHosted}</p>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mt-1">Events Hosted</p>
        </div>

        {/* Unique Reach */}
        <div className="bg-gradient-to-br from-zinc-900 to-zinc-800 border border-zinc-800 rounded-2xl p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
            <span className="text-4xl">🤝</span>
          </div>
          <p className="text-3xl font-black text-amber-500">{data.uniqueMembers}</p>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mt-1">Unique Members</p>
        </div>

        {/* Total Impact */}
        <div className="bg-gradient-to-br from-zinc-900 to-zinc-800 border border-zinc-800 rounded-2xl p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
            <span className="text-4xl">✨</span>
          </div>
          <p className="text-3xl font-black text-violet-500">{data.totalAttendees}</p>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mt-1">Social Moments</p>
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
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mt-1">Host Rating</p>
        </div>
      </div>
    </div>
  )
}
