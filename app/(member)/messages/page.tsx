'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { resolveImageUrl, getInitials } from '@/lib/data'
import EmptyState from '@/components/EmptyState'
import { SkeletonList } from '@/components/Skeleton'

interface Conversation {
  partner: { id: string; name: string; color: string; profilePhoto: string | null }
  lastMessage: { text: string; fromMe: boolean; createdAt: string }
  unread: number
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7)  return `${d}d ago`
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

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
  const [convs,   setConvs]   = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    // Polls every 5s — swallow transient network failures (offline, tab
    // backgrounded, deploy blip). An uncaught reject here fired "Failed to
    // fetch" into error tracking on every hiccup; the next tick recovers.
    try {
      const d = await fetch('/app/api/messages', { credentials: 'include' }).then(r => r.json())
      setConvs(Array.isArray(d) ? d : [])
    } catch { /* transient — next poll retries */ }
  }, [])

  useEffect(() => {
    load().finally(() => setLoading(false))
    const timer = setInterval(load, 5_000)
    return () => clearInterval(timer)
  }, [load])

  const totalUnread = convs.reduce((s, c) => s + c.unread, 0)

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
        {loading ? (
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
                    <span className="text-xs text-gray-400 shrink-0">{timeAgo(c.lastMessage.createdAt)}</span>
                  </div>
                  <p className={`text-sm truncate ${c.unread > 0 ? 'text-gray-900 font-medium' : 'text-gray-600'}`}>
                    {c.lastMessage.fromMe && <span className="text-gray-400">You: </span>}
                    {c.lastMessage.text}
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
