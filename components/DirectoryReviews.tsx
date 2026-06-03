'use client'

// Reviews drawer used by the public /directory page. Opens when a
// member clicks the rating badge or "Reviews" link on a card. Shows
// the full review list + the caller's own submission form (when
// logged in) + the verified-owner reply UI when the caller is the
// owner of the business.
//
// Kept as a separate file because the directory page is already
// substantial and the review surface is self-contained — pulling it
// out keeps both files easier to scan.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { avatarUrl } from '@/lib/data'

interface ReviewAuthor { id: string; name: string; color: string; profilePhoto: string | null }
interface ReviewOwnerReplyBy { id: string; name: string }

export interface Review {
  id: string
  rating: number
  comment: string | null
  ownerReply:     string | null
  ownerReplyAt:   string | null
  ownerReplyBy:   ReviewOwnerReplyBy | null
  isHidden: boolean
  createdAt: string
  author: ReviewAuthor
}

interface Props {
  businessId:    string
  businessName:  string
  isLoggedIn:    boolean
  currentUserId: string | null
  // True when the current viewer is the verified owner — controls
  // visibility of the reply UI under each review (and hides the form
  // to leave a self-review).
  isOwner:       boolean
  // Called after a write so the caller can refresh the aggregate
  // ratings shown on the card.
  onChange?:     () => void
  onClose:       () => void
}

const RATING_LABELS: Record<number, string> = {
  1: 'Awful', 2: 'Poor', 3: 'OK', 4: 'Good', 5: 'Loved it',
}

