'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { timeAgo } from '@/lib/timeAgo'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { FILTERS, FILTER_TYPES, TYPE_ICON, type Filter } from '@/lib/notificationFilters'
import { DEFAULT_TZ } from '@/lib/cityTime'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import { toast } from 'sonner'
import {
  sendNotificationAction, setReadFor, restoreAt, createNotificationSync,
  applyNotificationChange, createNotificationSourceId, emitNotificationChange, subscribeNotificationChanges,
} from '@/lib/notificationActions'
import {
  parseNotificationFeed, mergeOlder, oldestCursor, reconcileUnreadCount,
  unreadCountAfterChange, clearAllConfirmLabel, mergeRefresh, type NotificationRow as Notification,
} from '@/lib/notificationFeed'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import SwipeRow from '@/components/SwipeRow'
import EmptyState from '@/components/EmptyState'
import { SkeletonList } from '@/components/Skeleton'

// How long a dismissed row stays recoverable. A swipe is easy to make by
// accident and the delete behind it is permanent, so the request waits this
// long behind an Undo rather than going out on the gesture.
const UNDO_MS = 6_000

const LOAD_FAILED =
  "We couldn't load your notifications just now, so what's below may be out of date — it isn't an empty inbox."

interface PendingDismiss {
  row:     Notification
  index:   number
  timer:   ReturnType<typeof setTimeout>
  settle:  () => void
  // The Undo toast, so leaving the page can take it down: it lives in the
  // root layout and would otherwise outlive the state that can undo.
  toastId: string
}

