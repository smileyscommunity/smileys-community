'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { getInitials } from '@/lib/data'

interface EventStub {
  id: string
  title: string
  emoji: string
  date: string
  coverImage?: string | null
}

interface SubmittedReview {
  id: string
  rating: number
  text: string
  createdAt: string
  eventId: string
  event: { id: string; title: string; emoji: string; date: string }
}

function Stars({ value, onClick }: { value: number; onClick?: (n: number) => void }) {
  const [hover, setHover] = useState(0)
  const active = hover || value
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onClick?.(n)}
          onMouseEnter={() => onClick && setHover(n)}
          onMouseLeave={() => onClick && setHover(0)}
          className={`text-2xl leading-none transition-transform ${onClick ? 'cursor-pointer hover:scale-110' : 'cursor-default'} ${n <= active ? 'text-amber-400' : 'text-gray-200'}`}
        >
          ★
        </button>
      ))}
    </div>
  )
}

function ReviewCard({ event, onSubmit }: { event: EventStub; onSubmit: (eventId: string, rating: number, text: string) => Promise<void> }) {
  const [rating,     setRating]     = useState(0)
  const [text,       setText]       = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!rating) { setError('Please select a rating'); return }
    setError('')
    setSubmitting(true)
    await onSubmit(event.id, rating, text)
    setSubmitting(false)
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-xl shrink-0">
          {event.emoji}
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate">{event.title}</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {new Date(event.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <Stars value={rating} onClick={setRating} />
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Share your experience… (optional)"
          rows={3}
          maxLength={1000}
          className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !rating}
          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {submitting ? 'Submitting…' : 'Submit review'}
        </button>
      </form>
    </div>
  )
}

