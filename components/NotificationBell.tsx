'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { timeAgo } from '@/lib/timeAgo'
import Link from 'next/link'
import { TYPE_ICON } from '@/lib/notificationFilters'
import { DEFAULT_TZ } from '@/lib/cityTime'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import {
  sendNotificationAction, setReadFor, restoreAt, createNotificationSync,
  applyNotificationChange, createNotificationSourceId, emitNotificationChange, subscribeNotificationChanges,
} from '@/lib/notificationActions'
import {
  parseNotificationFeed, previewUnreadFirst, reconcileUnreadCount, unreadCountAfterChange,
  type NotificationRow as Notification,
} from '@/lib/notificationFeed'

const PREVIEW = 6

export default function NotificationBell() {
  const [open,   setOpen]   = useState(false)
  const [notifs, setNotifs] = useState<Notification[]>([])
  // The unread count across EVERY row, from the server — the dropdown holds
  // the newest 30, so counting the loaded ones told a member with 212 unread
  // notifications they had 30.
  const [unread, setUnread] = useState(0)
  const ref    = useRef<HTMLDivElement>(null)
  // Timestamps past the "6d ago" cutover render a calendar day, which belongs
  // to the city's clock rather than the phone's.
  const tz = useCurrentCity()?.timezone ?? DEFAULT_TZ
  // Keeps a poll from undoing an in-flight mark-read / dismiss (lib/notificationActions).
  const [sync] = useState(createNotificationSync)
  // Who we are when telling /notifications and other tabs what changed.
  const [source] = useState(createNotificationSourceId)

  const load = useCallback(() => {
    const poll = sync.startPoll()
    fetch('/app/api/notifications', { credentials: 'include' })
      // A refused or broken request is not an empty inbox. This used to take
      // whatever `r.json()` produced and treat any non-array as zero rows, so
      // an expired session emptied the bell and said "All caught up 🎉".
      .then(r => r.ok ? r.json().catch(() => null) : null)
      .then(d => {
        const feed = parseNotificationFeed(d)
        if (!feed) return
        const next = sync.resolvePoll(poll, feed.notifications)
        if (!next) return
        setNotifs(next)
        setUnread(reconcileUnreadCount(feed.unreadCount, feed.notifications, next))
      })
      .catch(() => {})
  }, [sync])

  // Initial load + poll every 60s
  useEffect(() => {
    load()
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [load])

  // Read / dismissed on /notifications or in another tab: reflect it now, not
  // at the next 60s poll (the badge used to keep counting it).
  useEffect(() => {
    return subscribeNotificationChanges(source, change => {
      sync.receive(change)
      setNotifs(prev => applyNotificationChange(prev, change))
      setUnread(c => unreadCountAfterChange(c, change))
    })
  }, [source, sync])

  // Close on outside click
  useEffect(() => {
    function onClickOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOut)
    return () => document.removeEventListener('mousedown', onClickOut)
  }, [])

  // Unread rows lead: the header promises "(3 new)" and the six rows below it
  // are what backs that up, so six read rows on top made the bell a liar.
  const preview = previewUnreadFirst(notifs, PREVIEW)

  // Optimistic, rolled back when the server refuses — these used to update
  // the list without reading the response (see lib/notificationActions).
  // Each one registers with sync while its request is out and settles before
  // any rollback, so a poll landing mid-request can't restore the old state.
  async function markAllRead() {
    const ids = new Set(notifs.filter(n => !n.isRead).map(n => n.id))
    const before = unread
    const settle = sync.begin({ kind: 'read', ids })
    setNotifs(prev => setReadFor(prev, ids, true))
    setUnread(0)
    if (!await sendNotificationAction('PATCH', { markAll: true }, 'Could not mark all as read').finally(settle)) {
      setNotifs(prev => setReadFor(prev, ids, false))
      setUnread(before)
      return
    }
    // The server marked everything, not just the rows loaded here.
    emitNotificationChange({ kind: 'readAll' }, source)
  }

  async function dismiss(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    e.preventDefault()
    const index   = notifs.findIndex(n => n.id === id)
    const removed = notifs[index]
    if (!removed) return
    const settle = sync.begin({ kind: 'dismiss', id })
    setNotifs(prev => prev.filter(n => n.id !== id))
    if (!removed.isRead) setUnread(c => Math.max(0, c - 1))
    if (!await sendNotificationAction('DELETE', { id }, 'Could not dismiss notification').finally(settle)) {
      setNotifs(prev => restoreAt(prev, removed, index))
      if (!removed.isRead) setUnread(c => c + 1)
      return
    }
    emitNotificationChange({ kind: 'dismiss', ids: [id] }, source)
  }

  // The row itself is a link (see below), so this only settles the read
  // receipt and closes the dropdown — navigation is the browser's.
  function openRow(n: Notification) {
    if (!n.isRead) {
      const ids = new Set([n.id])
      const settle = sync.begin({ kind: 'read', ids })
      setNotifs(prev => setReadFor(prev, ids, true))
      setUnread(c => Math.max(0, c - 1))
      // Not awaited — opening the notification shouldn't wait on a read
      // receipt. The bell stays mounted across the route change, so the
      // rollback and toast still land.
      sendNotificationAction('PATCH', { id: n.id }, 'Could not mark as read').finally(settle).then(ok => {
        if (!ok) {
          setNotifs(prev => setReadFor(prev, ids, false))
          setUnread(c => c + 1)
        } else emitNotificationChange({ kind: 'read', ids: [n.id] }, source)
      })
    }
    setOpen(false)
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
              <Link href="/notifications/settings" onClick={() => setOpen(false)} aria-label="Notification settings" className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
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
                  className={`relative flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors group ${!n.isRead ? 'bg-amber-50/40' : ''}`}
                >
                  {/* The row is a real link filling the card rather than a div
                      with onClick: it reaches the keyboard, announces itself,
                      and long-press offers to copy where it goes. A
                      notification with nowhere of its own to go opens the
                      list, where its full body renders — the two-line clamp
                      below made a long announcement a dead end. The content
                      sits above it but takes no clicks, so a tap anywhere on
                      the row lands on the link; the ✕ and the survey button
                      opt back in. */}
                  <Link
                    href={n.link ?? '/notifications'}
                    onClick={() => openRow(n)}
                    aria-label={`${n.title}${n.isRead ? '' : ' (unread)'}`}
                    className="absolute inset-0 z-0"
                  />
                  <span className="text-lg shrink-0 mt-0.5 pointer-events-none">{TYPE_ICON[n.type] ?? '🔔'}</span>
                  <div className="flex-1 min-w-0 pointer-events-none">
                    <div className="text-sm font-semibold text-gray-900 leading-snug">{n.title}</div>
                    <div className="text-xs text-gray-600 mt-0.5 leading-relaxed line-clamp-2">{n.body}</div>
                    {n.type === 'event_survey' && n.link && (
                      <Link
                        href={n.link}
                        onClick={e => { e.stopPropagation(); openRow(n) }}
                        className="relative z-10 pointer-events-auto inline-block mt-1.5 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold rounded-lg transition-colors"
                      >
                        Leave feedback →
                      </Link>
                    )}
                    <div className="text-xs text-gray-400 mt-1">{timeAgo(n.createdAt, { timeZone: tz })}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {!n.isRead && <span className="w-2 h-2 bg-amber-500 rounded-full pointer-events-none" />}
                    <button
                      onClick={e => dismiss(e, n.id)}
                      aria-label={`Dismiss notification: ${n.title}`}
                      className="relative z-10 opacity-100 md:opacity-0 md:group-hover:opacity-100 p-0.5 text-gray-300 hover:text-gray-600 transition-all"
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
              {/* The server's count, not the loaded rows': "View all 30" was
                  the take limit, whatever the member actually had. */}
              {unread > 0 ? `View all ${unread} unread →` : 'View all →'}
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
