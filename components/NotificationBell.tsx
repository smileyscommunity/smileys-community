'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { timeAgo } from '@/lib/timeAgo'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { TYPE_ICON } from '@/lib/notificationFilters'
import { sendNotificationAction, setReadFor, restoreAt, createNotificationSync } from '@/lib/notificationActions'

interface Notification {
  id: string; type: string; title: string; body: string
  isRead: boolean; link: string | null; createdAt: string
}



export default function NotificationBell() {
  const [open,   setOpen]   = useState(false)
  const [notifs, setNotifs] = useState<Notification[]>([])
  const router = useRouter()
  const ref    = useRef<HTMLDivElement>(null)
  // Keeps a poll from undoing an in-flight mark-read / dismiss (lib/notificationActions).
  const [sync] = useState(createNotificationSync)

  const load = useCallback(() => {
    const poll = sync.startPoll()
    fetch('/app/api/notifications', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const next = sync.resolvePoll(poll, Array.isArray(d) ? d as Notification[] : [])
        if (next) setNotifs(next)
      })
      .catch(() => {})
  }, [sync])

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

  // Optimistic, rolled back when the server refuses — these used to update
  // the list without reading the response (see lib/notificationActions).
  // Each one registers with sync while its request is out and settles before
  // any rollback, so a poll landing mid-request can't restore the old state.
  async function markAllRead() {
    const ids = new Set(notifs.filter(n => !n.isRead).map(n => n.id))
    const settle = sync.begin({ kind: 'read', ids })
    setNotifs(prev => setReadFor(prev, ids, true))
    if (!await sendNotificationAction('PATCH', { markAll: true }, 'Could not mark all as read').finally(settle)) {
      setNotifs(prev => setReadFor(prev, ids, false))
    }
  }

  async function dismiss(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    const index   = notifs.findIndex(n => n.id === id)
    const removed = notifs[index]
    if (!removed) return
    const settle = sync.begin({ kind: 'dismiss', id })
    setNotifs(prev => prev.filter(n => n.id !== id))
    if (!await sendNotificationAction('DELETE', { id }, 'Could not dismiss notification').finally(settle)) {
      setNotifs(prev => restoreAt(prev, removed, index))
    }
  }

  function handleClick(n: Notification) {
    if (!n.isRead) {
      const ids = new Set([n.id])
      const settle = sync.begin({ kind: 'read', ids })
      setNotifs(prev => setReadFor(prev, ids, true))
      // Not awaited — opening the notification shouldn't wait on a read
      // receipt. The bell stays mounted across the route change, so the
      // rollback and toast still land.
      sendNotificationAction('PATCH', { id: n.id }, 'Could not mark as read').finally(settle).then(ok => {
        if (!ok) setNotifs(prev => setReadFor(prev, ids, false))
      })
    }
    setOpen(false)
    // Linkless notifications (e.g. all-member announcements) go to the
    // notifications page, where the full body renders — the dropdown
    // clamps it to two lines, so a dead-end click left long
    // announcements unreadable.
    router.push(n.link ?? '/notifications')
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
            <span className="sr-only">unread notifications</span>
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
                      <Link
                        href={n.link}
                        onClick={e => e.stopPropagation()}
                        className="inline-block mt-1.5 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold rounded-lg transition-colors"
                      >
                        Leave feedback →
                      </Link>
                    )}
                    <div className="text-xs text-gray-400 mt-1">{timeAgo(n.createdAt)}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {!n.isRead && <span className="w-2 h-2 bg-amber-500 rounded-full" />}
                    <button
                      onClick={e => dismiss(e, n.id)}
                      aria-label="Dismiss notification"
                      className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-0.5 text-gray-300 hover:text-gray-600 transition-all"
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
