'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import SwipeRow from '@/components/SwipeRow'
import EmptyState from '@/components/EmptyState'
import { SkeletonList } from '@/components/Skeleton'

interface Notification {
  id:        string
  type:      string
  title:     string
  body:      string
  isRead:    boolean
  link:      string | null
  createdAt: string
}

type Filter = 'All' | 'Events' | 'Social' | 'Admin'

const FILTERS: Filter[] = ['All', 'Events', 'Social', 'Admin']

const FILTER_TYPES: Record<Filter, string[]> = {
  All:    [],
  Events: ['new_event', 'event_updated', 'reminder_24h', 'reminder_2h', 'attendee_joined', 'review_request', 'event_survey'],
  Social: ['rsvp', 'rsvp_pending', 'waitlist', 'waitlist_promoted'],
  Admin:  ['club_approved', 'club_rejected', 'host_assigned'],
}

const TYPE_ICON: Record<string, string> = {
  checkin:             '✅',
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
  const d = Math.floor(h / 24)
  if (d < 7)  return `${d}d ago`
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function NotificationsPage() {
  const [notifications,  setNotifications]  = useState<Notification[]>([])
  const [loading,        setLoading]        = useState(true)
  const [filter,         setFilter]         = useState<Filter>('All')
  const [confirmClear,   setConfirmClear]   = useState(false)
  const [clearing,       setClearing]       = useState(false)
  const clearedAt = useRef<number>(0)
  const router = useRouter()

  const load = useCallback(async () => {
    // Don't overwrite a just-cleared state — wait 2s after clearAll before
    // allowing a re-fetch, otherwise the visibilitychange listener can race
    // and refill the list with pre-delete data.
    if (Date.now() - clearedAt.current < 2000) return
    const d = await fetch('/app/api/notifications', { credentials: 'include' }).then(r => r.json())
    setNotifications(Array.isArray(d) ? d : [])
  }, [])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  // Re-fetch when the tab becomes visible again (handles back-navigation from
  // a linked notification where the router cache would otherwise show stale state)
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const { pullY, refreshing, progress, triggered } = usePullToRefresh(load)

  const filtered = useMemo(() => {
    const types = FILTER_TYPES[filter]
    return types.length ? notifications.filter(n => types.includes(n.type)) : notifications
  }, [notifications, filter])

  const unread = notifications.filter(n => !n.isRead).length

  async function markAllRead() {
    await fetch('/app/api/notifications', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAll: true }),
    })
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
  }

  async function clearAll() {
    setClearing(true)
    try {
      const res = await fetch('/app/api/notifications?clearAll=true', {
        method: 'DELETE', credentials: 'include',
      })
      if (res.ok) {
        clearedAt.current = Date.now()
        setNotifications([])
        setConfirmClear(false)
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? 'Could not clear notifications')
      }
    } finally {
      setClearing(false)
    }
  }

  async function dismiss(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    await fetch('/app/api/notifications', {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setNotifications(prev => prev.filter(n => n.id !== id))
  }

  function handleClick(n: Notification) {
    if (!n.isRead) {
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x))
      fetch('/app/api/notifications', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: n.id }),
      }).catch(() => {})
    }
    if (n.link) router.push(n.link)
  }

  return (
    <div className="min-h-screen bg-warm pb-20 md:pb-0">
      {/* Pull-to-refresh indicator */}
      <div
        className="flex items-center justify-center overflow-hidden transition-all duration-200"
        style={{ height: pullY > 0 || refreshing ? `${Math.max(pullY, refreshing ? 48 : 0)}px` : 0 }}
      >
        <div
          className={`w-8 h-8 rounded-full border-2 border-amber-500 border-t-transparent ${refreshing ? 'animate-spin' : ''}`}
          style={{ opacity: progress, transform: `rotate(${progress * 180}deg) scale(${0.5 + progress * 0.5})` }}
        />
      </div>

      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="max-w-3xl">
          <div className="flex items-center gap-3 text-sm text-gray-600 mb-4">
            <Link href="/dashboard" className="hover:text-gray-900 transition-colors">Dashboard</Link>
            <span>/</span>
            <span className="text-gray-900 font-medium">Notifications</span>
          </div>
          {/* Stack vertically on mobile so the three header actions
              don't crowd into a single row next to a 4xl heading
              (which forced "Mark all read" to break to 3 lines and
              clipped the Settings label on iPhone-width). Row layout
              returns at sm+ where there's room. flex-wrap on the
              actions row as a defensive belt-and-braces if a very
              narrow viewport (320px) still can't fit them. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">Notifications</h1>
              <p className="text-base text-gray-600 mt-1">{unread > 0 ? `${unread} unread` : 'All caught up'}</p>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              {unread > 0 && (
                <button onClick={markAllRead} className="text-sm text-amber-600 hover:underline font-medium whitespace-nowrap">
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                confirmClear ? (
                  <span className="flex items-center gap-2 text-sm whitespace-nowrap">
                    <button onClick={clearAll} disabled={clearing} className="text-red-500 hover:text-red-600 font-semibold disabled:opacity-50">
                      {clearing ? 'Clearing…' : 'Confirm'}
                    </button>
                    <button onClick={() => setConfirmClear(false)} disabled={clearing} className="text-gray-400 hover:text-gray-600 disabled:opacity-50">Cancel</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmClear(true)} className="text-sm text-gray-400 hover:text-gray-600 font-medium whitespace-nowrap">
                    Clear all
                  </button>
                )
              )}
              <Link href="/settings" className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1 whitespace-nowrap">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Settings
              </Link>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-2 mt-5">
            {FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  filter === f
                    ? 'bg-amber-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="max-w-3xl">
        {loading ? (
          <SkeletonList rows={6} />
        ) : filtered.length === 0 ? (
          filter !== 'All' ? (
            <EmptyState
              icon="🔕"
              title={`No ${filter.toLowerCase()} notifications`}
              body="Nothing in this category yet — check back later."
              action={{ label: 'Show all notifications', onClick: () => setFilter('All') }}
            />
          ) : (
            <EmptyState
              icon="✨"
              title="You're all caught up!"
              body="When events update or friends join, you'll see it here."
              action={{ label: 'Browse events', href: '/events' }}
            />
          )
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-50">
            {filtered.map(n => (
              <SwipeRow key={n.id} onSwipeLeft={() => dismiss({ stopPropagation: () => {} } as React.MouseEvent, n.id)}>
                <div
                  onClick={() => handleClick(n)}
                  className={`flex items-start gap-4 px-5 py-4 hover:bg-gray-50 transition-colors cursor-pointer group ${
                    !n.isRead ? 'bg-amber-50/40' : ''
                  }`}
                >
                  <span className="text-2xl shrink-0 mt-0.5">{TYPE_ICON[n.type] ?? '🔔'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-900 leading-snug">{n.title}</span>
                      <span className="text-xs text-gray-400 shrink-0 mt-0.5">{timeAgo(n.createdAt)}</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{n.body}</p>
                    {n.type === 'event_survey' && n.link && (
                      <a
                        href={n.link}
                        onClick={e => e.stopPropagation()}
                        className="inline-block mt-2 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors"
                      >
                        Leave feedback →
                      </a>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {!n.isRead && <span className="w-2 h-2 bg-amber-500 rounded-full mt-1" />}
                    <button
                      onClick={e => dismiss(e, n.id)}
                      className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 flex items-center justify-center w-8 h-8 text-gray-300 hover:text-gray-600 transition-all rounded-lg hover:bg-gray-100"
                      title="Dismiss"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </SwipeRow>
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