function Stars({ value, size = 'sm', interactive = false, onChange }:
  { value: number; size?: 'sm' | 'lg'; interactive?: boolean; onChange?: (v: number) => void })
{
  const text = size === 'lg' ? 'text-2xl' : 'text-sm'
  return (
    <div className={`flex gap-0.5 ${text} leading-none`}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          disabled={!interactive}
          onClick={() => interactive && onChange?.(n)}
          className={`${interactive ? 'cursor-pointer hover:scale-110' : 'cursor-default'} transition-transform`}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
        >
          <span className={n <= value ? 'text-amber-500' : 'text-gray-300'}>★</span>
        </button>
      ))}
    </div>
  )
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s  = Math.floor(ms / 1000)
  if (s < 60)   return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60)   return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)   return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30)   return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function DirectoryReviews({
  businessId, businessName, isLoggedIn, currentUserId, isOwner, onChange, onClose,
}: Props) {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [rating,  setRating]  = useState(0)
  const [comment, setComment] = useState('')
  const [busy,    setBusy]    = useState(false)

  // Reply state — per-review map keyed by review id so the owner can
  // start replies to multiple reviews without losing state.
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({})
  const [replyOpen,  setReplyOpen]  = useState<Record<string, boolean>>({})

  const myReview = currentUserId ? reviews.find(r => r.author.id === currentUserId) : null

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch(`/app/api/directory/${businessId}/reviews`, { credentials: 'include' })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        toast.error(d?.error || `Couldn't load reviews (HTTP ${r.status})`)
        return
      }
      const d = await r.json()
      const list: Review[] = Array.isArray(d?.reviews) ? d.reviews : []
      setReviews(list)
      const mine = currentUserId ? list.find(rv => rv.author.id === currentUserId) : null
      if (mine) {
        setRating(mine.rating)
        setComment(mine.comment ?? '')
      }
    } catch {
      toast.error('Network error — could not load reviews')
    } finally {
      setLoading(false)
    }
  }

  // Re-load whenever the drawer is opened for a different business.
  // currentUserId can change mid-render (auth bootstrap on mount), so
  // we depend on it too — otherwise myReview hydrates as null on first
  // render and never refreshes.
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [businessId, currentUserId])

  async function submitReview(e: React.FormEvent) {
    e.preventDefault()
    if (rating < 1 || rating > 5) {
      toast.error('Pick a rating from 1 to 5 stars')
      return
    }
    setBusy(true)
    try {
      const r = await fetch(`/app/api/directory/${businessId}/reviews`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d?.error || 'Failed to submit'); return }
      toast.success(myReview ? 'Review updated' : 'Review posted')
      await load()
      onChange?.()
    } catch {
      toast.error('Network error')
    } finally {
      setBusy(false)
    }
  }

  async function deleteReview() {
    if (!myReview) return
    if (!confirm('Delete your review?')) return
    try {
      const r = await fetch(`/app/api/directory/${businessId}/reviews/${myReview.id}`, {
        method: 'DELETE', credentials: 'include',
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        toast.error(d?.error || 'Failed to delete'); return
      }
      toast.success('Review deleted')
      setRating(0); setComment('')
      await load()
      onChange?.()
    } catch {
      toast.error('Network error')
    }
  }

  async function submitReply(reviewId: string) {
    const text = (replyDraft[reviewId] ?? '').trim()
    if (!text) { toast.error('Reply text required'); return }
    try {
      const r = await fetch(`/app/api/directory/${businessId}/reviews/${reviewId}/reply`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply: text }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d?.error || 'Failed to reply'); return }
      toast.success('Reply posted')
      setReplyOpen(s => ({ ...s, [reviewId]: false }))
      setReplyDraft(s => ({ ...s, [reviewId]: '' }))
      await load()
    } catch {
      toast.error('Network error')
    }
  }

  async function deleteReply(reviewId: string) {
    if (!confirm('Clear your reply?')) return
    try {
      const r = await fetch(`/app/api/directory/${businessId}/reviews/${reviewId}/reply`, {
        method: 'DELETE', credentials: 'include',
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        toast.error(d?.error || 'Failed to clear'); return
      }
      toast.success('Reply cleared')
      await load()
    } catch {
      toast.error('Network error')
    }
  }

  // Aggregate display from the loaded list (filtered to non-hidden).
  // We compute locally rather than re-fetching the directory just to
  // refresh the badge inside the drawer header.
  const visible = reviews.filter(r => !r.isHidden)
  const avg = visible.length > 0
    ? visible.reduce((sum, r) => sum + r.rating, 0) / visible.length
    : null

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-xl sm:rounded-2xl rounded-t-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-gray-900 truncate">{businessName}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Stars value={Math.round(avg ?? 0)} />
              <span className="text-xs text-gray-500">
                {avg != null ? `${avg.toFixed(1)} · ${visible.length} review${visible.length === 1 ? '' : 's'}` : 'No reviews yet'}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none shrink-0" aria-label="Close">×</button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Write/edit form. Owners can't review their own listing. */}
          {isLoggedIn && !isOwner && (
            <form onSubmit={submitReview} className="bg-amber-50 border border-amber-100 rounded-xl p-3 space-y-2">
              <p className="text-xs font-bold text-amber-900">
                {myReview ? 'Edit your review' : 'Share your experience'}
              </p>
              <div className="flex items-center gap-3">
                <Stars value={rating} size="lg" interactive onChange={setRating} />
                {rating > 0 && <span className="text-xs text-amber-700 font-medium">{RATING_LABELS[rating]}</span>}
              </div>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                maxLength={1500}
                rows={3}
                placeholder="What was it like? (optional)"
                className="w-full text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy || rating < 1}
                  className="text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
                >
                  {busy ? 'Saving…' : myReview ? 'Update review' : 'Post review'}
                </button>
                {myReview && (
                  <button
                    type="button"
                    onClick={deleteReview}
                    className="text-xs font-semibold text-red-600 hover:text-red-700 px-3 py-1.5 transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </form>
          )}

          {!isLoggedIn && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-600">
                <Link href={`/login?next=${encodeURIComponent('/directory')}`} className="font-semibold text-amber-700 hover:underline">Log in</Link>
                {' '}or{' '}
                <Link href="/apply" className="font-semibold text-amber-700 hover:underline">apply to join</Link>
                {' '}to write a review.
              </p>
            </div>
          )}

          {isOwner && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
              <p className="text-[11px] text-emerald-800">
                You're the verified owner. You can reply to reviews below but can't review your own business.
              </p>
            </div>
          )}

          {/* Reviews list */}
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          ) : reviews.length === 0 ? (
            <div className="text-center py-10 text-sm text-gray-400">
              No reviews yet. Be the first.
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map(r => {
                const avatar = r.author.profilePhoto ? avatarUrl(r.author.profilePhoto, 64) : null
                return (
                  <div key={r.id} className={`bg-white border rounded-xl p-3 space-y-2 ${r.isHidden ? 'border-red-200 bg-red-50/30' : 'border-gray-100'}`}>
                    <div className="flex items-start gap-2.5">
                      {avatar ? (
                        <img src={avatar} alt={r.author.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                          style={{ backgroundColor: r.author.color }}>
                          {r.author.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-gray-900 truncate">{r.author.name}</p>
                          <Stars value={r.rating} />
                          {r.isHidden && (
                            <span className="text-[10px] font-semibold text-red-600 bg-red-100 rounded-full px-2 py-0.5">Hidden by admin</span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-400 mt-0.5">{timeAgo(r.createdAt)}</p>
                      </div>
                    </div>
                    {r.comment && (
                      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{r.comment}</p>
                    )}

                    {/* Owner reply — either renders the existing reply
                        or, for the verified owner, lets them write one. */}
                    {r.ownerReply ? (
                      <div className="bg-emerald-50/60 border border-emerald-100 rounded-lg p-2.5 mt-2">
                        <p className="text-[11px] font-bold text-emerald-800 mb-1">
                          ✓ Owner's response{r.ownerReplyAt ? ` · ${timeAgo(r.ownerReplyAt)}` : ''}
                        </p>
                        <p className="text-xs text-emerald-900 whitespace-pre-wrap leading-relaxed">{r.ownerReply}</p>
                        {isOwner && (
                          <button
                            onClick={() => deleteReply(r.id)}
                            className="text-[10px] text-emerald-700 hover:text-red-600 hover:underline mt-1.5"
                          >
                            Clear reply
                          </button>
                        )}
                      </div>
                    ) : isOwner && (
                      replyOpen[r.id] ? (
                        <div className="bg-emerald-50/60 border border-emerald-100 rounded-lg p-2.5 space-y-2">
                          <textarea
                            value={replyDraft[r.id] ?? ''}
                            onChange={e => setReplyDraft(s => ({ ...s, [r.id]: e.target.value }))}
                            maxLength={1000}
                            rows={2}
                            placeholder="Thanks for the feedback — we…"
                            className="w-full text-xs bg-white border border-emerald-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none"
                          />
                          <div className="flex gap-2">
                            <button onClick={() => submitReply(r.id)}
                              className="text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-2.5 py-1 transition-colors">
                              Post reply
                            </button>
                            <button onClick={() => setReplyOpen(s => ({ ...s, [r.id]: false }))}
                              className="text-[10px] font-semibold text-gray-500 hover:text-gray-700 px-2 py-1 transition-colors">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setReplyOpen(s => ({ ...s, [r.id]: true }))}
                          className="text-[11px] font-semibold text-emerald-700 hover:underline">
                          Reply as owner
                        </button>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
