'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { getInitials, resolveImageUrl } from '@/lib/data'
import { formatDate } from '@/lib/data'

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
  totalSpots?: number
  spotsLeft?: number
  price?: number
  // post/announcement fields
  content?: string
  isPinned?: boolean
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
          <p className="text-xs text-gray-500 mt-0.5">
            {item.date ? formatDate(item.date) : ''}{item.time ? ` · ${item.time}` : ''}{item.neighborhood ? ` · ${item.neighborhood}` : ''}
          </p>
          {item.price !== undefined && (
            <p className="text-xs text-gray-400 mt-1">{item.price === 0 ? 'Free' : `₺${item.price}`}</p>
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
            <span className={`text-xs font-semibold ${isAnnouncement ? 'text-violet-600' : 'text-gray-500'}`}>
              {isAnnouncement ? '📣 Announcement' : `${item.author?.name.split(' ')[0]} posted`}
            </span>
          </div>
          <p className="text-sm text-gray-700 line-clamp-2 leading-snug">{item.content}</p>
          <p className="text-xs text-gray-400 mt-1.5">
            {new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </p>
        </div>
      </div>
    </Link>
  )
}

export default function ClubFeedPage() {
  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/app/api/clubs/feed', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { items: [] })
      .then(d => setItems(Array.isArray(d.items) ? d.items : []))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-warm pb-16">
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/clubs" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
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
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">🏛️</div>
            <p className="text-sm font-semibold text-gray-600">No activity yet</p>
            <p className="text-xs text-gray-400 mt-1">Join clubs to see their events and posts here</p>
            <Link href="/clubs" className="inline-block mt-4 px-4 py-2 bg-amber-400 text-white text-sm font-bold rounded-xl">
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
