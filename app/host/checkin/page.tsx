'use client'

import Link from 'next/link'

import { useState, useEffect, Suspense, useMemo } from 'react'
import { toast } from 'sonner'
import { useCheckinSync } from '@/hooks/useCheckinSync'
import { useCloseOut } from '@/hooks/useCloseOut'
import { useExcuse, excusable } from '@/hooks/useExcuse'
import WalkInAdd from '@/components/WalkInAdd'
import { withCapacityConfirm, OVERRIDE_FLAG } from '@/lib/admin/overCapacity'
import { applyPending, loadQueue, pendingFor } from '@/lib/checkinQueue'
import { useSearchParams, useRouter } from 'next/navigation'
import {resolveImageUrl, avatarUrl, getInitials} from '@/lib/data'
import { todayInTz, DEFAULT_TZ } from '@/lib/cityTime'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import { vibrate, useScanCheckin, isSeated } from '@/lib/checkin'
import { hasCardShape } from '@/lib/cardTokenShape'
import { type CheckInPromptEvent } from '@/lib/checkInPrompt'
import { awaitingCheckInPerEvent, eventTz, matchesName, readRoster, saveRoster } from '@/lib/hostPanel'
import { stillCorrectable } from '@/lib/checkInPrompt'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { loadFailure } from '@/lib/admin/useAdminLoad'
import SwipeRow from '@/components/SwipeRow'
import ScanResultToast from '@/components/ScanResultToast'
import dynamic from 'next/dynamic'

const QRScanner = dynamic(() => import('@/components/QRScanner'), { ssr: false })

// The door list carries each event's own city clock (`timezone`).
type HostEvent = CheckInPromptEvent & { timezone?: string | null }

interface Attendee {
  userId: string
  checkedIn: boolean
  // 'approved' | 'waitlisted' | 'pending'. The roster carries the waitlist
  // and the unapproved as well as the seated now, so a scan can name what it
  // found — but only the seated belong on the list, in the counts, or in
  // "mark the rest".
  status?: string
  /** The server's own word for "this is a seat" (checkin GET). */
  listed?: boolean
  // 'unknown' | 'attended' | 'no_show' | 'excused' (lib/constants Attendance)
  attendance?: string
  // Runs the event or is staff: never a no-show, never in "mark the rest".
  exempt?: boolean
  // Said "I was there" in the morning-after review (the checkin GET).
  saysCame?: boolean
  // No email: the door roster is a public-facing screen and a name plus a
  // photo is what checks someone in. See the checkin route.
  user: { id: string; name: string; color: string; profilePhoto?: string | null }
}

function EventList() {
  // "Today" is the CITY's calendar day — a member abroad, or a city in
  // another zone, must not get a different Tuesday than the community means.
  const tz = useCurrentCity()?.timezone ?? DEFAULT_TZ
  const [all,     setAll]     = useState<HostEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError,  setLoadError]  = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const router = useRouter()

  useEffect(() => {
    // The door list: events you host, co-host or club-host. The own-events
    // list left co-hosts and club hosts with "No events today" for a room the
    // check-in API would have let them run. A failed load says so, with
    // Retry — "No events today" at the door on a dropped connection sent
    // hosts looking for an event that was there all along.
    setLoadError(null)
    fetch('/app/api/host/events?scope=door', { credentials: 'include' })
      .then(async r => { if (!r.ok) throw await loadFailure(r); return r.json() })
      .then(d => setAll(Array.isArray(d) ? d : []))
      .catch((e: Error) => setLoadError(e?.message ?? 'Failed to load'))
      .finally(() => setLoading(false))
  }, [reloadTick])

  // Derived, not captured: the zone is DEFAULT_TZ on a cold load until the
  // city resolves, and a filter computed inside the fetch effect kept that
  // first answer — "No events today" for a host in another zone.
  const events = useMemo(() => {
    // Today's events, plus any that have already ended without a check-in
    // and can still be settled. Without the second half, a host following
    // the dashboard prompt the morning after lands on "No events today".
    // Each read on its own city's day. Only events that are on — a cancelled,
    // draft or still-in-review event has no door to run.
    const todays  = all.filter(e => (e.status === 'published' || e.status === 'postponed') && e.date === todayInTz(eventTz(e, tz)))
    const pending = awaitingCheckInPerEvent(all, tz).map(p => p.event)
    // Settled rooms a host can still correct (lib/checkInPrompt
    // stillCorrectable). They owe nothing tonight, but waiving and marking
    // stay open for a month and this is the page that does it.
    const older   = stillCorrectable(all, tz)
    const seen    = new Set(todays.map(e => e.id))
    const list    = [...todays, ...pending.filter(e => !seen.has(e.id))]
    const listed  = new Set(list.map(e => e.id))
    return [...list, ...older.filter(e => !listed.has(e.id))]
  }, [all, tz])

  if (loading) return <div className="text-zinc-500 text-sm">Loading…</div>
  if (loadError) return (
    <LoadErrorBanner message={loadError} title="Couldn't load your events"
      onRetry={() => { setLoading(true); setReloadTick(t => t + 1) }} />
  )

  if (events.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center">
        <div aria-hidden="true" className="text-3xl mb-2">📅</div>
        <div className="text-zinc-400 text-sm">No events today.</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {events.map(e => (
        <button key={e.id} onClick={() => router.push(`/host/checkin?event=${e.id}`)}
          className="w-full flex items-center gap-4 bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-600 transition-colors text-left">
          <span aria-hidden="true" className="text-3xl">{e.emoji}</span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-white truncate">{e.title}</div>
            <div className="text-xs text-zinc-400 mt-0.5">
              {/* A finished event in this list is one still awaiting its
                  check-in, so it needs its date — the time alone would read
                  as today. */}
              {e.date === todayInTz(eventTz(e, tz)) ? e.time : `${e.date} · ${e.time}`}
            </div>
          </div>
          <div className="ml-auto text-xs text-amber-400 font-medium shrink-0">Open →</div>
        </button>
      ))}
    </div>
  )
}

