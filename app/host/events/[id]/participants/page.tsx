'use client'

import { toast } from 'sonner'
import { confirmToast } from '@/lib/confirmToast'
import { withCapacityConfirm } from '@/lib/admin/overCapacity'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { toastApiError } from '@/lib/apiError'
import UserAvatar from '@/components/UserAvatar'
import StandingBadge from '@/components/StandingBadge'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import { DEFAULT_TZ, todayInTz } from '@/lib/cityTime'
import { eventHasStarted } from '@/lib/eventTime'
import { loadFailure } from '@/lib/admin/useAdminLoad'
import { toCsv } from '@/lib/admin/participantsView'

interface AttendeeUser {
  id: string; name: string; color: string; email?: string; profilePhoto?: string | null
}
interface Attendee {
  userId: string; status: string; checkedIn: boolean; joinedAt: string; user: AttendeeUser
  // The host or a co-host (the roster route tags them). They are listed, but
  // they are not guests: no counts, no broadcast, no CSV, no remove.
  isStaff?: boolean
  // Pending rows only: the member's active no-show cards across all events.
  standing?: 'yellow' | 'red' | null
}
interface WaitlistEntry {
  id: string; userId: string; createdAt: string; user: AttendeeUser
}
interface Review {
  id: string; rating: number; text: string; createdAt: string
  user: { name: string; color: string }
}

function Stars({ n }: { n: number }) {
  return (
    <span className="text-amber-400 text-sm">
      {'★'.repeat(n)}{'☆'.repeat(5 - n)}
    </span>
  )
}

