'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { resolveImageUrl, getInitials } from '@/lib/data'
import EmptyState from '@/components/EmptyState'
import { SkeletonList } from '@/components/Skeleton'
import { readInbox, type Conversation } from './messageData'
import { timeAgo } from './messageTime'

function Avatar({ user }: { user: { name: string; color: string; profilePhoto: string | null } }) {
  const photo = resolveImageUrl(user.profilePhoto)
  return (
    <div className="w-12 h-12 rounded-full shrink-0 overflow-hidden flex items-center justify-center text-white text-sm font-bold"
      style={{ backgroundColor: user.color }}>
      {photo ? <img src={photo} alt={user.name} className="w-full h-full object-cover" /> : getInitials(user.name)}
    </div>
  )
}

export default function MessagesPage() {
  // null means "nothing has loaded yet" — distinct from an inbox the server
  // says is empty, which is the only thing that may show the empty state.
  const [convs,       setConvs]       = useState<Conversation[] | null>(null)
  const [totalUnread, setTotalUnread] = useState(0)
  const [stale,       setStale]       = useState(false)
  const [loading,     setLoading]     = useState(true)

  const load = useCallback(async () => {
    // Polls every 5s. A failed tick must change nothing: this used to write
    // `Array.isArray(d) ? d : []`, so every blip — offline, a deploy restart,
    // a backgrounded tab — wiped the list to "No messages yet" and the next
    // tick put it back.
    try {
      const res = await fetch('/app/api/messages', { credentials: 'include' })
      const inbox = readInbox(res.ok ? await res.json().catch(() => null) : null)
      if (!inbox) { setStale(true); return }
      setConvs(inbox.conversations)
      setTotalUnread(inbox.totalUnread)
      setStale(false)
    } catch { setStale(true) }
  }, [])

  useEffect(() => {
    load().finally(() => setLoading(false))
    const timer = setInterval(load, 5_000)
    return () => clearInterval(timer)
  }, [load])

  return (
    <div className="min-h-screen bg-warm pb-20 md:pb-0">
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="max-w-3xl">
          <div className="flex items-center gap-3 text-sm text-gray-600 mb-4">
            <Link href="/dashboard" className="hover:text-gray-900 transition-colors">Dashboard</Link>
            <span>/</span>
            <span className="text-gray-900 font-medium">Messages</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">Messages</h1>
              <p className="text-base text-gray-600 mt-1">{totalUnread > 0 ? `${totalUnread} unread` : 'Your conversations'}</p>
            </div>
          </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="max-w-3xl">
        {/* A refresh that didn't land says so instead of rearranging the page
            — what's below is still the last good answer. */}
        {stale && (
          <p role="status" className="mb-3 text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
            Couldn&apos;t refresh — retrying…
          </p>
        )}
        {loading || !convs ? (
          <SkeletonList rows={3} />
        ) : convs.length === 0 ? (
          <EmptyState
            icon="💬"
            title="No messages yet"
            body="Start a conversation from any member's profile."
            action={{ label: 'Browse members', href: '/members' }}
          />
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-100">
            {convs.map(c => (
              <Link
                key={c.partner.id}
                href={`/messages/${c.partner.id}`}
                className={`flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors ${c.unread > 0 ? 'bg-amber-50/40' : ''}`}
              >
                <div className="relative">
                  <Avatar user={c.partner} />
                  {c.unread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-amber-500 text-white text-xs font-bold rounded-full flex items-center justify-center px-1">
                      {c.unread > 9 ? '9+' : c.unread}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className={`text-sm font-semibold text-gray-900 truncate min-w-0 ${c.unread > 0 ? 'font-bold' : ''}`}>{c.partner.name}</span>
                    <span className="text-xs text-gray-400 shrink-0">{timeAgo(c.lastAt)}</span>
                  </div>
                  <p className={`text-sm truncate ${c.unread > 0 ? 'text-gray-900 font-medium' : 'text-gray-600'}`}>
                    {/* A photo with no caption is still something to see. */}
                    {c.preview.hasImage && !c.preview.text ? '📷 Photo' : c.preview.text}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