function CheckInScanner() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const eventId      = searchParams.get('event') ?? ''
  const browsedTz    = useCurrentCity()?.timezone ?? DEFAULT_TZ
  // The event's own city clock, looked up from its city once the event loads
  // (the event read carries only the id). The browsed city's until then.
  const [eventTzName, setEventTzName] = useState<string | null>(null)
  const tz           = eventTzName ?? browsedTz

  const [attendees,   setAttendees]   = useState<Attendee[]>([])
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [eventName,   setEventName]   = useState('')
  const [toggling,    setToggling]    = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [eventDate,   setEventDate]   = useState('')
  const [loadError,   setLoadError]   = useState<string | null>(null)
  // When the list on screen is the copy saved on this phone (lib/hostPanel),
  // the time it was saved — shown so nobody takes it for the live list.
  const [savedAt,     setSavedAt]     = useState<string | null>(null)
  const [reloadTick,  setReloadTick]  = useState(0)

  // useScanCheckin owns scan parse + look-up + optimistic PATCH with
  // rollback + vibrate + toast lifecycle. Same hook /admin/checkin
  // uses — keeps the two surfaces from drifting on QR formats, scan
  // result shape, haptics, or wording.
  // Taps that can't reach the server wait on the phone (lib/checkinQueue);
  // one the server turns down on replay is undone here.
  const { pending, send } = useCheckinSync(eventId, (item, error) => {
    setAttendees(prev => prev.map(a => a.userId === item.userId ? { ...a, checkedIn: !item.checkedIn, attendance: 'unknown' } : a))
    toast.error(error)
  })
  const pendingIds = new Set(pending.map(q => q.userId))

  // The whole roster goes to the scanner — a waitlisted or unapproved person
  // scanning their card must be named, not called a stranger — while the
  // screen below only ever shows seats.
  const { scanning, setScanning, scanResult, handleScan } = useScanCheckin({
    eventId, attendees, setAttendees, send,
  })
  const seated = useMemo(() => attendees.filter(isSeated), [attendees])

  // A card that nobody on tonight's list is carrying. Held past the toast so
  // the host can act on it without closing the camera and typing a name. The
  // scanned string is held with it: seating checks them in, and a check-in
  // from a scan has to send the code for the server to verify.
  const [unknownScan, setUnknownScan] = useState<{ userId: string; cardToken: string } | null>(null)
  const [seating,     setSeating]     = useState(false)
  useEffect(() => {
    if (!scanResult) return
    // Any other result is the next person: the offer belongs to the card that
    // raised it, not to the door.
    //
    // Only for something shaped like a card. `smileys:card:<any member id>`
    // with no signature, and a retired `smileys:member:` screenshot, both
    // parse far enough to name someone — offering to seat and check in on one
    // of those hands out exactly what the signing exists to prevent. They
    // still get the toast; they just get no button.
    setUnknownScan(scanResult.type === 'notfound' && hasCardShape(scanResult.cardToken)
      ? { userId: scanResult.userId, cardToken: scanResult.cardToken }
      : null)
  }, [scanResult])

  useEffect(() => {
    if (!eventId) return
    // The roster must be a roster: a refused or failed load (403, 429, a 500,
    // no signal) used to parse the error body as an empty list — "No
    // attendees found" at the door. Now it raises Retry, and if this phone
    // loaded the list before, that copy stays usable meanwhile, labelled.
    setLoadError(null)
    Promise.all([
      fetch(`/app/api/events/${eventId}/checkin`, { credentials: 'include' }).then(async r => {
        if (!r.ok) throw await loadFailure(r)
        const att = await r.json()
        if (!Array.isArray(att)) throw new Error('The check-in list came back in an unexpected shape')
        return att as Attendee[]
      }),
      fetch(`/app/api/events/${eventId}`, { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(async ([att, ev]) => {
      const name = typeof ev?.title === 'string' ? ev.title : ''
      const date = typeof ev?.date === 'string' ? ev.date : ''
      setAttendees(applyPending(att, pendingFor(loadQueue(), eventId)))
      if (name) setEventName(name)
      if (date) setEventDate(date)
      setSavedAt(null)
      let zone: string | null = null
      if (typeof ev?.cityId === 'string' && ev.cityId) {
        zone = await fetch(`/app/api/city/current?cityId=${encodeURIComponent(ev.cityId)}`, { credentials: 'include' })
          .then(r => r.ok ? r.json() : null).then(d => typeof d?.timezone === 'string' ? d.timezone : null).catch(() => null)
        if (zone) setEventTzName(zone)
      }
      saveRoster(eventId, { eventName: name, eventDate: date, tz: zone, attendees: att })
    }).catch((e: Error) => {
      const saved = readRoster<Attendee>(eventId)
      if (saved) {
        setAttendees(applyPending(saved.attendees, pendingFor(loadQueue(), eventId)))
        if (saved.eventName) setEventName(saved.eventName)
        if (saved.eventDate) setEventDate(saved.eventDate)
        if (saved.tz) setEventTzName(saved.tz)
        setSavedAt(saved.savedAt)
      }
      setLoadError(e?.message ?? 'Failed to load')
    }).finally(() => setLoading(false))
  }, [eventId, reloadTick])

  const retryLoad = () => { setLoading(true); setReloadTick(t => t + 1) }

  // `cardToken` is set only when this check-in came from a scan — the server
  // verifies it and refuses a forged, expired or retired code. A host's own
  // tap on the list sends none; they are already authorised for this event
  // and can see who is in front of them.
  async function toggleCheckin(userId: string, current: boolean, cardToken?: string) {
    setToggling(userId)
    setToggleError(null)
    const next = !current
    const prevAttendance = attendees.find(a => a.userId === userId)?.attendance
    setAttendees(prev => prev.map(a => a.userId === userId ? { ...a, checkedIn: next, attendance: next ? 'attended' : 'unknown' } : a))
    // The server's reason is shown as it is: "attendance settled — clear the
    // card instead" can't be fixed by retrying, and a generic "try again" sent
    // hosts round in circles. No signal is not a failure: the tap waits on the
    // phone and goes when the connection does (useCheckinSync).
    const outcome = await send(userId, next, cardToken)
    const failure = outcome.kind === 'refused' ? outcome.error : null
    if (!failure && next) vibrate.success()
    if (failure) {
      setAttendees(prev => prev.map(a => a.userId === userId ? { ...a, checkedIn: current, attendance: prevAttendance } : a))
      vibrate.error()
      setToggleError(failure)
    }
    setToggling(null)
  }


  const { excusing, excuse } = useExcuse({ eventId, setAttendees, onError: setToggleError })

  // A walk-in was just seated (components/WalkInAdd): reload the roster so
  // the row exists here with its server-decided fields, then check them in.
  async function seatedWalkIn(userId: string, cardToken?: string) {
    const att = await fetch(`/app/api/events/${eventId}/checkin`, { credentials: 'include' }).then(r => r.json())
    if (Array.isArray(att)) setAttendees(applyPending(att, pendingFor(loadQueue(), eventId)))
    await toggleCheckin(userId, false, cardToken)
  }

  // Seating the card that just scanned and matched nobody. The host is
  // standing in front of whoever holds it; the alternative was closing the
  // camera, opening the walk-in box and typing a name they may not know how
  // to spell. Same door as WalkInAdd — the staff add, capacity question and
  // all — so nothing about the seat is decided here.
  async function seatUnknownScan(userId: string, cardToken: string) {
    if (seating) return
    setSeating(true)
    try {
      const res = await withCapacityConfirm(allow => fetch(`/app/api/admin/events/${eventId}/participants`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, walkIn: true, ...(allow ? { [OVERRIDE_FLAG]: true } : {}) }),
      }))
      if (!res) return                                  // said no to exceeding capacity
      const d = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(typeof d?.error === 'string' ? d.error : "Couldn't seat them.")
        return
      }
      // Outside the door window the server sends an invitation instead of a
      // seat — say so rather than claim a check-in that didn't happen.
      if (d?.invited) {
        toast.success("Invitation sent — they'll get a spot when they accept")
      } else {
        // The scanned code rides along: this is a check-in from a scan, and
        // the server has to be the one that decides the card was real.
        await seatedWalkIn(userId, cardToken)
        toast.success('Seated and checked in')
      }
      setUnknownScan(null)
    } catch {
      toast.error('No connection — nothing was changed.')
    } finally {
      setSeating(false)
    }
  }

  // Seats only: the roster now carries the waitlist and the unapproved too,
  // and counting them here would say "4 / 30 checked in" for a room of nine.
  const checkedInCount = seated.filter(a => a.checkedIn).length
  // "Mark the rest" (hooks/useCloseOut). The day is the gate here; the
  // server holds the exact start.
  const started = !!eventDate && todayInTz(tz) >= eventDate
  const { rest, noShowCount, closing, markRest } = useCloseOut({
    eventId, attendees: seated, setAttendees, onError: setToggleError,
  })
  // Turkish-aware: "sukru" finds Şükrü, "ilker" finds İlker (lib/hostPanel).
  const visible = seated.filter(a => matchesName(a.user.name, search))

  if (loading) return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => router.push('/host/checkin')} className="p-2 rounded-lg text-zinc-400 hover:bg-zinc-800 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-base font-bold text-white truncate">{eventName || 'Loading…'}</h2>
      </div>
      <div className="text-zinc-500 text-sm">Loading attendees…</div>
    </div>
  )

  // Nothing loaded and nothing saved on this phone: only the error to show.
  if (loadError && !savedAt) return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/host/checkin')} className="p-2 rounded-lg text-zinc-400 hover:bg-zinc-800 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-base font-bold text-white truncate">{eventName || 'Check-in'}</h2>
      </div>
      <LoadErrorBanner message={loadError} title="Couldn't load the check-in list" onRetry={retryLoad} />
    </div>
  )

  return (
    <div className="space-y-4">
      {scanning && <QRScanner onScan={handleScan} onClose={() => setScanning(false)} />}

      {savedAt && (
        <div className="flex items-start gap-3 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          <p className="flex-1">
            Couldn&apos;t reach the server — showing the list saved on this phone at{' '}
            {new Date(savedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz })}.
            Check-ins you make are kept here and sent when you&apos;re back online.
          </p>
          <button onClick={retryLoad} className="shrink-0 font-semibold text-amber-200 hover:text-white">Retry</button>
        </div>
      )}

      <ScanResultToast result={scanResult} position="top" />

      {/* Above the camera (z-[60]) and the toast (z-[70]): the whole point is
          that the host answers it without leaving the scanner. */}
      {unknownScan && (
        <div className="fixed inset-x-4 bottom-[calc(2rem+env(safe-area-inset-bottom))] z-[75] mx-auto max-w-sm rounded-2xl bg-zinc-900 border border-zinc-700 shadow-2xl p-4 space-y-3">
          <p className="text-sm font-semibold text-white">That card isn&apos;t on tonight&apos;s list</p>
          <p className="text-xs text-zinc-400">
            {started
              ? 'If they belong in the room, seat them as a walk-in and they go straight onto the list, checked in.'
              : "Check-in opens 12 hours before the event — there's no seat to give yet."}
          </p>
          <div className="flex gap-2">
            {started && (
              <button
                onClick={() => seatUnknownScan(unknownScan.userId, unknownScan.cardToken)}
                disabled={seating}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold transition-colors disabled:opacity-50"
              >
                {seating ? 'Seating…' : 'Seat as walk-in'}
              </button>
            )}
            <button
              onClick={() => setUnknownScan(null)}
              className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-semibold transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/host/checkin')} className="p-2 rounded-lg text-zinc-400 hover:bg-zinc-800 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-white truncate">{eventName}</h2>
          <p className="text-xs text-zinc-400">{checkedInCount} / {seated.length} checked in{noShowCount > 0 ? ` · ${noShowCount} no-show` : ''}</p>
        </div>
        <button
          onClick={() => setScanning(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-colors shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
          </svg>
          Scan QR
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-amber-500 rounded-full transition-all"
          style={{ width: seated.length > 0 ? `${(checkedInCount / seated.length) * 100}%` : '0%' }}
        />
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search attendee…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-4 py-2.5 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
      />

      {toggleError && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{toggleError}</p>
      )}

      {pending.length > 0 && (
        <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          No signal — {pending.length} check-in{pending.length === 1 ? '' : 's'} saved on this phone, sending as soon as you&apos;re back online.
        </p>
      )}

      {/* Attendee list */}
      {visible.length === 0 ? (
        <div className="text-zinc-500 text-sm text-center py-8">No attendees found.</div>
      ) : (
        <div className="space-y-2">
          {visible.map(a => {
            // #7 perf: 128-wide thumb for the check-in list row avatar.
            const photo = avatarUrl(a.user.profilePhoto ?? null, 128)
            return (
              <SwipeRow
                key={a.userId}
                onSwipeRight={a.checkedIn ? undefined : () => toggleCheckin(a.userId, false)}
                onSwipeLeft={a.checkedIn ? () => toggleCheckin(a.userId, true) : undefined}
              >
                <div
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                    a.checkedIn ? 'bg-green-900/20 border-green-800'
                      : a.attendance === 'no_show' ? 'bg-red-950/30 border-red-900/60'
                      : 'bg-zinc-900 border-zinc-800'
                  }`}
                >
                  {photo ? (
                    <img src={photo} alt={a.user.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ backgroundColor: a.user.color }}>
                      {getInitials(a.user.name)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{a.user.name}</p>
                    {!a.checkedIn && a.attendance === 'no_show' && <p className="text-xs font-semibold text-red-400">No-show</p>}
                    {!a.checkedIn && a.attendance === 'excused' && <p className="text-xs font-semibold text-zinc-400">Excused</p>}
                    {!a.checkedIn && a.saysCame && <p className="text-xs font-semibold text-amber-300">🙋 Says they were there</p>}
                    {pendingIds.has(a.userId) && <p className="text-[11px] text-amber-400">Not sent yet</p>}
                  </div>
                  {excusable(a, started) && (
                    <button
                      onClick={() => { setToggleError(null); excuse(a.userId, a.attendance !== 'excused') }}
                      disabled={excusing === a.userId || toggling === a.userId || pendingIds.has(a.userId)}
                      className="shrink-0 px-2.5 h-10 rounded-xl text-xs font-semibold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors disabled:opacity-50"
                    >
                      {a.attendance === 'excused' ? 'Undo' : 'Excuse'}
                    </button>
                  )}
                  <button
                    onClick={() => toggleCheckin(a.userId, a.checkedIn)}
                    disabled={toggling === a.userId}
                    className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors disabled:opacity-50 ${
                      a.checkedIn ? 'bg-green-500 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                    }`}
                  >
                    {toggling === a.userId ? (
                      <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    ) : a.checkedIn ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    )}
                  </button>
                </div>
              </SwipeRow>
            )
          })}
        </div>
      )}

      {started && (
        /* Seats, not the whole roster: someone on the waitlist has no seat
           yet, and seating them at the door is exactly what this is for. */
        <WalkInAdd eventId={eventId} exclude={new Set(seated.map(a => a.userId))} onAdded={seatedWalkIn} />
      )}

      {/* Close out the door. Counts the whole roster, not the search. */}
      {started && rest.length > 0 && (
        <div className="pt-2">
          <button
            onClick={() => { setToggleError(null); markRest() }}
            disabled={closing || pending.length > 0}
            className="w-full py-3 rounded-xl border border-red-900/60 bg-red-950/30 text-sm font-semibold text-red-300 hover:bg-red-950/50 transition-colors disabled:opacity-50"
          >
            {closing ? 'Marking…' : `Mark the other ${rest.length} as no-show`}
          </button>
          <p className="text-xs text-zinc-500 text-center mt-2">
            {pending.length > 0
              ? 'Waiting for the check-ins on this phone to send first.'
              : "For the end of the event. Anyone you leave unmarked is settled at midnight the day after: a no-show if we told them they weren't checked in and they didn't reply, attended if they never got that message. A late arrival can still be checked in until then."}
          </p>
        </div>
      )}
    </div>
  )
}

function CheckinContent() {
  const searchParams = useSearchParams()
  const eventId = searchParams.get('event')
  return eventId ? <CheckInScanner /> : <EventList />
}

export default function HostCheckinPage() {
  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-white">Check-In</h1>
          <Link href="/host/review" className="text-xs font-semibold text-zinc-400 hover:text-white underline whitespace-nowrap">Attendance review →</Link>
        </div>
        <p className="text-zinc-400 text-sm mt-1">Scan QR or tap to check in attendees</p>
      </div>
      <Suspense fallback={<div className="text-zinc-500 text-sm">Loading…</div>}>
        <CheckinContent />
      </Suspense>
    </div>
  )
}
