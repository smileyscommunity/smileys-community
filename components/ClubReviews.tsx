'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { avatarUrl, getInitials } from '@/lib/data'

interface Review {
  id: string
  rating: number
  text: string
  createdAt: string
  user:  { id: string; name: string; color: string; profilePhoto: string | null }
  event: { id: string; title: string }
}

export default function ClubReviews({ slug, isMember }: { slug: string; isMember: boolean }) {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading]  = useState(true)

  useEffect(() => {
    if (!isMember) { setLoading(false); return }
    fetch(`/app/api/clubs/${slug}/reviews`)
      .then(r => r.json())
      .then(d => setReviews(d.reviews ?? []))
      .finally(() => setLoading(false))
  }, [slug, isMember])

  if (!isMember) return (
    <div className="text-center py-16">
      <span className="text-4xl block mb-3">🔒</span>
      <p className="font-semibold text-gray-900 mb-1">Members only</p>
      <p className="text-gray-600 text-sm">Join this club to see member reviews.</p>
    </div>
  )

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-2xl shadow-card p-5 animate-pulse">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-gray-200" />
              <div className="space-y-1.5">
                <div className="h-3 w-28 bg-gray-200 rounded" />
                <div className="h-3 w-20 bg-gray-100 rounded" />
              </div>
            </div>
            <div className="h-3 w-full bg-gray-100 rounded mb-2" />
            <div className="h-3 w-2/3 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (!reviews.length) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-12 text-center">
        <span className="text-4xl block mb-3">⭐</span>
        <p className="text-gray-600">No reviews yet. Attend an event and be the first!</p>
      </div>
    )
  }

  const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length

  return (
    <div>
      <div className="bg-white rounded-2xl shadow-card px-6 py-5 mb-5 flex items-center gap-6">
        <div className="text-center">
          <p className="text-4xl font-extrabold text-gray-900">{avg.toFixed(1)}</p>
          <Stars rating={avg} />
          <p className="text-xs text-gray-400 mt-1">{reviews.length} review{reviews.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex-1 space-y-1.5">
          {[5, 4, 3, 2, 1].map(n => {
            const count = reviews.filter(r => r.rating === n).length
            const pct   = Math.round((count / reviews.length) * 100)
            return (
              <div key={n} className="flex items-center gap-2 text-xs text-gray-600">
                <span className="w-4 text-right">{n}</span>
                <svg className="w-3 h-3 text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-6 text-right">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="space-y-4">
        {reviews.map(r => (
          <div key={r.id} className="bg-white rounded-2xl shadow-card p-5">
            <div className="flex items-start gap-3">
              <Avatar user={r.user} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">{r.user.name}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                <Stars rating={r.rating} />
                <Link
                  href={`/events/${r.event.id}`}
                  className="text-xs text-amber-600 hover:underline mt-0.5 inline-block"
                >
                  {r.event.title}
                </Link>
                {r.text && (
                  <p className="text-sm text-gray-700 mt-2 leading-relaxed">{r.text}</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5 mt-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <svg
          key={n}
          className={`w-3.5 h-3.5 ${n <= Math.round(rating) ? 'text-amber-400' : 'text-gray-200'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  )
}

function Avatar({ user }: { user: Review['user'] }) {
  const photo = avatarUrl(user.profilePhoto, 64)
  if (photo) {
    return <img src={photo} alt={user.name} loading="lazy" className="w-9 h-9 rounded-full object-cover shrink-0" />
  }
  return (
    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: user.color }}>
      {getInitials(user.name)}
    </div>
  )
}
