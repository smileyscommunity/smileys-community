'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { resolveImageUrl, getInitials } from '@/lib/data'

interface Visitor {
  id: string
  viewedAt: string
  viewer: {
    id: string
    name: string
    color: string
    photo: string | null
    neighborhood: string | null
    restricted: boolean
  }
}

export default function ProfileVisitorsPage() {
  const [visitors, setVisitors] = useState<Visitor[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    fetch('/app/api/members/profile-views', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setVisitors(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-warm pb-20">
      <div className="bg-white/90 backdrop-blur border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/dashboard" className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-base font-bold text-gray-900">Profile Visitors</h1>
            <p className="text-xs text-gray-400">Last 30 days</p>
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 pt-5">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-4 flex items-center gap-3 animate-pulse">
                <div className="w-12 h-12 rounded-full bg-gray-200 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-gray-200 rounded w-1/3" />
                  <div className="h-3 bg-gray-200 rounded w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : visitors.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-4xl mb-3">👀</div>
            <p className="text-sm font-semibold text-gray-600">No visitors yet</p>
            <p className="text-xs text-gray-400 mt-1">When members view your profile, they'll appear here</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-400 mb-3">{visitors.length} visitor{visitors.length !== 1 ? 's' : ''} in the last 30 days</p>
            {visitors.map(v => {
              const photo = resolveImageUrl(v.viewer.photo ?? null)
              const timeAgo = (() => {
                const diff = Date.now() - new Date(v.viewedAt).getTime()
                const days = Math.floor(diff / 86400000)
                const hours = Math.floor(diff / 3600000)
                if (days > 0) return `${days}d ago`
                if (hours > 0) return `${hours}h ago`
                return 'Just now'
              })()

              const card = (
                <div className="bg-white rounded-2xl p-4 flex items-center gap-3 shadow-card">
                  <div className="relative shrink-0">
                    {photo ? (
                      <img src={photo} alt={v.viewer.name} className={`w-12 h-12 rounded-full object-cover ${v.viewer.restricted ? 'opacity-40' : ''}`} />
                    ) : (
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-bold ${v.viewer.restricted ? 'opacity-40' : ''}`}
                        style={{ backgroundColor: v.viewer.color }}>
                        {getInitials(v.viewer.name)}
                      </div>
                    )}
                    {v.viewer.restricted && (
                      <span className="absolute -bottom-0.5 -right-0.5 text-xs bg-white rounded-full shadow px-0.5">🔒</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{v.viewer.name}</p>
                    {v.viewer.restricted ? (
                      <p className="text-xs text-gray-400">Connections-only profile</p>
                    ) : v.viewer.neighborhood ? (
                      <p className="text-xs text-gray-400 truncate">📍 {v.viewer.neighborhood}</p>
                    ) : null}
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{timeAgo}</span>
                </div>
              )

              return v.viewer.restricted ? (
                <div key={v.id}>{card}</div>
              ) : (
                <Link key={v.id} href={`/members/${v.viewer.id}`} className="block hover:shadow-md transition-shadow rounded-2xl">
                  {card}
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