function SubmittedCard({ review, onEdit, onDelete }: {
  review: SubmittedReview
  onEdit:   (id: string, rating: number, text: string) => Promise<void>
  onDelete: (eventId: string) => Promise<void>
}) {
  const [editing,    setEditing]    = useState(false)
  const [rating,     setRating]     = useState(review.rating)
  const [text,       setText]       = useState(review.text)
  const [saving,     setSaving]     = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await onEdit(review.eventId, rating, text)
    setSaving(false)
    setEditing(false)
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center text-xl shrink-0">
          {review.event.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <Link href={`/events/${review.event.id}`} className="font-semibold text-gray-900 text-sm hover:underline leading-tight block truncate">
            {review.event.title}
          </Link>
          <p className="text-xs text-gray-400 mt-0.5">
            {new Date(review.event.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <span className="text-xs text-gray-400 shrink-0">
          {new Date(review.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </span>
      </div>

      {editing ? (
        <form onSubmit={handleSave} className="space-y-3">
          <Stars value={rating} onClick={setRating} />
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
            maxLength={1000}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => { setEditing(false); setRating(review.rating); setText(review.text) }} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-xl transition-colors">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div>
          <Stars value={review.rating} />
          {review.text && <p className="text-sm text-gray-600 mt-2 leading-relaxed">{review.text}</p>}
          <div className="flex items-center gap-4 mt-3">
            <button onClick={() => setEditing(true)} className="text-xs text-amber-600 hover:text-amber-700 font-medium">
              Edit
            </button>
            {confirming ? (
              <span className="text-xs text-gray-500">
                Sure?{' '}
                <button onClick={() => onDelete(review.eventId)} className="text-red-500 hover:text-red-700 font-medium">Yes, delete</button>
                {' · '}
                <button onClick={() => setConfirming(false)} className="hover:text-gray-700">Cancel</button>
              </span>
            ) : (
              <button onClick={() => setConfirming(true)} className="text-xs text-red-400 hover:text-red-600 font-medium">
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ReviewsPage() {
  const [toReview,   setToReview]   = useState<EventStub[]>([])
  const [submitted,  setSubmitted]  = useState<SubmittedReview[]>([])
  const [loading,    setLoading]    = useState(true)
  const [tab,        setTab]        = useState<'pending' | 'submitted'>('pending')

  const load = useCallback(async () => {
    const d = await fetch('/app/api/reviews', { credentials: 'include' }).then(r => r.json())
    setToReview(d.toReview  ?? [])
    setSubmitted(d.submitted ?? [])
  }, [])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  async function handleSubmit(eventId: string, rating: number, text: string) {
    const res = await fetch(`/app/api/events/${eventId}/reviews`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating, text }),
    })
    if (!res.ok) return
    const review = await res.json()
    setToReview(prev => prev.filter(e => e.id !== eventId))
    const event = toReview.find(e => e.id === eventId)!
    setSubmitted(prev => [{ ...review, event: { id: event.id, title: event.title, emoji: event.emoji, date: event.date } }, ...prev])
  }

  async function handleEdit(eventId: string, rating: number, text: string) {
    const res = await fetch(`/app/api/events/${eventId}/reviews`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating, text }),
    })
    if (!res.ok) return
    const updated = await res.json()
    setSubmitted(prev => prev.map(r => r.eventId === eventId ? { ...r, rating: updated.rating, text: updated.text } : r))
  }

  async function handleDelete(eventId: string) {
    const res = await fetch(`/app/api/events/${eventId}/reviews`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!res.ok) return
    const review = submitted.find(r => r.eventId === eventId)
    if (review) {
      setSubmitted(prev => prev.filter(r => r.eventId !== eventId))
      const eventStub = { id: review.event.id, title: review.event.title, emoji: review.event.emoji, date: review.event.date }
      setToReview(prev => [eventStub, ...prev].sort((a, b) => b.date.localeCompare(a.date)))
    }
  }

  const pendingCount   = toReview.length
  const submittedCount = submitted.length

  return (
    <div className="min-h-screen bg-warm pb-20 md:pb-0">
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center gap-3 text-sm text-gray-500 mb-4">
            <Link href="/dashboard" className="hover:text-gray-900 transition-colors">Dashboard</Link>
            <span>/</span>
            <span className="text-gray-900 font-medium">Reviews</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">My Reviews</h1>
          <p className="text-base text-gray-500 mt-1">Rate events you attended and manage your reviews.</p>

          <div className="flex gap-2 mt-5">
            <button
              onClick={() => setTab('pending')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${tab === 'pending' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              To Review {pendingCount > 0 && <span className={`ml-1 text-xs ${tab === 'pending' ? 'text-white/80' : 'text-amber-600'}`}>({pendingCount})</span>}
            </button>
            <button
              onClick={() => setTab('submitted')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${tab === 'submitted' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              Submitted {submittedCount > 0 && <span className={`ml-1 text-xs ${tab === 'submitted' ? 'text-white/80' : 'text-gray-400'}`}>({submittedCount})</span>}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 animate-pulse">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-gray-200 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-200 rounded-full w-2/3" />
                    <div className="h-3 bg-gray-200 rounded-full w-1/3" />
                  </div>
                </div>
                <div className="h-8 bg-gray-200 rounded-lg w-1/2" />
              </div>
            ))}
          </div>
        ) : tab === 'pending' ? (
          pendingCount === 0 ? (
            <div className="text-center py-20 max-w-xs mx-auto">
              <div className="text-6xl mb-4">✨</div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">All reviewed!</h3>
              <p className="text-sm text-gray-500 mb-6">You've reviewed all your past events. Keep attending to share more feedback.</p>
              <Link href="/events" className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors inline-block">
                Browse events
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {toReview.map(event => (
                <ReviewCard key={event.id} event={event} onSubmit={handleSubmit} />
              ))}
            </div>
          )
        ) : (
          submittedCount === 0 ? (
            <div className="text-center py-20 max-w-xs mx-auto">
              <div className="text-6xl mb-4">⭐</div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">No reviews yet</h3>
              <p className="text-sm text-gray-500 mb-6">After attending events, you can rate and share your experience here.</p>
              <button onClick={() => setTab('pending')} className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors">
                See events to review
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {submitted.map(review => (
                <SubmittedCard key={review.id} review={review} onEdit={handleEdit} onDelete={handleDelete} />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
