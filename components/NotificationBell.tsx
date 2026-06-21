'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Notification {
  id: string; type: string; title: string; body: string
  isRead: boolean; link: string | null; createdAt: string
}

const TYPE_ICON: Record<string, string> = {
  rsvp:                '🎉',
  rsvp_pending:        '⏳',
  waitlist:            '📋',
  waitlist_promoted:   '✅',
  club_approved:       '🏛️',
  club_rejected:       '❌',
  new_event:           '📣',
  attendee_joined:     '🙌',
  review_request:      '⭐',
  event_updated:       '📅',
  event_cancelled:     '😔',
  host_assigned:       '🎖️',
  host_message:        '📨',
  reminder_24h:        '⏰',
  reminder_2h:         '⚡',
  message:             '💬',
  warning:             '⚠️',
  announcement:        '📢',
  system_alert:        '🚨',
  alert:               '🚨',
  reminder:            '⏰',
  club_wall_post:      '📝',
  club_post_reply:     '💬',
  club_mention:        '💬',
  // Admin/moderator-only — distinct icon so directory submissions
  // stand out from generic 'system' bell entries.
  directory_submission: '📋',
  membership_upgraded:  '⭐',
  connection_request:  '🤝',
  connection_accepted: '🤝',
  report:              '🚩',
  application:         '👤',
  event_survey:        '✍️',
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function NotificationBell() {
  const [open,   setOpen]   = useState(false)
  const [notifs, setNotifs] = useState<Notification[]>([])
  const router = useRouter()
  const ref    = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    fetch('/app/api/notifications', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setNotifs(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  // Initial load + poll every 60s
  useEffect(() => {
    load()
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [load])

  // Close on outside click
  useEffect(() => {
    function onClickOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOut)
    return () => document.removeEventListener('mousedown', onClickOut)
  }, [])

  const unread  = notifs.filter(n => !n.isRead).length
  const preview = notifs.slice(0, 6)

  async function markAllRead() {
    await fetch('/app/api/notifications', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAll: true }),
    })
    setNotifs(prev => prev.map(n => ({ ...n, isRead: true })))
  }

  async function dismiss(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    await fetch('/app/api/notifications', {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setNotifs(prev => prev.filter(n => n.id !== id))
  }

  async function handleClick(n: Notification) {
    if (!n.isRead) {
      await fetch('/app/api/notifications', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: n.id }),
      })
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x))
    }
    setOpen(false)
    if (n.link) router.push(n.link)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-xl hover:bg-gray-100 transition-colors"
        aria-label="Notifications"
      >
        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-1rem)] bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="font-semibold text-sm text-gray-900">
              Notifications {unread > 0 && <span className="ml-1 text-xs text-amber-600">({unread} new)</span>}
            </span>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button onClick={markAllRead} className="text-xs text-amber-600 hover:underline font-medium">
                  Mark all read
                </button>
              )}
              <Link href="/notifications/settings" onClick={() => setOpen(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </Link>
            </div>
          </div>

          {/* List */}
          <div className="divide-y divide-gray-50">
            {notifs.length === 0 ? (
              <p className="px-4 py-8 text-sm text-gray-400 text-center">All caught up 🎉</p>
            ) : (
              preview.map(n => (
                <div key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors group cursor-pointer ${!n.isRead ? 'bg-amber-50/40' : ''}`}
                  onClick={() => handleClick(n)}
                >
                  <span className="text-lg shrink-0 mt-0.5">{TYPE_ICON[n.type] ?? '🔔'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 leading-snug">{n.title}</div>
                    <div className="text-xs text-gray-600 mt-0.5 leading-relaxed line-clamp-2">{n.body}</div>
                    {n.type === 'event_survey' && n.link && (
                      <a
                        href={n.link}
                        onClick={e => e.stopPropagation()}
                        className="inline-block mt-1.5 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold rounded-lg transition-colors"
                      >
                        Leave feedback →
                      </a>
                    )}
                    <div className="text-xs text-gray-400 mt-1">{timeAgo(n.createdAt)}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {!n.isRead && <span className="w-2 h-2 bg-amber-500 rounded-full" />}
                    <button
                      onClick={e => dismiss(e, n.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-300 hover:text-gray-600 transition-all"
                      title="Dismiss"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-100 flex">
            <Link href="/notifications" onClick={() => setOpen(false)}
              className="flex-1 text-center text-xs font-medium text-amber-600 hover:text-amber-700 py-3">
              {notifs.length > 6 ? `View all ${notifs.length} →` : 'View all →'}
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
