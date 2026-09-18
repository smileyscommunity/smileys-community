'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import posthog from 'posthog-js'
import { useAuth } from '@/contexts/AuthContext'
import { firstNameOf } from '@/lib/data'

interface EventHangout { id: string; title: string; startsAt: string; neighborhood: string | null; eventId: string | null }
interface EventPost { id: string; title: string; replyCount: number; user: { name: string } }

function fmtTime(iso: string, tz: string) {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', timeZone: tz,
  })
}

// §30 + §31 — spontaneous plans and conversation around an event, both
// pointing at canonical records: Hangouts owns the plans, Board owns the
// threads. The event page surfaces them, never copies them.
export default function EventConnections({ eventId, citySlug, tz, canPost }: {
  eventId: string
  // The event's city: its hangouts are listed there and their times read in
  // its zone. The viewer's cookie city hid an İzmir event's hangouts from an
  // Istanbul reader and printed their times in the wrong zone.
  citySlug: string | null
  tz: string
  // Someone on the event (host, co-host, confirmed guest, staff) — they can
  // start its conversation; the server checks the same.
  canPost: boolean
}) {
  const { isLoggedIn } = useAuth()
  const cityQs = citySlug ? `city=${encodeURIComponent(citySlug)}` : ''
  const [hangouts, setHangouts] = useState<EventHangout[]>([])
  const [posts,    setPosts]    = useState<EventPost[]>([])
  const [loaded,   setLoaded]   = useState(false)

  useEffect(() => {
    Promise.all([
      // Hangouts are member-only; guests skip the call rather than
      // collecting a 401 in the console.
      isLoggedIn
        ? fetch(`/app/api/hangouts${cityQs ? `?${cityQs}` : ''}`, { credentials: 'include' })
            .then(r => r.ok ? r.json() : { hangouts: [] }).catch(() => ({ hangouts: [] }))
        : Promise.resolve({ hangouts: [] }),
      fetch(`/app/api/board?event=${encodeURIComponent(eventId)}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : { posts: [] }).catch(() => ({ posts: [] })),
    ]).then(([h, b]) => {
      setHangouts(((h.hangouts ?? []) as EventHangout[]).filter(x => x.eventId === eventId).slice(0, 3))
      setPosts((b.posts ?? []).slice(0, 3))
      setLoaded(true)
    })
  }, [eventId, isLoggedIn, cityQs])

  // Nothing could ever be posted here (no composer sent an event), so the
  // section never showed. Now someone on the event can start it.
  if (!loaded || (hangouts.length === 0 && posts.length === 0 && !canPost)) return null
  const composeHref = `/board?compose=1&event=${encodeURIComponent(eventId)}${cityQs ? `&${cityQs}` : ''}`

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
                    🕐 {fmtTime(h.startsAt, tz)}{h.neighborhood && <> · 📍 {h.neighborhood}</>}
                  </p>
                </div>
                <span className="shrink-0 text-xs font-bold text-amber-600">Join →</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {(posts.length > 0 || canPost) && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-900">Conversation</h2>
            {canPost && posts.length > 0 && (
              <Link href={composeHref} className="text-xs font-bold text-amber-600 hover:underline">New post →</Link>
            )}
          </div>
          {posts.length === 0 && (
            <Link href={composeHref}
              className="flex items-center gap-3 bg-gray-50 border border-dashed border-gray-200 rounded-2xl px-4 py-3 hover:border-amber-300 transition-colors">
              <span aria-hidden="true" className="shrink-0">💬</span>
              <span className="flex-1 text-sm text-gray-600">Ask the group something before you meet — who&apos;s bringing what, where to find each other.</span>
              <span className="shrink-0 text-xs font-bold text-amber-600">Start →</span>
            </Link>
          )}
          <div className="space-y-2">
            {posts.map(p => (
              <Link key={p.id} href={`/board?post=${p.id}${cityQs ? `&${cityQs}` : ''}`}
                onClick={() => posthog.capture('event_to_board', { eventId, postId: p.id })}
                className="flex items-center gap-3 bg-white border border-gray-100 rounded-2xl px-4 py-3 hover:border-amber-200 hover:shadow-sm transition-all group">
                <span aria-hidden="true" className="shrink-0">💬</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate group-hover:text-amber-700 transition-colors">{p.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{firstNameOf(p.user.name)}</p>
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
