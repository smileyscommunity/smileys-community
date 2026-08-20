'use client'

import { toast } from 'sonner'
import { confirmToast } from '@/lib/confirmToast'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import {formatShortDate} from '@/lib/data'
import UserAvatar from '@/components/UserAvatar'
import WhatsAppButton from '@/components/WhatsAppButton'
import { todayInTz, DEFAULT_TZ } from '@/lib/cityTime'
import { useCurrentCity } from '@/hooks/useCurrentCity'

// ─── Page contract ──────────────────────────────────────────────────
// This page is an INBOX: everything on it either needs a decision
// (Pending), fills a seat (Waitlist), or shows momentum (Recent RSVPs).
// Deep management — check-in, payments, quotas — lives on each event's
// own participants page, one tap away via every event link here.

interface User {
  id: string; name: string; color: string; email: string
  profilePhoto?: string | null; phone?: string | null; nationality?: string | null
}
interface EventRef {
  id: string; title: string; date: string; emoji: string; status: string
  spotsLeft: number; totalSpots: number
}
interface Attendee {
  userId: string; eventId: string; status: string; checkedIn: boolean; joinedAt: string
  user: User; event: EventRef
}
interface WaitlistEntry {
  id: string; userId: string; eventId: string; createdAt: string
  user: User; event: EventRef
}

type View = 'pending' | 'waitlist' | 'recent'

// Pill colors mirror /admin/events so the moderator sees the same
// vocabulary in both places. Past/draft/archived collapse to zinc
// because nothing needs urgent action on a closed event.
function eventStatusPill(status: string, dateStr: string, tz: string): { label: string; cls: string } {
  // The CITY's "today", not UTC — between midnight and 3am local the UTC
  // date is still yesterday, which mislabelled tonight's events.
  const isPast = dateStr < todayInTz(tz)
  if (status === 'cancelled') return { label: 'Cancelled', cls: 'bg-red-500/10 text-red-400' }
  if (status === 'postponed') return { label: 'Postponed', cls: 'bg-amber-500/10 text-amber-400' }
  if (status === 'archived')  return { label: 'Archived',  cls: 'bg-zinc-700 text-zinc-400' }
  if (status === 'draft')     return { label: 'Draft',     cls: 'bg-zinc-700 text-zinc-400' }
  if (status === 'pending')   return { label: 'Pending',   cls: 'bg-amber-500/10 text-amber-400' }
  if (isPast)                 return { label: 'Past',      cls: 'bg-zinc-700 text-zinc-400' }
  return { label: 'Live', cls: 'bg-green-500/10 text-green-400' }
}

// Compact relative timestamp for the RSVP feed — the recency IS the
// information on that tab, so it must be visible per row.
function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Istanbul calendar day of a timestamp — feed rows group by the day the
// member RSVPed, in the community's timezone (not the admin's, not UTC).
function istanbulDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })
}

// Capacity badge for event group headers. `demand` is how many people
// are asking for seats in this group (pending requests / queue length) —
// when demand exceeds supply the badge goes red so the admin sees the
// oversubscription before approving into it.
function SeatsBadge({ event, demand }: { event: EventRef; demand: number }) {
  if (event.totalSpots <= 0) return null
  const full = event.spotsLeft <= 0
  const tight = !full && demand > event.spotsLeft
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
      full ? 'bg-red-500/10 text-red-400' : tight ? 'bg-amber-500/10 text-amber-400' : 'bg-zinc-800 text-zinc-400'
    }`}>
      {full ? 'Full' : `${event.spotsLeft} spot${event.spotsLeft !== 1 ? 's' : ''} left`}
    </span>
  )
}

// Section header shared by the grouped views — event identity, status
// pill, capacity, and a right-aligned meta line.
function EventGroupHeader({ event, demand, meta }: { event: EventRef; demand: number; meta: string }) {
  const tz   = useCurrentCity()?.timezone ?? DEFAULT_TZ
  const pill = eventStatusPill(event.status, event.date, tz)
  return (
    <div className="flex items-center gap-2 px-5 py-3 border-b border-zinc-800 bg-zinc-800/40">
      <span>{event.emoji}</span>
      <Link href={`/admin/events/${event.id}/participants`}
        className="text-sm font-bold text-white hover:text-amber-400 transition-colors truncate">
        {event.title}
      </Link>
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${pill.cls}`}>{pill.label}</span>
      <SeatsBadge event={event} demand={demand} />
      <span className="text-xs text-zinc-500 ml-auto shrink-0">{meta}</span>
    </div>
  )
}

