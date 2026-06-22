'use client'

import { toast } from 'sonner'
import { confirmToast } from '@/lib/confirmToast'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { formatShortDate } from '@/lib/data'
import UserAvatar from '@/components/UserAvatar'

interface User {
  id: string; name: string; color: string; email: string; profilePhoto?: string | null
}
interface EventRef {
  id: string; title: string; date: string; emoji: string; status: string
}

// Pill colors mirror /admin/events so the moderator sees the same
// vocabulary in both places. Past/draft/archived collapse to zinc
// because nothing needs urgent action on a closed event.
function eventStatusPill(status: string, dateStr: string): { label: string; cls: string } {
  const isPast = dateStr < new Date().toISOString().slice(0, 10)
  if (status === 'cancelled') return { label: 'Cancelled', cls: 'bg-red-500/10 text-red-400' }
  if (status === 'postponed') return { label: 'Postponed', cls: 'bg-amber-500/10 text-amber-400' }
  if (status === 'archived')  return { label: 'Archived',  cls: 'bg-zinc-700 text-zinc-400' }
  if (status === 'draft')     return { label: 'Draft',     cls: 'bg-zinc-700 text-zinc-400' }
  if (status === 'pending')   return { label: 'Pending',   cls: 'bg-amber-500/10 text-amber-400' }
  if (isPast)                 return { label: 'Past',      cls: 'bg-zinc-700 text-zinc-400' }
  return { label: 'Live', cls: 'bg-green-500/10 text-green-400' }
}
interface Attendee {
  userId: string; eventId: string; status: string; checkedIn: boolean; joinedAt: string
  user: User; event: EventRef
}
interface WaitlistEntry {
  id: string; userId: string; eventId: string; createdAt: string
  user: User; event: EventRef
}

// Shared row layout for the three tabs (pending / approved / waitlist).
// All three render the same avatar + name/email + event-link structure;
// only the leading slot (checkbox vs rank vs nothing), the row's
// selection-highlight state, and the trailing actions differ. Pulled out
// so a layout tweak (e.g. mobile breakpoint) hits one place.
function ParticipantRow({
  user, event, leading, selected, children,
}: {
  user:      User
  event:     EventRef
  leading?:  React.ReactNode
  selected?: boolean
  children:  React.ReactNode
}) {
  return (
    <div className={`flex items-center gap-4 px-5 py-4 transition-colors ${selected ? 'bg-amber-500/5' : 'hover:bg-zinc-800/40'}`}>
      {leading}
      <UserAvatar user={user} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate">{user.name}</p>
        <p className="text-xs text-zinc-500 truncate">{user.email}</p>
      </div>
      <div className="hidden sm:block min-w-0 flex-1">
        <Link href={`/admin/events/${event.id}/participants`}
          className="text-sm text-zinc-300 hover:text-amber-400 transition-colors truncate flex items-center gap-1.5">
          <span>{event.emoji}</span>
          <span className="truncate">{event.title}</span>
        </Link>
        <p className="text-xs text-zinc-600 mt-0.5">{formatShortDate(event.date)}</p>
      </div>
      {children}
    </div>
  )
}

