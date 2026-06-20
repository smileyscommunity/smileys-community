'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { resolveImageUrl } from '@/lib/data'

interface PastEvent {
  id: string
  title: string
  date: string
  location: string
  emoji: string
  coverImage: string | null
  status: string
  _count: { attendees: number }
  reviews: { rating: number }[]
}

export default function ClubPastEvents({ slug }: { slug: string }) {
  const [events, setEvents]   = useState<PastEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/app/api/clubs/${slug}/past-events`)
      .then(r => r.json())
      .then(d => setEvents(d.events ?? []))
      .finally(() => setLoading(false))
  }, [slug])

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-2xl shadow-card p-4 animate-pulse flex gap-4">
            <div className="w-14 h-14 rounded-xl bg-gray-200 shrink-0" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-3.5 bg-gray-200 rounded w-2/3" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!events.length) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-12 text-center">
        <span className="text-4xl block mb-3">📅</span>
        <p className="text-gray-600">No past events yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {events.map(e => {
        const avgRating = e.reviews.length
          ? (e.reviews.reduce((s, r) => s + r.rating, 0) / e.reviews.length).toFixed(1)
          : null
        const dateStr = new Date(e.date).toLocaleDateString('en-GB', {
          day: 'numeric', month: 'short', year: 'numeric',
        })

        return (
          <Link
            key={e.id}
            href={`/events/${e.id}`}
            className="flex items-center gap-4 bg-white rounded-2xl shadow-card p-4 hover:shadow-md transition-shadow"
          >
            {e.coverImage ? (
              <img
                src={resolveImageUrl(e.coverImage)}
                alt={e.title}
                loading="lazy"
                className="w-14 h-14 rounded-xl object-cover shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-amber-50 flex items-center justify-center text-2xl shrink-0">
                {e.emoji}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{e.title}</p>
              <p className="text-xs text-gray-400 mt-0.5">{dateStr} · {e.location}</p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span className="text-xs text-gray-600">{e._count.attendees} attended</span>
              {avgRating && (
                <span className="text-xs text-amber-500 font-semibold">⭐ {avgRating}</span>
              )}
              {e.status === 'cancelled' && (
                <span className="text-xs text-red-400 font-medium">Cancelled</span>
              )}
            </div>
          </Link>
        )
      })}
    </div>
  )
}