// Shared row layout. All three views render the same avatar + name/email
// structure; only the leading slot (checkbox vs queue rank vs nothing),
// selection highlight, and trailing actions differ.
function ParticipantRow({
  user, event, leading, selected, mobileEvent, children,
}: {
  user:      User
  event:     EventRef
  leading?:  React.ReactNode
  selected?: boolean
  // Show the event under the email on phones — for views whose rows sit
  // under an event group header this is redundant; the Recent feed needs
  // it or mobile rows are just names with no context.
  mobileEvent?: boolean
  children:  React.ReactNode
}) {
  return (
    <div className={`flex items-center gap-3 px-4 sm:px-5 py-4 transition-colors ${selected ? 'bg-amber-500/5' : 'hover:bg-zinc-800/40'}`}>
      {leading}
      <UserAvatar user={user} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate">{user.name}</p>
        <p className="text-xs text-zinc-500 truncate">{user.email}</p>
        {mobileEvent && (
          <Link href={`/admin/events/${event.id}/participants`}
            className="sm:hidden flex items-center gap-1 text-xs text-zinc-400 hover:text-amber-400 transition-colors mt-0.5 min-w-0">
            <span>{event.emoji}</span>
            <span className="truncate">{event.title}</span>
            <span className="text-zinc-600 shrink-0">· {formatShortDate(event.date)}</span>
          </Link>
        )}
      </div>
      {mobileEvent && (
        <div className="hidden sm:block min-w-0 flex-1">
          <Link href={`/admin/events/${event.id}/participants`}
            className="text-sm text-zinc-300 hover:text-amber-400 transition-colors truncate flex items-center gap-1.5">
            <span>{event.emoji}</span>
            <span className="truncate">{event.title}</span>
          </Link>
          <p className="text-xs text-zinc-600 mt-0.5">{formatShortDate(event.date)}</p>
        </div>
      )}
      {children}
    </div>
  )
}