export default function NotificationsPage() {
  const [notifications,  setNotifications]  = useState<Notification[]>([])
  const [loading,        setLoading]        = useState(true)
  const [filter,         setFilter]         = useState<Filter>('All')
  const [confirmClear,   setConfirmClear]   = useState(false)
  const [clearing,       setClearing]       = useState(false)
  // The unread count across every row the member has, which is not the same as
  // the unread rows on this page: the route hands back the newest 30.
  const [unread,         setUnread]         = useState(0)
  const [hasMore,        setHasMore]        = useState(false)
  const [loadingOlder,   setLoadingOlder]   = useState(false)
  // Set when a load is refused or fails. The list stays as it was — a failed
  // request used to be indistinguishable from "nothing here".
  const [loadError,      setLoadError]      = useState(false)
  const clearedAt = useRef<number>(0)
  // True once a page of older notifications has been pulled in. A refresh
  // speaks only for the newest page, so from then on it can neither trim the
  // list back to 30 nor answer whether anything is left behind the tail.
  const pagedOlder = useRef(false)
  // Dismissals waiting out their Undo window, by notification id.
  const pendingDismiss = useRef(new Map<string, PendingDismiss>())
  // Keeps a refetch from undoing an in-flight mark-read / dismiss (lib/notificationActions).
  const [sync] = useState(createNotificationSync)
  // Who we are when telling the bell and other tabs what changed.
  const [source] = useState(createNotificationSourceId)
  // Past the "6d ago" cutover a timestamp becomes a calendar day, and which
  // day that is depends on the city's clock, not the phone's.
  const tz = useCurrentCity()?.timezone ?? DEFAULT_TZ
  const router = useRouter()

  const load = useCallback(async () => {
    // Don't overwrite a just-cleared state — wait 2s after clearAll before
    // allowing a re-fetch, otherwise the visibilitychange listener can race
    // and refill the list with pre-delete data.
    if (Date.now() - clearedAt.current < 2000) return
    const poll = sync.startPoll()
    let res: Response
    try {
      res = await fetch('/app/api/notifications', { credentials: 'include' })
    } catch {
      setLoadError(true)
      return
    }
    // A session that expired while the tab sat open answers 401. Staying here
    // would show an empty, permanently failing page.
    if (res.status === 401) { router.push('/login'); return }
    if (!res.ok) { setLoadError(true); return }
    const feed = parseNotificationFeed(await res.json().catch(() => null))
    if (!feed) { setLoadError(true); return }
    const next = sync.resolvePoll(poll, feed.notifications)
    setLoadError(false)
    if (!next) return
    setNotifications(prev => mergeRefresh(prev, next))
    setUnread(reconcileUnreadCount(feed.unreadCount, feed.notifications, next))
    if (!pagedOlder.current) setHasMore(feed.hasMore)
  }, [sync, router])

  // Older than the oldest row we hold. The list is a window on the newest 30 —
  // before this there was no way to reach anything behind them at all.
  const loadOlder = useCallback(async () => {
    const cursor = oldestCursor(notifications)
    if (!cursor || loadingOlder) return
    setLoadingOlder(true)
    try {
      const res = await fetch(
        `/app/api/notifications?before=${encodeURIComponent(cursor.before)}&beforeId=${encodeURIComponent(cursor.beforeId)}`,
        { credentials: 'include' })
      if (res.status === 401) { router.push('/login'); return }
      if (!res.ok) { setLoadError(true); return }
      const feed = parseNotificationFeed(await res.json().catch(() => null))
      if (!feed) { setLoadError(true); return }
      setLoadError(false)
      // Appended rather than replacing, and de-duplicated: a notification that
      // arrived since the first page would otherwise land in both. Through the
      // sync's overlay, or a row dismissed seconds ago (its delete still
      // waiting out the undo window) comes back from the server as "older".
      setNotifications(prev => sync.applyPending(mergeOlder(prev, feed.notifications)))
      pagedOlder.current = true
      setHasMore(feed.hasMore)
    } catch {
      setLoadError(true)
    } finally {
      setLoadingOlder(false)
    }
  }, [notifications, loadingOlder, router])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  // The bell above this page refreshes every 60s; the page itself only ever
  // loaded once, so a notification that arrived while it was open showed in
  // the bell and not in the list underneath it.
  useEffect(() => {
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
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

  // Read / dismissed from the bell or in another tab: apply it to this list
  // instead of showing it unread until the next refetch.
  useEffect(() => {
    return subscribeNotificationChanges(source, change => {
      sync.receive(change)
      setNotifications(prev => applyNotificationChange(prev, change))
      setUnread(c => unreadCountAfterChange(c, change))
    })
  }, [source, sync])

  // Leaving the page cuts the Undo short rather than cancelling the delete:
  // the member asked for it, and the timer dies with the component.
  useEffect(() => {
    const pending = pendingDismiss.current
    return () => {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer)
        // …and the offer of Undo goes with it, rather than staying on screen
        // over a row that is already being deleted.
        toast.dismiss(entry.toastId)
        sendNotificationAction('DELETE', { id }, 'Could not dismiss notification').finally(entry.settle)
      }
      pending.clear()
    }
  }, [])

  const { pullY, refreshing, progress } = usePullToRefresh(load)

  const filtered = useMemo(() => {
    const types = FILTER_TYPES[filter]
    return types.length ? notifications.filter(n => types.includes(n.type)) : notifications
  }, [notifications, filter])

  // Team broadcasts read like letters, not list rows — pull them out of
  // the stream and render them as full-body featured cards above it.
  const isBroadcast = (t: string) => t === 'announcement' || t === 'system_alert'
  const announcements = useMemo(() => filtered.filter(n => isBroadcast(n.type)), [filtered])
  const regular       = useMemo(() => filtered.filter(n => !isBroadcast(n.type)), [filtered])

  // Optimistic, rolled back when the server refuses — this used to mark
  // everything read without reading the response (lib/notificationActions).
  // Each action registers with sync while its request is out and settles
  // before any rollback, so a refetch landing mid-request can't undo it.
  async function markAllRead() {
    const ids = new Set(notifications.filter(n => !n.isRead).map(n => n.id))
    const before = unread
    const settle = sync.begin({ kind: 'read', ids })
    setNotifications(prev => setReadFor(prev, ids, true))
    setUnread(0)
    if (!await sendNotificationAction('PATCH', { markAll: true }, 'Could not mark all as read').finally(settle)) {
      setNotifications(prev => setReadFor(prev, ids, false))
      setUnread(before)
      return
    }
    // The server marked everything, not just the rows loaded here.
    emitNotificationChange({ kind: 'readAll' }, source)
  }

  async function clearAll() {
    setClearing(true)
    // clearedAt only stops refetches that *start* after the clear; this also
    // drops one already out, which would refill the list with pre-delete rows.
    const settle = sync.begin({ kind: 'hold' })
    try {
      const res = await fetch('/app/api/notifications?clearAll=true', {
        method: 'DELETE', credentials: 'include',
      }).finally(settle)
      if (res.ok) {
        clearedAt.current = Date.now()
        pagedOlder.current = false
        const data = await res.json().catch(() => ({} as { deleted?: number }))
        setNotifications([])
        setUnread(0)
        setHasMore(false)
        setConfirmClear(false)
        emitNotificationChange({ kind: 'clearAll' }, source)
        // The server counts what it actually deleted, which includes the
        // older rows this page never loaded.
        if (typeof data.deleted === 'number') {
          toast.success(`Deleted ${data.deleted} notification${data.deleted === 1 ? '' : 's'}`)
        }
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? 'Could not clear notifications')
      }
    } catch {
      toast.error('Could not clear notifications — check your connection')
    } finally {
      setClearing(false)
    }
  }

  // ── Dismiss, with a way back ───────────────────────────────────────────
  // The row leaves the list at once, but the DELETE waits out UNDO_MS behind
  // a toast: a swipe is a gesture you can make without meaning to, and there
  // is no undelete on the other side of this request.

  function commitDismiss(id: string) {
    const entry = pendingDismiss.current.get(id)
    if (!entry) return
    pendingDismiss.current.delete(id)
    clearTimeout(entry.timer)
    sendNotificationAction('DELETE', { id }, 'Could not dismiss notification').finally(entry.settle).then(ok => {
      if (!ok) {
        setNotifications(prev => restoreAt(prev, entry.row, entry.index))
        if (!entry.row.isRead) setUnread(c => c + 1)
        return
      }
      emitNotificationChange({ kind: 'dismiss', ids: [id] }, source)
    })
  }

  function undoDismiss(id: string) {
    const entry = pendingDismiss.current.get(id)
    if (!entry) return
    pendingDismiss.current.delete(id)
    clearTimeout(entry.timer)
    // Nothing was sent, so the row is still the server's — just put it back.
    entry.settle()
    setNotifications(prev => restoreAt(prev, entry.row, entry.index))
    if (!entry.row.isRead) setUnread(c => c + 1)
  }

  function dismiss(id: string) {
    const index = notifications.findIndex(n => n.id === id)
    const row   = notifications[index]
    if (!row || pendingDismiss.current.has(id)) return
    // Registered with sync for the whole window, so a refetch in the meantime
    // doesn't bring the row back under the member's feet.
    const settle = sync.begin({ kind: 'dismiss', id })
    setNotifications(prev => prev.filter(n => n.id !== id))
    if (!row.isRead) setUnread(c => Math.max(0, c - 1))
    // The toast's own id, so leaving the page can take it down with the
    // window it belongs to: sonner lives in the root layout and outlives this
    // component, so an Undo tapped after navigating away found nothing to undo
    // and said nothing — the row was already gone for good.
    const toastId = `dismiss-${id}`
    pendingDismiss.current.set(id, {
      row, index, settle, toastId,
      timer: setTimeout(() => commitDismiss(id), UNDO_MS),
    })
    toast('Notification dismissed', {
      id: toastId,
      duration: UNDO_MS,
      action: { label: 'Undo', onClick: () => undoDismiss(id) },
    })
  }

  // The row itself is a link or a button (see below); this settles the read
  // receipt, and navigation — where there is any — belongs to the browser.
  function openRow(n: Notification) {
    if (n.isRead) return
    const ids = new Set([n.id])
    const settle = sync.begin({ kind: 'read', ids })
    setNotifications(prev => setReadFor(prev, ids, true))
    setUnread(c => Math.max(0, c - 1))
    // Was `.catch(() => {})` — a refused read left the row looking read.
    sendNotificationAction('PATCH', { id: n.id }, 'Could not mark as read').finally(settle).then(ok => {
      if (!ok) {
        setNotifications(prev => setReadFor(prev, ids, false))
        setUnread(c => c + 1)
      }
      // Emitted even if this page has navigated away by then — the bell
      // is still mounted and needs its badge to drop.
      else emitNotificationChange({ kind: 'read', ids: [n.id] }, source)
    })
  }

  // The whole row as one control, stretched under the content: a bare div with
  // onClick can't be reached by keyboard and announces nothing. An anchor also
  // gives a long press somewhere to go.
  function rowOverlay(n: Notification) {
    const label = `${n.title}${n.isRead ? '' : ' (unread)'}`
    return n.link ? (
      <Link href={n.link} onClick={() => openRow(n)} aria-label={label} className="absolute inset-0 z-0 cursor-pointer" />
    ) : (
      <button type="button" onClick={() => openRow(n)} aria-label={`${label} — mark as read`} className="absolute inset-0 z-0 w-full cursor-pointer" />
    )
  }

  // Offered wherever the list ends, and from an empty tab: the tabs filter
  // what's loaded, so "nothing here" can just mean "not in these 30".
  const loadOlderAction = { label: loadingOlder ? 'Loading…' : 'Load older notifications', onClick: loadOlder }

  return (
    <div className="min-h-screen bg-warm">
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
              {/* Announced, so "Mark all read" tells a screen reader what it
                  did instead of silently changing a number. */}
              <p className="text-base text-gray-600 mt-1" aria-live="polite">
                {unread > 0 ? `${unread} unread` : 'All caught up'}
              </p>
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
              <Link href="/settings#notifications" className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1 whitespace-nowrap">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Settings
              </Link>
            </div>
          </div>

          {/* Clearing is a hard delete of EVERY row, including the ones older
              than this page has loaded — so the confirm names the number
              rather than asking about an unspecified "all". */}
          {confirmClear && (
            <p className="mt-3 text-sm text-red-600">
              {clearAllConfirmLabel({ loaded: notifications.length, hasMore, unreadCount: unread })}
            </p>
          )}

          {/* Filters */}
          <div className="flex gap-2 mt-5">
            {FILTERS.map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
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
        {loadError && (
          <div className="mb-4 rounded-2xl border border-red-100 bg-red-50/60 px-4 py-3 space-y-2">
            <p className="text-sm text-red-600">{LOAD_FAILED}</p>
            <button
              type="button"
              onClick={() => load()}
              className="text-sm font-semibold text-amber-600 hover:text-amber-700"
            >
              Retry
            </button>
          </div>
        )}
        {loading ? (
          <SkeletonList rows={6} />
        ) : filtered.length === 0 ? (
          // Nothing to say about an empty list when we couldn't read it —
          // the banner above already says what happened.
          loadError ? null : filter !== 'All' ? (
            <EmptyState
              icon="🔕"
              title={`No ${filter.toLowerCase()} notifications`}
              body={hasMore
                ? "Nothing in this category among the ones loaded so far — the tabs filter what's on this page, and you have older notifications."
                : 'Nothing in this category yet — check back later.'}
              action={hasMore ? loadOlderAction : { label: 'Show all notifications', onClick: () => setFilter('All') }}
            />
          ) : (
            <EmptyState
              icon="✨"
              title="You're all caught up!"
              body={hasMore
                ? "Nothing recent — though you still have older notifications below the ones loaded here."
                : "When events update or friends join, you'll see it here."}
              action={hasMore ? loadOlderAction : { label: 'Browse events', href: '/events' }}
            />
          )
        ) : (
          <>
          {/* Featured team broadcasts — full body, formatted for actual
              reading. The regular stream renders below. */}
          {announcements.length > 0 && (
            <div className="space-y-4 mb-6">
              {announcements.map(n => (
                <article
                  key={n.id}
                  className={`relative rounded-2xl shadow-sm border p-5 sm:p-6 transition-colors ${
                    !n.isRead ? 'bg-amber-50/60 border-amber-200' : 'bg-white border-gray-100'
                  }`}
                >
                  {rowOverlay(n)}
                  <div className="relative z-10 pointer-events-none flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                      <span className="text-lg" aria-hidden="true">{TYPE_ICON[n.type] ?? '📢'}</span>
                      <span className="font-semibold text-amber-700">From the Smileys Team</span>
                      <span>·</span>
                      <span>{timeAgo(n.createdAt, { timeZone: tz })}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!n.isRead && <span className="w-2 h-2 bg-amber-500 rounded-full mt-1.5" />}
                      <button
                        onClick={() => dismiss(n.id)}
                        aria-label={`Dismiss: ${n.title}`}
                        className="pointer-events-auto flex items-center justify-center w-8 h-8 text-gray-300 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-all"
                        title="Dismiss"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="relative z-10 pointer-events-none">
                    <h2 className="text-base font-bold text-gray-900 mt-2">{n.title}</h2>
                    <p className="text-sm text-gray-700 mt-2 leading-relaxed whitespace-pre-wrap">{n.body}</p>
                    {/* A broadcast image, when the send carried one. It sits
                        inside the same pointer-events-none wrapper as the title
                        and body, so tapping it still hits the row overlay and
                        marks the notification read / opens its link. alt="" —
                        the heading and body above already say what this is. */}
                    {n.imageUrl && (
                      <img
                        // object-contain, not cover: a flyer or a poster is
                        // the likeliest attachment and it is usually
                        // portrait — cover cropped it to an unreadable
                        // centre band while the email showed all of it.
                        src={`${n.imageUrl}?w=800`}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="w-full rounded-xl mt-3 max-h-96 object-contain bg-gray-50"
                      />
                    )}
                    {/* A broadcast that carries a link goes somewhere when you
                        tap it — saying "tap to mark as read" described only
                        the linkless ones. */}
                    {n.link ? (
                      <p className="text-xs text-amber-600 font-medium mt-3">Open →</p>
                    ) : !n.isRead ? (
                      <p className="text-xs text-amber-600 font-medium mt-3">Tap to mark as read</p>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}

          {regular.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-50">
            {regular.map(n => (
              <SwipeRow key={n.id} onSwipeLeft={() => dismiss(n.id)}>
                <div
                  className={`relative flex items-start gap-4 px-5 py-4 hover:bg-gray-50 transition-colors group ${
                    !n.isRead ? 'bg-amber-50/40' : ''
                  }`}
                >
                  {rowOverlay(n)}
                  <span className="relative z-10 text-2xl shrink-0 mt-0.5 pointer-events-none">{TYPE_ICON[n.type] ?? '🔔'}</span>
                  <div className="relative z-10 flex-1 min-w-0 pointer-events-none">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-900 leading-snug">{n.title}</span>
                      <span className="text-xs text-gray-400 shrink-0 mt-0.5">{timeAgo(n.createdAt, { timeZone: tz })}</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{n.body}</p>
                    {n.type === 'event_survey' && n.link && (
                      <Link
                        href={n.link}
                        onClick={() => openRow(n)}
                        className="relative z-10 pointer-events-auto inline-block mt-2 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors"
                      >
                        Leave feedback →
                      </Link>
                    )}
                  </div>
                  <div className="relative z-10 flex flex-col items-end gap-1 shrink-0 pointer-events-none">
                    {!n.isRead && <span className="w-2 h-2 bg-amber-500 rounded-full mt-1" />}
                    <button
                      onClick={() => dismiss(n.id)}
                      aria-label={`Dismiss: ${n.title}`}
                      className="pointer-events-auto relative z-10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 flex items-center justify-center w-8 h-8 text-gray-300 hover:text-gray-600 transition-all rounded-lg hover:bg-gray-100"
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

          {/* The tabs filter what's loaded, so say what that is — and give
              the older ones a way in. */}
          {hasMore && (
            <div className="mt-6 text-center space-y-2">
              <button
                type="button"
                onClick={loadOlder}
                disabled={loadingOlder}
                className="px-5 py-2.5 rounded-xl bg-white border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {loadingOlder ? 'Loading…' : 'Load older notifications'}
              </button>
              <p className="text-xs text-gray-400">
                Showing the newest {notifications.length}. The tabs above filter these, not your whole history.
              </p>
            </div>
          )}
          </>
        )}
        </div>
      </div>
    </div>
  )
}