export default function AdminParticipantsPage() {
  const [attendees,   setAttendees]   = useState<Attendee[]>([])
  const [waitlist,    setWaitlist]    = useState<WaitlistEntry[]>([])
  const [loading,     setLoading]     = useState(true)
  const [tab,         setTab]         = useState<'pending' | 'approved' | 'waitlist'>('pending')
  const [selected,    setSelected]    = useState<Set<string>>(new Set())
  const [bulkSaving,  setBulkSaving]  = useState(false)

  // Single source of truth — both the initial mount effect and any
  // future refresh callers can reuse it. useCallback keeps it stable so
  // the effect's dep array is honest (the old `useEffect(() => { load()
  // }, [])` had a missing dep that react-hooks/exhaustive-deps would
  // normally flag).
  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/app/api/admin/participants', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      setAttendees(Array.isArray(data.attendees) ? data.attendees : [])
      setWaitlist(Array.isArray(data.waitlist) ? data.waitlist : [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Drop a row's key out of the selection set — used when a single-row
  // action (approve / reject / remove) leaves the bucket. Without this,
  // `selected` accumulated stale keys forever; the "X selected" count
  // would drift from what was actually selectable.
  const dropSelection = useCallback((userId: string, eventId: string) => {
    const key = `${userId}-${eventId}`
    setSelected(prev => {
      if (!prev.has(key)) return prev
      const s = new Set(prev); s.delete(key); return s
    })
  }, [])

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
      dropSelection(userId, eventId)
      toast('Removed')
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
      const newAttendee: Attendee = {
        userId: entry.userId, eventId: entry.eventId, status: 'approved',
        checkedIn: false, joinedAt: new Date().toISOString(),
        user: entry.user, event: entry.event,
      }
      setAttendees(prev => [...prev, newAttendee])
      toast.success(`${entry.user.name} approved ✓`)
    }
  }

  function rowKey(a: { userId: string; eventId: string }) { return `${a.userId}-${a.eventId}` }

  function toggleSelect(key: string) {
    setSelected(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })
  }

  // Memoize pending / approved so unrelated state changes (selection,
  // bulkSaving toggle, tab switch, focus) don't re-filter the whole
  // attendees list every render. Same pattern as /admin/events and the
  // search-aware tabs on /admin/users.
  //
  // pending stays in the server's joinedAt-asc order — longest-waiting
  // request surfaces first so a moderator clearing a backlog hits the
  // most overdue cases up top. approved flips to joinedAt-desc because
  // "what changed recently?" is the natural question on that tab.
  const pending  = useMemo(() => attendees.filter(a => a.status === 'pending'),  [attendees])
  const approved = useMemo(
    () => attendees.filter(a => a.status === 'approved')
      .slice().sort((x, y) => y.joinedAt.localeCompare(x.joinedAt)),
    [attendees],
  )

  // Group pending requests by event so the Pending tab gets section
  // headers showing event title + status pill + count. Before this,
  // moderators staring at a flat list couldn't tell that 8 of the 12
  // pending requests belonged to a cancelled event. Order matches the
  // event's date (soonest first) so urgent events bubble up.
  const pendingByEvent = useMemo(() => {
    const groups = new Map<string, { event: EventRef; rows: Attendee[] }>()
    for (const a of pending) {
      const g = groups.get(a.eventId)
      if (g) g.rows.push(a)
      else groups.set(a.eventId, { event: a.event, rows: [a] })
    }
    return [...groups.values()].sort((a, b) => a.event.date.localeCompare(b.event.date))
  }, [pending])

  // Bulk runner — tracks per-id success in a Set so a partial 500
  // only flips the rows that actually changed. Previously Promise.all
  // dropped per-request status entirely; the toast claimed "X approved"
  // even on full failure and rows were marked approved regardless.
  async function bulkRun(
    label: string,
    confirmMsg: string,
    work: (a: Attendee) => Promise<boolean>,
    onSuccess: (ok: Set<string>) => void,
  ) {
    const targets = pending.filter(a => selected.has(rowKey(a)))
    if (targets.length === 0) return
    if (!window.confirm(`${confirmMsg} ${targets.length} request${targets.length > 1 ? 's' : ''}?`)) return
    setBulkSaving(true)
    const results = await Promise.all(targets.map(async a => ({
      key: rowKey(a),
      ok:  await work(a).catch(() => false),
    })))
    const ok = new Set(results.filter(r => r.ok).map(r => r.key))
    const fail = results.length - ok.size
    if (ok.size) onSuccess(ok)
    setSelected(new Set())
    setBulkSaving(false)
    if (ok.size) toast.success(`${label}: ${ok.size} done`)
    if (fail)    toast.error(`${label}: ${fail} failed`)
  }

  async function bulkApprove() {
    await bulkRun('Approve', 'Approve', async (a) => {
      const res = await fetch(`/app/api/admin/events/${a.eventId}/participants`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: a.userId, action: 'approve' }),
      })
      return res.ok
    }, (ok) => {
      setAttendees(prev => prev.map(a => ok.has(rowKey(a)) ? { ...a, status: 'approved' } : a))
    })
  }

  async function bulkReject() {
    // Bulk reject now confirms — the single-row reject already did but
    // bulk fired instantly on click, making a misclick irreversible.
    await bulkRun('Reject', 'Reject', async (a) => {
      const res = await fetch(`/app/api/admin/events/${a.eventId}/participants`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: a.userId, action: 'reject' }),
      })
      return res.ok
    }, (ok) => {
      setAttendees(prev => prev.filter(a => !ok.has(rowKey(a))))
    })
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">

      <div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">Participants</h1>
        <p className="text-sm text-zinc-400 mt-0.5">All event join requests across every event</p>
      </div>

      {loading ? (
        <div className="text-zinc-500 text-sm text-center py-16">Loading…</div>
      ) : (
        <>
          {/* Stats — 2-up on phones so each tile breathes, 3-up from
              sm+. Pending + Approved sit side-by-side on the first
              mobile row (the two most-acted-on); Waitlist takes the
              orphan slot full-width on row 2 rather than getting
              half-row-stranded. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: 'Pending',  value: pending.length,  color: pending.length > 0 ? 'text-amber-400' : 'text-white' },
              { label: 'Approved', value: approved.length, color: 'text-green-400' },
              { label: 'Waitlist', value: waitlist.length, color: waitlist.length > 0 ? 'text-violet-400' : 'text-white', span: true as const },
            ].map(s => (
              <div key={s.label} className={`bg-zinc-900 rounded-xl border border-zinc-800 p-4 text-center ${s.span ? 'col-span-2 sm:col-span-1' : ''}`}>
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-zinc-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-zinc-800 rounded-xl p-1 w-fit">
            {([
              { key: 'pending',  label: `Pending (${pending.length})` },
              { key: 'approved', label: `Approved (${approved.length})` },
              { key: 'waitlist', label: `Waitlist (${waitlist.length})` },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${tab === t.key ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Pending */}
          {tab === 'pending' && (
            <>
              {/* Bulk bar */}
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
                  <p className="text-zinc-400 font-medium">No pending requests</p>
                  <p className="text-zinc-600 text-sm mt-1">All caught up!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingByEvent.map(group => {
                    const pill = eventStatusPill(group.event.status, group.event.date)
                    return (
                      <div key={group.event.id} className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
                        {/* Section header — event identity + status pill +
                            count. The status pill is the load-bearing part:
                            it stops moderators silently approving people
                            into a cancelled / postponed event. */}
                        <div className="flex items-center gap-2 px-5 py-3 border-b border-zinc-800 bg-zinc-800/40">
                          <span>{group.event.emoji}</span>
                          <Link href={`/admin/events/${group.event.id}/participants`}
                            className="text-sm font-bold text-white hover:text-amber-400 transition-colors truncate">
                            {group.event.title}
                          </Link>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${pill.cls}`}>{pill.label}</span>
                          <span className="text-xs text-zinc-500 ml-auto shrink-0">
                            {formatShortDate(group.event.date)} · {group.rows.length} pending
                          </span>
                        </div>
                        <div className="divide-y divide-zinc-800">
                          {group.rows.map(a => {
                            const key = rowKey(a)
                            return (
                              <ParticipantRow key={key} user={a.user} event={a.event} selected={selected.has(key)}
                                leading={
                                  <input type="checkbox" checked={selected.has(key)} onChange={() => toggleSelect(key)}
                                    className="w-4 h-4 rounded accent-amber-500 shrink-0" />
                                }>
                                <div className="flex gap-2 shrink-0">
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
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* Approved */}
          {tab === 'approved' && (
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
              {approved.length === 0 ? (
                <div className="py-14 text-center text-zinc-500 text-sm">No approved attendees yet.</div>
              ) : (
                <div className="divide-y divide-zinc-800">
                  {approved.map(a => (
                    <ParticipantRow key={`${a.userId}-${a.eventId}`} user={a.user} event={a.event}>
                      <div className="flex items-center gap-2 shrink-0">
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
              )}
            </div>
          )}

          {/* Waitlist */}
          {tab === 'waitlist' && (
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
              {waitlist.length === 0 ? (
                <div className="py-14 text-center text-zinc-500 text-sm">No one on the waitlist.</div>
              ) : (
                <div className="divide-y divide-zinc-800">
                  {waitlist.map((w, i) => (
                    <ParticipantRow key={`${w.userId}-${w.eventId}`} user={w.user} event={w.event}
                      leading={
                        <span className="text-xs font-bold text-zinc-600 w-5 text-center shrink-0">{i + 1}</span>
                      }>
                      <button onClick={() => promoteWaitlist(w)}
                        className="px-3 py-2 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 text-xs font-semibold transition-colors shrink-0">
                        Approve
                      </button>
                    </ParticipantRow>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
