'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { getInitials } from '@/lib/data'

interface Review {
  id: string
  rating: number
  text: string
  createdAt: string
  user: { id: string; name: string; color: string }
}

function Stars({ value, onClick }: { value: number; onClick?: (n: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onClick?.(n)}
          className={`text-xl leading-none transition-colors ${onClick ? 'cursor-pointer hover:scale-110' : 'cursor-default'} ${n <= value ? 'text-amber-400' : 'text-gray-200'}`}
        >
          ★
        </button>
      ))}
    </div>
  )
}

export default function EventReviews({ eventId, isPast }: { eventId: string; isPast: boolean }) {
  const { isLoggedIn, user } = useAuth()
  const [reviews,    setReviews]    = useState<Review[]>([])
  const [loading,    setLoading]    = useState(true)
  const [rating,     setRating]     = useState(0)
  const [text,       setText]       = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState('')

  useEffect(() => {
    fetch(`/app/api/events/${eventId}/reviews`)
      .then(r => r.json())
      .then(d => setReviews(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false))
  }, [eventId])

  const myReview  = isLoggedIn ? reviews.find(r => r.user.id === user.id) : null
  const avgRating = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!rating) { setError('Please select a rating'); return }
    setError('')
    setSubmitting(true)
    const res = await fetch(`/app/api/events/${eventId}/reviews`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating, text }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (!res.ok) { setError(data.error ?? 'Failed to submit'); return }
    setReviews(prev => [data, ...prev])
    setRating(0)
    setText('')
  }

  async function deleteReview() {
    const res = await fetch(`/app/api/events/${eventId}/reviews`, {
      method: 'DELETE', credentials: 'include',
    })
    if (res.ok) setReviews(prev => prev.filter(r => r.user.id !== user.id))
  }

  if (loading) return null

  return (
    <div className="bg-white rounded-2xl shadow-card p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Reviews</h2>
          {reviews.length > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <Stars value={Math.round(avgRating)} />
              <span className="text-sm font-semibold text-gray-700">{avgRating.toFixed(1)}</span>
              <span className="text-sm text-gray-400">({reviews.length} review{reviews.length !== 1 ? 's' : ''})</span>
            </div>
          )}
        </div>
      </div>

      {/* Write a review */}
      {isLoggedIn && isPast && !myReview && (
        <form onSubmit={submit} className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-100">
          <div className="text-sm font-semibold text-gray-700">Write a review</div>
          <Stars value={rating} onClick={setRating} />
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Share your experience… (optional)"
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit review'}
          </button>
        </form>
      )}

      {/* Review list */}
      {reviews.length === 0 ? (
        <p className="text-sm text-gray-400">No reviews yet.{isPast ? ' Be the first to share your experience!' : ''}</p>
      ) : (
        <div className="space-y-4">
          {reviews.map(r => (
            <div key={r.id} className="flex gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ backgroundColor: r.user.color }}
              >
                {getInitials(r.user.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{r.user.name}</span>
                    <Stars value={r.rating} />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-gray-400">{new Date(r.createdAt).toLocaleDateString('en-GB')}</span>
                    {isLoggedIn && r.user.id === user.id && (
                      <button onClick={deleteReview} className="text-xs text-red-400 hover:text-red-600 transition-colors">Delete</button>
                    )}
                  </div>
                </div>
                {r.text && <p className="text-sm text-gray-600 mt-1 leading-relaxed">{r.text}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
