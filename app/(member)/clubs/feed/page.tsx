'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { getInitials, resolveImageUrl, formatDate, formatShortDate } from '@/lib/data'

interface ClubInfo { id: string; name: string; emoji: string; slug: string }

interface FeedItem {
  type: 'event' | 'post' | 'announcement'
  id: string
  club: ClubInfo
  createdAt: string
  // event fields
  title?: string
  emoji?: string
  date?: string
  time?: string
  neighborhood?: string
  price?: number
  // post/announcement fields
  content?: string
  author?: { id: string; name: string; color: string; photo: string | null }
}

function EventItem({ item }: { item: FeedItem }) {
  return (
    <Link href={`/events/${item.id}`}
      className="block bg-white rounded-2xl shadow-card p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <span className="text-2xl mt-0.5 shrink-0">{item.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Link href={`/clubs/${item.club.slug}`}
              className="text-xs font-semibold text-amber-600 hover:underline shrink-0"
              onClick={e => e.stopPropagation()}>
              {item.club.emoji} {item.club.name}
            </Link>
            <span className="text-xs text-gray-300">·</span>
            <span className="text-xs text-blue-600 font-semibold">New event</span>
          </div>
          <p className="text-sm font-bold text-gray-900 truncate">{item.title}</p>
          <p className="text-xs text-gray-600 mt-0.5">
            {item.date ? formatDate(item.date) : ''}{item.time ? ` · ${item.time}` : ''}{item.neighborhood ? ` · ${item.neighborhood}` : ''}
          </p>
          {item.price !== undefined && (
            <p className="text-xs text-gray-600 mt-1">{item.price === 0 ? 'Free' : `₺${item.price}`}</p>
          )}
        </div>
        <svg className="w-4 h-4 text-gray-300 shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  )
}

function PostItem({ item }: { item: FeedItem }) {
  const photo = item.author ? resolveImageUrl(item.author.photo ?? null) : null
  const isAnnouncement = item.type === 'announcement'

  return (
    <Link href={`/clubs/${item.club.slug}`}
      className="block bg-white rounded-2xl shadow-card p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        {photo ? (
          <img src={photo} alt={item.author?.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
        ) : item.author ? (
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
            style={{ backgroundColor: item.author.color }}>
            {getInitials(item.author.name)}
          </div>
        ) : null}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Link href={`/clubs/${item.club.slug}`}
              className="text-xs font-semibold text-amber-600 hover:underline shrink-0"
              onClick={e => e.stopPropagation()}>
              {item.club.emoji} {item.club.name}
            </Link>
            <span className="text-xs text-gray-300">·</span>
            <span className={`text-xs font-semibold ${isAnnouncement ? 'text-violet-600' : 'text-gray-600'}`}>
              {isAnnouncement
                ? '📣 Announcement'
                : item.author?.name
                  ? `${item.author.name.split(' ')[0]} posted`
                  : 'New post'}
            </span>
          </div>
          <p className="text-sm text-gray-700 line-clamp-2 leading-snug">{item.content}</p>
          <p className="text-xs text-gray-400 mt-1.5">
            {formatShortDate(item.createdAt)}
          </p>
        </div>
      </div>
    </Link>
  )
}

export default function ClubFeedPage() {
  const [items,   setItems]   = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  // Tracks fetch failure separately from empty-list so the UI can
  // distinguish "you have no activity" from "we couldn't load it" —
  // the previous shape rendered the empty state on both, which let
  // a 5xx silently masquerade as "join some clubs to see activity".
  const [error,   setError]   = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(false)
    fetch('/app/api/clubs/feed', { credentials: 'include' })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => setItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="min-h-screen bg-warm pb-16">
      <div className="bg-white/90 backdrop-blur border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/clubs" aria-label="Back" className="p-2.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-base font-bold text-gray-900">Club Feed</h1>
            <p className="text-xs text-gray-400">Your clubs' latest activity</p>
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 pt-5 space-y-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-card p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-8 h-8 bg-gray-200 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-gray-200 rounded w-1/3" />
                  <div className="h-3 bg-gray-200 rounded w-2/3" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
            </div>
          ))
        ) : error ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-sm font-semibold text-gray-600">Couldn&apos;t load the feed</p>
            <p className="text-xs text-gray-400 mt-1">Network blip or the server&apos;s having a moment.</p>
            <button onClick={load}
              className="inline-block mt-4 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">🏛️</div>
            <p className="text-sm font-semibold text-gray-600">No activity yet</p>
            <p className="text-xs text-gray-400 mt-1">Join clubs to see their events and posts here</p>
            <Link href="/clubs" className="inline-block mt-4 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
              Browse clubs
            </Link>
          </div>
        ) : (
          items.map(item => (
            item.type === 'event'
              ? <EventItem key={`event-${item.id}`} item={item} />
              : <PostItem key={`post-${item.id}`} item={item} />
          ))
        )}
      </div>
    </div>
  )
}
