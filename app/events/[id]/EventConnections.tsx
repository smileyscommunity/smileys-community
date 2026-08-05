'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import posthog from 'posthog-js'
import { useAuth } from '@/contexts/AuthContext'

interface EventHangout { id: string; title: string; startsAt: string; neighborhood: string | null; eventId: string | null }
interface EventPost { id: string; title: string; replyCount: number; user: { name: string } }

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', timeZone: 'Europe/Istanbul',
  })
}

// §30 + §31 — spontaneous plans and conversation around an event, both
// pointing at canonical records: Hangouts owns the plans, Board owns the
// threads. The event page surfaces them, never copies them.
export default function EventConnections({ eventId }: { eventId: string }) {
  const { isLoggedIn } = useAuth()
  const [hangouts, setHangouts] = useState<EventHangout[]>([])
  const [posts,    setPosts]    = useState<EventPost[]>([])
  const [loaded,   setLoaded]   = useState(false)

  useEffect(() => {
    Promise.all([
      // Hangouts are member-only; guests skip the call rather than
      // collecting a 401 in the console.
      isLoggedIn
        ? fetch('/app/api/hangouts', { credentials: 'include' })
            .then(r => r.ok ? r.json() : { hangouts: [] }).catch(() => ({ hangouts: [] }))
        : Promise.resolve({ hangouts: [] }),
      fetch(`/app/api/board?event=${encodeURIComponent(eventId)}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : { posts: [] }).catch(() => ({ posts: [] })),
    ]).then(([h, b]) => {
      setHangouts(((h.hangouts ?? []) as EventHangout[]).filter(x => x.eventId === eventId).slice(0, 3))
      setPosts((b.posts ?? []).slice(0, 3))
      setLoaded(true)
    })
  }, [eventId, isLoggedIn])

  if (!loaded || (hangouts.length === 0 && posts.length === 0)) return null

  return (
    <div className="space-y-6">
      {hangouts.length > 0 && (
        <div>
          <h2 className="text-base font-bold text-gray-900 mb-3">Before &amp; after</h2>
          <div className="space-y-2">
            {hangouts.map(h => (
              <Link key={h.id} href={`/hangouts/${h.id}`}
                onClick={() => posthog.capture('event_to_hangout', { eventId, hangoutId: h.id })}
                className="flex items-center gap-3 bg-white border border-gray-100 rounded-2xl px-4 py-3 hover:border-amber-200 hover:shadow-sm transition-all group">
                <span aria-hidden="true" className="shrink-0">⚡</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate group-hover:text-amber-700 transition-colors">{h.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    🕐 {fmtTime(h.startsAt)}{h.neighborhood && <> · 📍 {h.neighborhood}</>}
                  </p>
                </div>
                <span className="shrink-0 text-xs font-bold text-amber-600">Join →</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {posts.length > 0 && (
        <div>
          <h2 className="text-base font-bold text-gray-900 mb-3">Conversation</h2>
          <div className="space-y-2">
            {posts.map(p => (
              <Link key={p.id} href={`/board?post=${p.id}`}
                onClick={() => posthog.capture('event_to_board', { eventId, postId: p.id })}
                className="flex items-center gap-3 bg-white border border-gray-100 rounded-2xl px-4 py-3 hover:border-amber-200 hover:shadow-sm transition-all group">
                <span aria-hidden="true" className="shrink-0">💬</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate group-hover:text-amber-700 transition-colors">{p.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{p.user.name.split(' ')[0]}</p>
                </div>
                <span className="shrink-0 text-xs font-bold text-amber-600">
                  {p.replyCount > 0 ? `${p.replyCount} 💬` : 'Reply →'}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