export default function HostParticipantsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [eventTitle, setEventTitle] = useState('')
  const [eventDate,  setEventDate]  = useState('')
  const [eventTime,  setEventTime]  = useState('')
  const [attendees,  setAttendees]  = useState<Attendee[]>([])
  const [waitlist,   setWaitlist]   = useState<WaitlistEntry[]>([])
  // No-show cards issued from this event — the host clears one here when the
  // attendance record was wrong. Late-cancel cards have no attendee row.
  const [loading,    setLoading]    = useState(true)
  const [loadError,  setLoadError]  = useState<string | null>(null)
  const [notFound,   setNotFound]   = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const [tab,        setTab]        = useState<'pending' | 'approved' | 'waitlist' | 'reviews'>('pending')
  const [addSearch,    setAddSearch]    = useState('')
  const [searchResults, setSearchResults] = useState<AttendeeUser[]>([])
  const [searching,    setSearching]    = useState(false)
  const [addBusy,      setAddBusy]      = useState<string | null>(null)
  const [reviews,        setReviews]        = useState<Review[]>([])
  const [reviewsLoaded,  setReviewsLoaded]  = useState(false)
  const [rowBusy,        setRowBusy]        = useState<string | null>(null)
  // Members invited from this page in this visit. A host's add is an
  // invitation (the member takes the spot themselves), so they don't join the
  // list — this only stops the search offering them again.
  const [invited,        setInvited]        = useState<Set<string>>(new Set())
  const [eventCityId,    setEventCityId]    = useState('')
  const [eventTz,        setEventTz]        = useState<string | null>(null)
  const { user: viewer } = useAuth()
  // Only an admin's add seats the member; everyone else's sends an invitation.
  const seatsDirectly = viewer?.role === 'admin'


  useEffect(() => {
    // A refused, throttled or failed roster load (403/429/500) used to parse
    // the error body as an empty roster — a host at the door saw "no
    // attendees". Now it raises a retry banner, like the admin page. A 404 on
    // the event still says "Event not found" (the roster route answers a
    // missing event with 403, so the event's 404 decides first).
    const strict = async (r: Response) => { if (!r.ok) throw await loadFailure(r); return r.json() }
    setLoadError(null)
    setNotFound(false)
    Promise.all([
      fetch(`/app/api/events/${id}`, { credentials: 'include' }).then(r => r.status === 404 ? null : strict(r)),
      fetch(`/app/api/admin/events/${id}/participants`, { credentials: 'include' }),
    ]).then(async ([ev, rosterRes]) => {
      if (!ev) { setNotFound(true); return }
      const data = await strict(rosterRes)
      if (ev.title) setEventTitle(ev.title)
      if (ev.date)  setEventDate(ev.date)
      if (typeof ev.time === 'string') setEventTime(ev.time)
      if (typeof ev.cityId === 'string') setEventCityId(ev.cityId)
      setAttendees(Array.isArray(data.attendees) ? data.attendees : [])
      setWaitlist(Array.isArray(data.waitlist) ? data.waitlist : [])
    }).catch((e: Error) => setLoadError(e?.message ?? 'Failed to load'))
      .finally(() => setLoading(false))
  }, [id, reloadTick])

  const retryLoad = () => { setLoading(true); setReloadTick(t => t + 1) }

  // A background re-read after a change the server may have rippled (a
  // removal promoting the next waitlister). No spinner; a failure keeps
  // what's on screen.
  function refreshRoster() {
    fetch(`/app/api/admin/events/${id}/participants`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        if (Array.isArray(data.attendees)) setAttendees(data.attendees)
        if (Array.isArray(data.waitlist))  setWaitlist(data.waitlist)
      })
      .catch(() => {})
  }

  // The event's own city clock for "is it past" — the event read carries only
  // the city id. Until it answers (or if it can't), the browsed city's.
  useEffect(() => {
    if (!eventCityId) return
    fetch(`/app/api/city/current?cityId=${encodeURIComponent(eventCityId)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (typeof d?.timezone === 'string') setEventTz(d.timezone) })
      .catch(() => {})
  }, [eventCityId])

  useEffect(() => {
    if (addSearch.trim().length < 2) { setSearchResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/app/api/search?q=${encodeURIComponent(addSearch)}&type=members`, { credentials: 'include' })
        if (res.ok) {
          const data = await res.json()
          const alreadyIn = new Set([...attendees.map(a => a.userId), ...invited])
          setSearchResults((data.members ?? []).filter((u: AttendeeUser) => !alreadyIn.has(u.id)).slice(0, 6))
        }
      } finally { setSearching(false) }
    }, 250)
    return () => clearTimeout(timer)
  }, [addSearch, attendees, invited])

  async function loadReviews() {
    if (reviewsLoaded) return
    const res = await fetch(`/app/api/events/${id}/reviews`, { credentials: 'include' })
    if (res.ok) setReviews(await res.json())
    setReviewsLoaded(true)
  }

  function switchTab(t: typeof tab) {
    setTab(t)
    if (t === 'reviews') loadReviews()
  }

  // "Past" on the event's city's clock, not the host's device.
  const browsedTz = useCurrentCity()?.timezone ?? DEFAULT_TZ
  const today  = todayInTz(eventTz ?? browsedTz)
  const isPast = eventDate ? eventDate < today : false
  // Started, on the event city's clock: after that a seat is part of the
  // attendance record, and the server refuses host removals.
  const started = !!eventDate && eventHasStarted({ date: eventDate, time: eventTime || '00:00' }, eventTz ?? browsedTz)

  async function approve(userId: string) {
    // A full event refuses the seat; "exceed capacity?" first, override on yes.
    const res = await withCapacityConfirm(allowOverCapacity => fetch(`/app/api/admin/events/${id}/participants`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action: 'approve', ...(allowOverCapacity ? { allowOverCapacity: true } : {}) }),
    }))
    if (!res) return
    const d = await res.json().catch(() => ({}))
    // Refusals (a paused member's 409, a vanished request's 404) used to do
    // nothing visible.
    if (!res.ok) { toast.error(d?.error ?? 'Could not approve'); return }
    // A full quota answers 200 with status 'waitlisted': the member went to
    // the waitlist, not into a seat. This used to say "Approved ✓".
    if (d?.status === 'waitlisted') {
      setAttendees(prev => prev.filter(a => a.userId !== userId))
      toast.warning('That quota is full — moved to the waitlist instead')
      return
    }
    setAttendees(prev => prev.map(a => a.userId === userId ? { ...a, status: 'approved' } : a))
    toast.success('Approved ✓')
  }

  async function reject(userId: string) {
    if (!(await confirmToast('Reject this request?'))) return
    try {
      const res = await fetch(`/app/api/admin/events/${id}/participants`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action: 'reject' }),
      })
      // A refusal (a withdrawn request's 404, the ops rate limit) used to
      // leave the row sitting there with no word.
      if (!res.ok) { await toastApiError(res, 'Could not reject'); return }
      setAttendees(prev => prev.filter(a => a.userId !== userId)); toast('Rejected')
    } catch { toast.error('Could not reject — check your connection') }
  }

  // Take an approved guest off the event, or a waitlisted one off the queue.
  // The route frees the seat and, before the event starts, seats the next
  // person on the waitlist who fits.
  async function removeGuest(userId: string, name: string, from: 'approved' | 'waitlist') {
    const question = from === 'waitlist'
      ? `Take ${name} off the waitlist? They're told nothing and can join the queue again.`
      : `Remove ${name} from this event? Their spot goes to the next person on the waitlist.`
    if (!(await confirmToast(question, { confirmLabel: 'Remove', cancelLabel: 'Keep' }))) return
    setRowBusy(userId)
    try {
      const res = await fetch(`/app/api/admin/events/${id}/participants`, {
        method: 'DELETE', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(from === 'waitlist' ? { userId, type: 'waitlist' } : { userId }),
      })
      if (!res.ok) { await toastApiError(res, 'Could not remove'); return }
      if (from === 'waitlist') setWaitlist(prev => prev.filter(w => w.userId !== userId))
      else {
        setAttendees(prev => prev.filter(a => a.userId !== userId))
        // The route may have seated someone from the waitlist: re-read the
        // lists quietly so they show where they are now.
        if (waitlist.length > 0) refreshRoster()
      }
      toast(`${name} removed`)
    } catch { toast.error('Could not remove — check your connection') }
    finally { setRowBusy(null) }
  }

  // Hand an approved guest's spot back without taking them off the event:
  // they go to the end of the waitlist and are told so.
  async function moveToWaitlist(a: Attendee) {
    if (!(await confirmToast(`Move ${a.user.name} to the waitlist? They lose their spot and are told they're on the waitlist.`,
      { confirmLabel: 'Move to waitlist', cancelLabel: 'Keep' }))) return
    setRowBusy(a.userId)
    try {
      const res = await fetch(`/app/api/admin/events/${id}/participants`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: a.userId, action: 'toWaitlist' }),
      })
      if (!res.ok) { await toastApiError(res, 'Could not move to the waitlist'); return }
      const d = await res.json().catch(() => ({}))
      setAttendees(prev => prev.filter(x => x.userId !== a.userId))
      // The route hands back the real waitlist row; its id and time are the
      // database's, not made up here.
      const row = d?.waitlisted
      setWaitlist(prev => [
        ...prev.filter(w => w.userId !== a.userId),
        { id: row?.id ?? a.userId, userId: a.userId, createdAt: row?.createdAt ?? new Date().toISOString(), user: a.user },
      ])
      toast(`${a.user.name} moved to the waitlist`)
    } catch { toast.error('Could not move to the waitlist — check your connection') }
    finally { setRowBusy(null) }
  }

  async function addParticipant(user: AttendeeUser) {
    setAddBusy(user.id)
    try {
      const res = await withCapacityConfirm(allowOverCapacity => fetch(`/app/api/admin/events/${id}/participants`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, ...(allowOverCapacity ? { allowOverCapacity: true } : {}) }),
      }))
      if (!res) return
      if (!res.ok) { await toastApiError(res, seatsDirectly ? 'Could not add participant' : 'Could not send the invitation'); return }
      const d = await res.json().catch(() => ({}))
      setAddSearch('')
      // A host's add is an invitation: nobody is seated until the member
      // accepts, so nobody moves into the list here.
      if (d?.invited) {
        setInvited(prev => new Set(prev).add(user.id))
        toast.success(`Invitation sent — ${user.name} will get a spot when they accept`)
        return
      }
      setAttendees(prev => [...prev, { userId: user.id, status: 'approved', checkedIn: false, joinedAt: new Date().toISOString(), user }])
      setWaitlist(prev => prev.filter(w => w.userId !== user.id))
      toast.success(`${user.name} added ✓`)
    } catch {
      toast.error('Could not reach the server — check your connection')
    } finally {
      setAddBusy(null)
    }
  }

  async function promoteWaitlist(entry: WaitlistEntry) {
    const res = await withCapacityConfirm(allowOverCapacity => fetch(`/app/api/admin/events/${id}/participants`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: entry.userId, ...(allowOverCapacity ? { allowOverCapacity: true } : {}) }),
    }))
    if (!res) return
    if (res.ok) {
      setWaitlist(prev => prev.filter(w => w.userId !== entry.userId))
      const newAttendee: Attendee = { userId: entry.userId, status: 'approved', checkedIn: false, joinedAt: new Date().toISOString(), user: entry.user }
      setAttendees(prev => [...prev, newAttendee])
      toast.success(`${entry.user.name} approved ✓`)
    } else {
      // A refusal (a red card's 409, a quota) used to do nothing visible.
      const d = await res.json().catch(() => ({}))
      toast.error(d?.error ?? 'Could not promote')
    }
  }

  const pending  = attendees.filter(a => a.status === 'pending')
  const approved = attendees.filter(a => a.status === 'approved')
  // The guests: the approved list without the host and co-hosts. Every count,
  // the broadcast and the CSV read this — "Send to 12 attendees" counted the
  // two people running the room.
  const guests   = approved.filter(a => !a.isStaff)

  function exportCsv() {
    const rows = [
      ['Name', 'Checked In', 'Joined At'],
      ...guests.map(a => [
        a.user.name,
        a.checkedIn ? 'Yes' : 'No',
        new Date(a.joinedAt).toLocaleDateString('en-GB'),
      ]),
    ]
    // toCsv neutralises cells a spreadsheet would run as a formula (a member
    // named "=HYPERLINK(…)") on top of quoting — the old escaper only quoted.
    const csv  = toCsv(rows)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `${(eventTitle || 'event').replace(/[^a-zA-Z0-9]/g, '-')}-attendees.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const [broadcastMsg,  setBroadcastMsg]  = useState('')
  const [broadcasting,  setBroadcasting]  = useState(false)
  const [broadcastSent, setBroadcastSent] = useState(false)

  async function broadcast() {
    if (!broadcastMsg.trim()) return
    setBroadcasting(true)
    try {
      const res = await fetch(`/app/api/host/events/${id}/broadcast`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: broadcastMsg }),
      })
      // The server's reason, not a generic failure: the hourly limit (429)
      // says when it can go, which "Failed to send" never did.
      if (!res.ok) { await toastApiError(res, 'Failed to send message'); return }
      const d = await res.json().catch(() => ({}))
      const sent = typeof d?.sent === 'number' ? d.sent : null
      setBroadcastMsg(''); setBroadcastSent(true)
      toast.success(sent === null ? 'Message sent' : `Message sent to ${sent} ${sent === 1 ? 'person' : 'people'}`)
    } catch { toast.error('Failed to send message — check your connection') }
    finally { setBroadcasting(false) }
  }

  if (loading) return <div className="p-8 text-center text-zinc-500 text-sm">Loading…</div>
  // Never an empty roster on a failed load: the error, with Retry.
  if (loadError) return <div className="p-4 sm:p-8"><LoadErrorBanner message={loadError} onRetry={retryLoad} title="Couldn't load participants" /></div>
  if (notFound)  return <div className="p-8 text-center text-zinc-500 text-sm">Event not found</div>

  return (
    <div className="p-4 sm:p-8 space-y-6">

      <div className="flex items-center gap-3">
        <Link href="/host/events" className="text-zinc-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white">Participants</h1>
          {eventTitle && <p className="text-sm text-zinc-400 mt-0.5 truncate">{eventTitle}</p>}
        </div>
        <Link href={`/host/checkin?event=${id}`}
          className="text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 px-3 py-2 rounded-lg transition-colors shrink-0">
          Check in
        </Link>
      </div>

      {/* Add participant */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">{seatsDirectly ? 'Add participant directly' : 'Invite a member'}</p>
        {!seatsDirectly && (
          <p className="text-xs text-zinc-500 mb-3">They get a notification with a link to the event and take a spot themselves.</p>
        )}
        {seatsDirectly && <div className="mb-2" />}
        <div className="relative">
          <input
            value={addSearch}
            onChange={e => setAddSearch(e.target.value)}
            placeholder="Search member by name…"
            className="w-full px-3 py-2.5 text-sm bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          {addSearch.trim().length > 1 && (() => {
            if (searching) return (
              <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-xs text-zinc-500 z-10">
                Searching…
              </div>
            )
            if (!searchResults.length) return (
              <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-xs text-zinc-500 z-10">
                No members found
              </div>
            )
            return (
              <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden z-10 shadow-xl">
                {searchResults.map(u => (
                  <button key={u.id} onClick={() => addParticipant(u)} disabled={addBusy === u.id}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-700 transition-colors text-left disabled:opacity-40">
                    <UserAvatar user={u} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{u.name}</p>
                    </div>
                    <span className="text-xs text-amber-400 font-semibold shrink-0">{seatsDirectly ? 'Add →' : 'Invite →'}</span>
                  </button>
                ))}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Message all attendees */}
      {guests.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Message attendees</p>
            <span className="text-xs text-zinc-600">{guests.length} approved</span>
          </div>
          <textarea
            maxLength={500}
            value={broadcastMsg}
            onChange={e => { setBroadcastMsg(e.target.value); setBroadcastSent(false) }}
            rows={3}
            placeholder={`Send a message to all ${guests.length} confirmed attendees…`}
            className="w-full px-3 py-2.5 text-sm bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={broadcast}
              disabled={!broadcastMsg.trim() || broadcasting}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-40"
            >
              {broadcasting ? 'Sending…' : `Send to ${guests.length} ${guests.length === 1 ? 'attendee' : 'attendees'}`}
            </button>
            <span className={`text-xs ml-auto ${broadcastMsg.length > 450 ? 'text-red-400' : 'text-zinc-600'}`}>
              {broadcastMsg.length}/500
            </span>
            {broadcastSent && <span className="text-xs text-green-400">Sent ✓</span>}
          </div>
        </div>
      )}

      <div className={`grid gap-3 ${isPast ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
        {[
          { label: 'Pending',  value: pending.length,  color: pending.length > 0 ? 'text-amber-400' : 'text-white' },
          { label: 'Approved', value: guests.length,   color: 'text-green-400' },
          { label: 'Waitlist', value: waitlist.length, color: waitlist.length > 0 ? 'text-violet-400' : 'text-white' },
          ...(isPast ? [{ label: 'Reviews', value: reviewsLoaded ? reviews.length : '…', color: 'text-amber-400' }] : []),
        ].map(s => (
          <div key={s.label} className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 bg-zinc-800 rounded-xl p-1 w-fit flex-wrap">
        {([
          { key: 'pending',  label: `Pending (${pending.length})` },
          { key: 'approved', label: `Approved (${guests.length})` },
          { key: 'waitlist', label: `Waitlist (${waitlist.length})` },
          ...(isPast ? [{ key: 'reviews' as const, label: '⭐ Reviews' }] : []),
        ] as const).map(t => (
          <button key={t.key} onClick={() => switchTab(t.key as typeof tab)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${tab === t.key ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'pending' && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          {pending.length === 0 ? (
            <div className="p-10 text-center text-zinc-500 text-sm">No pending requests.</div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {pending.map(a => (
                <div key={a.userId} className="flex items-center gap-3 px-5 py-4">
                  <UserAvatar user={a.user} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{a.user.name}</p>
                      <StandingBadge level={a.standing} />
                    </div>
                    {a.user.email && <p className="text-xs text-zinc-500 truncate">{a.user.email}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => approve(a.userId)} className="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 text-xs font-semibold transition-colors">Approve</button>
                    <button onClick={() => reject(a.userId)} className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-semibold transition-colors">Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'approved' && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          {approved.length === 0 ? (
            <div className="p-10 text-center text-zinc-500 text-sm">No approved attendees yet.</div>
          ) : (
            <>
              <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
                <span className="text-xs text-zinc-500">{guests.length} attendee{guests.length !== 1 ? 's' : ''}</span>
                <button
                  onClick={exportCsv}
                  className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white border border-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download CSV
                </button>
              </div>
            <div className="divide-y divide-zinc-800">
              {approved.map(a => (
                <div key={a.userId} className="flex items-center gap-3 px-5 py-4">
                  <UserAvatar user={a.user} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{a.user.name}</p>
                    {a.user.email && <p className="text-xs text-zinc-500 truncate">{a.user.email}</p>}
                  </div>
                  {a.isStaff && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 shrink-0">Host</span>}
                  {a.checkedIn && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 shrink-0">Checked in</span>}
                  {!a.isStaff && !started && (
                    <div className="flex flex-wrap justify-end gap-1.5 shrink-0">
                      <button onClick={() => moveToWaitlist(a)} disabled={rowBusy === a.userId}
                        className="px-2.5 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 text-xs font-semibold transition-colors disabled:opacity-40">
                        To waitlist
                      </button>
                      <button onClick={() => removeGuest(a.userId, a.user.name, 'approved')} disabled={rowBusy === a.userId}
                        className="px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-semibold transition-colors disabled:opacity-40">
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            </>
          )}
        </div>
      )}

      {tab === 'waitlist' && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          {waitlist.length === 0 ? (
            <div className="p-10 text-center text-zinc-500 text-sm">No one on the waitlist.</div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {waitlist.map((w, i) => (
                <div key={w.userId} className="flex items-center gap-3 px-5 py-4">
                  <span className="text-xs font-bold text-zinc-600 w-5 text-center shrink-0">{i + 1}</span>
                  <UserAvatar user={w.user} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{w.user.name}</p>
                    <p className="text-xs text-zinc-500">{new Date(w.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5 shrink-0">
                    <button onClick={() => promoteWaitlist(w)} disabled={rowBusy === w.userId} className="px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 text-xs font-semibold transition-colors disabled:opacity-40">Approve</button>
                    <button onClick={() => removeGuest(w.userId, w.user.name, 'waitlist')} disabled={rowBusy === w.userId}
                      className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-semibold transition-colors disabled:opacity-40">Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}


      {tab === 'reviews' && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          {!reviewsLoaded ? (
            <div className="p-10 text-center text-zinc-500 text-sm">Loading…</div>
          ) : reviews.length === 0 ? (
            <div className="p-10 text-center text-zinc-500 text-sm">No reviews yet.</div>
          ) : (
            <>
              {/* Summary bar */}
              <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-4">
                <div className="text-3xl font-bold text-white">
                  {(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)}
                </div>
                <div>
                  <Stars n={Math.round(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length)} />
                  <p className="text-xs text-zinc-500 mt-0.5">{reviews.length} review{reviews.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <div className="divide-y divide-zinc-800">
                {reviews.map(r => (
                  <div key={r.id} className="px-5 py-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ backgroundColor: r.user.color }}>
                        {r.user.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold text-white">{r.user.name}</span>
                        <span className="text-xs text-zinc-500 ml-2">{new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                      </div>
                      <Stars n={r.rating} />
                    </div>
                    {r.text && <p className="text-sm text-zinc-300 leading-relaxed pl-10">{r.text}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