export default function AdminParticipantsPage() {
  // Admin surfaces follow the city being administered.
  const tz = useCurrentCity()?.timezone ?? DEFAULT_TZ
  const [attendees,   setAttendees]   = useState<Attendee[]>([])
  const [waitlist,    setWaitlist]    = useState<WaitlistEntry[]>([])
  const [loading,     setLoading]     = useState(true)
  const [loadError,   setLoadError]   = useState(false)
  const [view,        setView]        = useState<View>('pending')
  const [q,           setQ]           = useState('')
  const [selected,    setSelected]    = useState<Set<string>>(new Set())
  const [bulkSaving,  setBulkSaving]  = useState(false)

  // silent=true refreshes data without the loading flash — used after
  // mutations (so spotsLeft and counts resync with the server) and when
  // the app regains focus (door-duty admins act on live numbers).
  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setLoadError(false) }
    try {
      const res = await fetch('/app/api/admin/participants', { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      setAttendees(Array.isArray(data.attendees) ? data.attendees : [])
      setWaitlist(Array.isArray(data.waitlist) ? data.waitlist : [])
      setLoadError(false)
    } catch {
      // A thrown fetch (offline, CORS) used to skip setLoading(false) and
      // strand the page on the skeleton forever; a non-ok response rendered
      // an empty inbox indistinguishable from "nobody's waiting". Both now
      // surface a retry — but only on a foreground load, so a background
      // resync failure doesn't yank the door admin out of their queue.
      if (!silent) setLoadError(true)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const onFocus = () => load(true)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  function rowKey(a: { userId: string; eventId: string }) { return `${a.userId}-${a.eventId}` }

  // Drop a row's key out of the selection set when a single-row action
  // removes it from the pending bucket — otherwise `selected` accumulates
  // stale keys and the "X selected" count drifts.
  const dropSelection = useCallback((userId: string, eventId: string) => {
    const key = `${userId}-${eventId}`
    setSelected(prev => {
      if (!prev.has(key)) return prev
      const s = new Set(prev); s.delete(key); return s
    })
  }, [])

  function toggleSelect(key: string) {
    setSelected(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })
  }

  async function approve(userId: string, eventId: string) {
    const res = await fetch(`/app/api/admin/events/${eventId}/participants`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action: 'approve' }),
    })
    if (res.ok) {
      setAttendees(prev => prev.map(a =>
        a.userId === userId && a.eventId === eventId ? { ...a, status: 'approved' } : a
      ))
      dropSelection(userId, eventId)
      toast.success('Approved ✓')
      load(true)
    } else {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Failed to approve')
    }
  }

  async function reject(userId: string, eventId: string) {
    if (!(await confirmToast('Reject this request?'))) return
    const res = await fetch(`/app/api/admin/events/${eventId}/participants`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action: 'reject' }),
    })
    if (res.ok) {
      setAttendees(prev => prev.filter(a => !(a.userId === userId && a.eventId === eventId)))
      dropSelection(userId, eventId)
      toast('Rejected')
      load(true)
    } else {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Failed to reject')
    }
  }

  async function remove(userId: string, eventId: string) {
    if (!(await confirmToast('Remove this attendee from the event?'))) return
    const res = await fetch(`/app/api/admin/events/${eventId}/participants`, {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, type: 'attendee' }),
    })
    if (res.ok) {
      setAttendees(prev => prev.filter(a => !(a.userId === userId && a.eventId === eventId)))
      toast('Removed')
      load(true)
    } else {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Failed to remove')
    }
  }

  async function promoteWaitlist(entry: WaitlistEntry) {
    const res = await fetch(`/app/api/admin/events/${entry.eventId}/participants`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: entry.userId }),
    })
    if (res.ok) {
      setWaitlist(prev => prev.filter(w => !(w.userId === entry.userId && w.eventId === entry.eventId)))
      setAttendees(prev => [...prev, {
        userId: entry.userId, eventId: entry.eventId, status: 'approved',
        checkedIn: false, joinedAt: new Date().toISOString(),
        user: entry.user, event: entry.event,
      }])
      toast.success(`${entry.user.name} approved ✓`)
      load(true)
    } else {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Failed to promote')
    }
  }

  // ── Derived views ──────────────────────────────────────────────────
  // One search box narrows whichever view is open; groups with no
  // matches disappear entirely.
  const matches = useCallback((u: User) => {
    const needle = q.trim().toLowerCase()
    if (!needle) return true
    return u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle)
  }, [q])

  // pending stays in the server's joinedAt-asc order — longest-waiting
  // request first within each event. approved flips to joinedAt-desc
  // because the Recent feed reads newest-first.
  const pending  = useMemo(
    () => attendees.filter(a => a.status === 'pending' && matches(a.user)),
    [attendees, matches],
  )
  // The RSVP feed is a PULSE, not an archive — only the last 7 days.
  // Without the cap it was every approved attendee of every upcoming
  // event (150+ rows), and the stale tail buried the signal. The tile
  // count therefore means "sign-ups this week".
  const approved = useMemo(() => {
    const cutoff = Date.now() - 7 * 86_400_000
    return attendees.filter(a =>
      a.status === 'approved' && new Date(a.joinedAt).getTime() >= cutoff && matches(a.user)
    ).slice().sort((x, y) => y.joinedAt.localeCompare(x.joinedAt))
  }, [attendees, matches])
  const queue = useMemo(() => waitlist.filter(w => matches(w.user)), [waitlist, matches])

  // Pending + Waitlist group by event (soonest first) so every request is
  // decided in its event's context — status, capacity, who else is asking.
  function groupByEvent<T extends { eventId: string; event: EventRef }>(rows: T[]) {
    const groups = new Map<string, { event: EventRef; rows: T[] }>()
    for (const r of rows) {
      const g = groups.get(r.eventId)
      if (g) g.rows.push(r)
      else groups.set(r.eventId, { event: r.event, rows: [r] })
    }
    return [...groups.values()].sort((a, b) => a.event.date.localeCompare(b.event.date))
  }
  const pendingByEvent  = useMemo(() => groupByEvent(pending), [pending])
  const waitlistByEvent = useMemo(() => groupByEvent(queue),   [queue])

  // Recent RSVPs group by Istanbul join-day, newest day first (approved
  // is already sorted desc, so insertion order is the display order).
  const approvedByDay = useMemo(() => {
    const groups = new Map<string, Attendee[]>()
    for (const a of approved) {
      const day = istanbulDay(a.joinedAt)
      const g = groups.get(day)
      if (g) g.push(a)
      else groups.set(day, [a])
    }
    return [...groups.entries()]
  }, [approved])

  // ── Bulk actions (Pending view) ────────────────────────────────────
  // Tracks per-id success so a partial failure only flips the rows that
  // actually changed, and failed rows KEEP their selection for retry.
  async function bulkRun(
    label: string,
    confirmMsg: string,
    work: (a: Attendee) => Promise<boolean>,
    onSuccess: (ok: Set<string>) => void,
  ) {
    const targets = pending.filter(a => selected.has(rowKey(a)))
    if (targets.length === 0) return
    if (!(await confirmToast(`${confirmMsg} ${targets.length} request${targets.length > 1 ? 's' : ''}?`))) return
    setBulkSaving(true)
    const results = await Promise.all(targets.map(async a => ({
      key: rowKey(a),
      ok:  await work(a).catch(() => false),
    })))
    const ok = new Set(results.filter(r => r.ok).map(r => r.key))
    const fail = results.length - ok.size
    if (ok.size) onSuccess(ok)
    setSelected(prev => new Set([...prev].filter(k => !ok.has(k))))
    setBulkSaving(false)
    if (ok.size) toast.success(`${label}: ${ok.size} done`)
    if (fail)    toast.error(`${label}: ${fail} failed — still selected, tap to retry`)
    load(true)
  }

  const patchAction = (action: 'approve' | 'reject') => async (a: Attendee) => {
    const res = await fetch(`/app/api/admin/events/${a.eventId}/participants`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: a.userId, action }),
    })
    return res.ok
  }

  const bulkApprove = () => bulkRun('Approve', 'Approve', patchAction('approve'), ok => {
    setAttendees(prev => prev.map(a => ok.has(rowKey(a)) ? { ...a, status: 'approved' } : a))
  })
  const bulkReject = () => bulkRun('Reject', 'Reject', patchAction('reject'), ok => {
    setAttendees(prev => prev.filter(a => !ok.has(rowKey(a))))
  })

  // ── Render ─────────────────────────────────────────────────────────
  const tiles: { key: View; label: string; value: number; color: string; span?: boolean }[] = [
    { key: 'pending',  label: 'Pending',  value: pending.length,  color: pending.length > 0 ? 'text-amber-400' : 'text-white' },
    { key: 'waitlist', label: 'Waitlist', value: queue.length,    color: queue.length > 0 ? 'text-violet-400' : 'text-white' },
    { key: 'recent',   label: 'RSVPs this week', value: approved.length, color: 'text-green-400', span: true },
  ]

  const searchMiss = q.trim().length > 0

  return (
    <div className="p-4 sm:p-6 space-y-5">

      <div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">Participants</h1>
        <p className="text-sm text-zinc-400 mt-0.5">All event join requests across every event</p>
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 px-4 py-6 text-center">
          <p className="text-sm text-red-300 font-medium mb-3">Couldn't load participants.</p>
          <button onClick={() => load()} className="text-xs font-bold bg-red-500 hover:bg-red-400 text-white px-3 py-1.5 rounded-lg">Retry</button>
        </div>
      ) : loading ? (
        <div className="text-zinc-500 text-sm text-center py-16">Loading…</div>
      ) : (
        <>
          {/* Tiles ARE the navigation — no separate segmented control.
              2-up on phones (Pending + Waitlist side by side, the two
              queues), RSVPs full-width on row 2; 3-up from sm. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {tiles.map(t => (
              <button key={t.key} onClick={() => setView(t.key)}
                className={`bg-zinc-900 rounded-xl border p-4 text-center active:scale-[0.98] transition-all ${
                  view === t.key ? 'border-amber-500/60' : 'border-zinc-800 hover:border-zinc-600'
                } ${t.span ? 'col-span-2 sm:col-span-1' : ''}`}>
                <div className={`text-2xl font-bold ${t.color}`}>{t.value}</div>
                <div className="text-xs text-zinc-500 mt-0.5">{t.label}{view === t.key ? ' ↓' : ''}</div>
              </button>
            ))}
          </div>

          {/* Search — filters whichever view is open */}
          <input
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search by name or email…"
            autoComplete="off"
            className="w-full bg-zinc-900 border border-zinc-800 text-white text-sm rounded-xl px-4 py-3 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
          />

          {/* ── Pending — decide now ── */}
          {view === 'pending' && (
            <>
              {pending.length > 0 && (
                <div className="flex items-center gap-3 px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl">
                  <input
                    type="checkbox"
                    checked={selected.size === pending.length && pending.length > 0}
                    onChange={() => setSelected(selected.size === pending.length ? new Set() : new Set(pending.map(rowKey)))}
                    className="w-4 h-4 rounded accent-amber-500 shrink-0"
                  />
                  <span className="text-sm text-zinc-400">
                    {selected.size > 0 ? <span className="font-semibold text-white">{selected.size} selected</span> : `Select all ${pending.length}`}
                  </span>
                  {selected.size > 0 && (
                    <div className="flex gap-2 ml-auto">
                      <button onClick={bulkApprove} disabled={bulkSaving}
                        className="px-4 py-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-bold rounded-lg disabled:opacity-50">
                        {bulkSaving ? '…' : `✅ Approve ${selected.size}`}
                      </button>
                      <button onClick={bulkReject} disabled={bulkSaving}
                        className="px-4 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold rounded-lg disabled:opacity-50">
                        {bulkSaving ? '…' : `❌ Reject ${selected.size}`}
                      </button>
                      <button onClick={() => setSelected(new Set())} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white">Cancel</button>
                    </div>
                  )}
                </div>
              )}

              {pending.length === 0 ? (
                <div className="bg-zinc-900 rounded-2xl border border-zinc-800 py-16 text-center">
                  <div className="text-4xl mb-3">✅</div>
                  <p className="text-zinc-400 font-medium">{searchMiss ? 'No pending requests match' : 'No pending requests'}</p>
                  {!searchMiss && <p className="text-zinc-600 text-sm mt-1">All caught up!</p>}
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingByEvent.map(group => (
                    <div key={group.event.id} className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
                      <EventGroupHeader event={group.event} demand={group.rows.length}
                        meta={`${formatShortDate(group.event.date)} · ${group.rows.length} pending`} />
                      <div className="divide-y divide-zinc-800">
                        {group.rows.map(a => {
                          const key = rowKey(a)
                          return (
                            <ParticipantRow key={key} user={a.user} event={a.event} selected={selected.has(key)}
                              leading={
                                <input type="checkbox" checked={selected.has(key)} onChange={() => toggleSelect(key)}
                                  className="w-4 h-4 rounded accent-amber-500 shrink-0" />
                              }>
                              <div className="flex items-center gap-2 shrink-0">
                                <WhatsAppButton user={a.user} />
                                <button onClick={() => approve(a.userId, a.eventId)}
                                  className="px-3 py-2 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 text-xs font-semibold transition-colors">
                                  Approve
                                </button>
                                <button onClick={() => reject(a.userId, a.eventId)}
                                  className="px-3 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-semibold transition-colors">
                                  Reject
                                </button>
                              </div>
                            </ParticipantRow>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Waitlist — fill seats ── */}
          {view === 'waitlist' && (
            queue.length === 0 ? (
              <div className="bg-zinc-900 rounded-2xl border border-zinc-800 py-14 text-center text-zinc-500 text-sm">
                {searchMiss ? 'No waitlist entries match.' : 'No one on the waitlist.'}
              </div>
            ) : (
              <div className="space-y-3">
                {waitlistByEvent.map(group => {
                  const full = group.event.totalSpots > 0 && group.event.spotsLeft <= 0
                  return (
                    <div key={group.event.id} className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
                      <EventGroupHeader event={group.event} demand={group.rows.length}
                        meta={`${formatShortDate(group.event.date)} · ${group.rows.length} in queue`} />
                      <div className="divide-y divide-zinc-800">
                        {group.rows.map((w, i) => (
                          <ParticipantRow key={`${w.userId}-${w.eventId}`} user={w.user} event={w.event}
                            leading={
                              <span className="text-xs font-bold text-zinc-600 w-5 text-center shrink-0">{i + 1}</span>
                            }>
                            <div className="flex items-center gap-2 shrink-0">
                              <WhatsAppButton user={w.user} />
                              <button onClick={() => promoteWaitlist(w)} disabled={full}
                                title={full ? 'Event is full — free a spot first' : undefined}
                                className="px-3 py-2 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                                {full ? 'Full' : 'Approve'}
                              </button>
                            </div>
                          </ParticipantRow>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          )}

          {/* ── Recent RSVPs — the pulse ── */}
          {view === 'recent' && (
            approved.length === 0 ? (
              <div className="bg-zinc-900 rounded-2xl border border-zinc-800 py-14 text-center text-zinc-500 text-sm">
                {searchMiss ? 'No RSVPs match.' : 'No sign-ups in the last 7 days.'}
              </div>
            ) : (
              <div className="space-y-3">
                {approvedByDay.map(([day, rows]) => {
                  const label = day === todayInTz(tz) ? 'Today'
                    : day === todayInTz(tz, -1) ? 'Yesterday'
                    : formatShortDate(day)
                  return (
                    <div key={day} className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
                      <div className="flex items-center gap-2 px-5 py-3 border-b border-zinc-800 bg-zinc-800/40">
                        <span className="text-sm font-bold text-white">{label}</span>
                        <span className="text-xs text-zinc-500 ml-auto shrink-0">
                          {rows.length} RSVP{rows.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="divide-y divide-zinc-800">
                        {rows.map(a => (
                          <ParticipantRow key={rowKey(a)} user={a.user} event={a.event} mobileEvent>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-zinc-500">{timeAgo(a.joinedAt)}</span>
                              {a.checkedIn && (
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">Checked in</span>
                              )}
                              <button onClick={() => remove(a.userId, a.eventId)}
                                className="px-3 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-semibold transition-colors">
                                Remove
                              </button>
                            </div>
                          </ParticipantRow>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          )}
        </>
      )}
    </div>
  )
}
