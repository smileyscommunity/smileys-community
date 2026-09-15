'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { Suspense } from 'react'
import {getInitials} from '@/lib/data'
import { vibrate, useScanCheckin } from '@/lib/checkin'
import { applyPending, loadQueue, pendingFor } from '@/lib/checkinQueue'
import { useCheckinSync } from '@/hooks/useCheckinSync'
import { useCloseOut } from '@/hooks/useCloseOut'
import QRScanner from '@/components/QRScanner'
import ScanResultToast from '@/components/ScanResultToast'
import { todayInTz, DEFAULT_TZ } from '@/lib/cityTime'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { loadFailure } from '@/lib/admin/useAdminLoad'
import { matchesPersonSearch } from '@/lib/admin/participantsView'

interface Event {
  id: string
  title: string
  date: string
  time: string
  emoji: string
  status: string
  city?: { name: string; slug: string } | null
}

interface Attendee {
  id: string
  userId: string
  checkedIn: boolean
  // 'unknown' | 'attended' | 'no_show' (lib/constants Attendance)
  attendance?: string
  // Runs the event or is staff: never a no-show, never in "mark the rest".
  exempt?: boolean
  // email is absent for co-hosts and club hosts — the check-in GET only
  // sends it to admins and the primary host.
  user: { id: string; name: string; color: string; email?: string | null }
}

function CheckInPageInner() {
  // Admin surfaces follow the city being administered.
  const tz = useCurrentCity()?.timezone ?? DEFAULT_TZ
  const searchParams    = useSearchParams()
  const router          = useRouter()
  const pathname        = usePathname()
  const defaultEventId  = searchParams.get('event') ?? ''

  const [events,        setEvents]        = useState<Event[]>([])
  const [selectedId,    setSelectedId]    = useState(defaultEventId)
  const [attendees,     setAttendees]     = useState<Attendee[]>([])
  const [loadingEvents, setLoadingEvents] = useState(true)
  const [loadingAtts,   setLoadingAtts]   = useState(false)
  // A failed load used to fall through to "No events today" / "No attendees
  // registered" — at the door that reads as the truth. Ticks drive Retry.
  const [eventsError,   setEventsError]   = useState<string | null>(null)
  const [attsError,     setAttsError]     = useState<string | null>(null)
  const [eventsTick,    setEventsTick]    = useState(0)
  const [attsTick,      setAttsTick]      = useState(0)
  const [search,        setSearch]        = useState('')
  const [lastChecked,   setLastChecked]   = useState<string | null>(null)
  // Stat-tile filter — tap Checked in / Remaining to narrow the list,
  // tap again (or Total) to clear. Mirrors the participants page tiles.
  const [view,          setView]          = useState<'all' | 'in' | 'remaining'>('all')
  // Per-row saving state — keyed by attendee.id so multiple taps queue
  // gracefully and the row spinner only shows on the row that's busy.
  // Set-shape mirrors how the bulk pages track inflight work.
  const [toggling,      setToggling]      = useState<Set<string>>(new Set())
  const searchRef                          = useRef<HTMLInputElement>(null)
  // Default to today-only (matching /host/checkin). Admins can opt back
  // into the full list for prepping tomorrow's check-in or fixing
  // yesterday's data, but the dropdown is no longer choked with months
  // of events the moment you open the page.
  const [showAllEvents, setShowAllEvents] = useState(false)

  // lastChecked highlight timer (the scan-result timer now lives inside
  // useScanCheckin). Ref pattern so a busy kiosk doesn't accumulate
  // pending setStates on the heap.
  const lastCheckedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashLastChecked = useCallback((userId: string) => {
    setLastChecked(userId)
    if (lastCheckedTimer.current) clearTimeout(lastCheckedTimer.current)
    lastCheckedTimer.current = setTimeout(() => setLastChecked(null), 1500)
  }, [])
  useEffect(() => () => {
    if (lastCheckedTimer.current) clearTimeout(lastCheckedTimer.current)
  }, [])

  // Keyboard shortcuts for the high-throughput check-in flow:
  //   / → focus search (skipped when already typing in a field)
  //   Esc → clear search when focused, so a missed-name retry is fast
  // Guards against form-element targets so typing "/" in the search
  // doesn't trap focus, and against modifier keys so browser shortcuts
  // (Cmd+/, Ctrl+/) still reach the system.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inField = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (e.key === '/' && !inField && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setSearch('')
        searchRef.current?.blur()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    setEventsError(null)
    fetch('/app/api/admin/events', { credentials: 'include' })
      .then(async r => { if (!r.ok) throw await loadFailure(r); return r.json() })
      .then(data => {
        const list = Array.isArray(data) ? data.filter((e: Event) => e.status !== 'cancelled' && e.status !== 'archived') : []
        setEvents(list)
        // Snap a stale `?event=` to today's first (or next future)
        // event. Without this a bookmark or kiosk URL captured during
        // yesterday's event would re-open on a past event today —
        // exactly the "expired events show up in check-in" complaint.
        // The API returns events in date-asc order so list[0] is the
        // OLDEST event in the DB; using it as the fallback is what made
        // the kiosk land on ancient past events when nothing is today.
        // Now we explicitly pick the first event that's today or later;
        // if none exists the dropdown shows the empty-state copy.
        // Admins fixing yesterday's data still get there via "Show all".
        const today      = todayInTz(tz)
        const fallback   = list.find((e: Event) => e.date >= today)?.id ?? ''
        const stillValid = defaultEventId && list.some((e: Event) => e.id === defaultEventId && e.date >= today)
        if (!stillValid) setSelectedId(fallback)
      })
      .catch((e: Error) => setEventsError(e?.message ?? 'Failed to load'))
      .finally(() => setLoadingEvents(false))
  // defaultEventId is intentionally read once on mount — adding it to
  // deps would refire the events fetch every time we router.replace()
  // to sync the URL with the active selection. eventsTick is Retry only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsTick])

  useEffect(() => {
    if (!selectedId) return
    setLoadingAtts(true)
    setAttsError(null)
    setAttendees([])
    setView('all')
    fetch(`/app/api/events/${selectedId}/checkin`, { credentials: 'include' })
      .then(async r => { if (!r.ok) throw await loadFailure(r); return r.json() })
      .then(data => setAttendees(Array.isArray(data) ? applyPending(data, pendingFor(loadQueue(), selectedId)) : []))
      .catch((e: Error) => setAttsError(e?.message ?? 'Failed to load'))
      .finally(() => setLoadingAtts(false))
  }, [selectedId, attsTick])

  // URL-sync selectedId so reload keeps the kiosk on the right event.
  // Replace (not push) keeps the back button useful — the typical user
  // never wants to "go back" between events.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (selectedId) params.set('event', selectedId); else params.delete('event')
    const q = params.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  // searchParams excluded — including it would feedback-loop on the URL
  // we just wrote.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, pathname, router])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const byView = view === 'in' ? attendees.filter(a => a.checkedIn)
      : view === 'remaining' ? attendees.filter(a => !a.checkedIn)
      : attendees
    // Null-safe: lower-casing a missing email threw on the first keystroke
    // for co-hosts, whose rows carry no email.
    return q ? byView.filter(a => matchesPersonSearch(a.user, q)) : byView
  }, [attendees, search, view])

  const checkedInCount = attendees.filter(a => a.checkedIn).length
  const event = events.find(e => e.id === selectedId)

  // Event picker scope. Default to "today + future" so a kiosk left
  // open past midnight no longer surfaces the previous day's events.
  // "Show all" reveals everything for admins fixing yesterday's data.
  const visibleEvents = useMemo(() => {
    if (showAllEvents) return events
    const today = todayInTz(tz)
    return events.filter(e => e.date >= today)
  }, [events, showAllEvents])
  // Only surface the city in the option label when the visible events span
  // more than one — otherwise it's noise in single-city door ops.
  const multiCity = new Set(visibleEvents.map(e => e.city?.slug).filter(Boolean)).size > 1

  // If toggling back from "Show all" with a past event selected, snap
  // to the first current/future event so the dropdown doesn't render
  // with no matching option. Same guard runs after the initial fetch
  // via the `defaultEventId` check, this covers the post-fetch
  // user-driven path.
  useEffect(() => {
    if (showAllEvents || !selectedId || events.length === 0) return
    const today    = todayInTz(tz)
    const current  = events.find(e => e.id === selectedId)
    if (current && current.date < today) {
      const next = events.find(e => e.date >= today)
      if (next) setSelectedId(next.id)
    }
  }, [showAllEvents, selectedId, events])

  // Taps that can't reach the server wait on this device (lib/checkinQueue);
  // one the server turns down on replay is undone and said out loud.
  const { pending, send } = useCheckinSync(selectedId, (item, error) => {
    setAttendees(prev => prev.map(x => x.userId === item.userId ? { ...x, checkedIn: !item.checkedIn, attendance: 'unknown' } : x))
    vibrate.error()
    toast.error(error)
  })
  const pendingIds = new Set(pending.map(q => q.userId))
  // "Mark the rest" — the same action as /host/checkin (hooks/useCloseOut).
  const { rest, closing, markRest } = useCloseOut({ eventId: selectedId, attendees, setAttendees })
  const started = !!event && todayInTz(tz) >= event.date

  async function toggle(a: Attendee) {
    if (toggling.has(a.id)) return  // ignore double-taps while inflight
    const next = !a.checkedIn
    // Optimistic update — kept in scope so we can roll back on failure.
    // The old impl fired-and-forgot the fetch; a 500 would leave the
    // row showing "checked in" forever while the server still said
    // otherwise.
    setAttendees(prev => prev.map(x => x.id === a.id ? { ...x, checkedIn: next, attendance: next ? 'attended' : 'unknown' } : x))
    setToggling(prev => { const s = new Set(prev); s.add(a.id); return s })
    flashLastChecked(a.userId)
    // No signal keeps the tap on this device until it can be sent
    // (useCheckinSync); only the server's refusal rolls it back, with its
    // reason (e.g. attendance already settled) in the toast.
    try {
      const outcome = await send(a.userId, next)
      if (outcome.kind === 'refused') {
        // Roll back the optimistic flip and tell the operator. Vibrate so
        // a kiosk operator scanning rapidly notices without looking.
        setAttendees(prev => prev.map(x => x.id === a.id ? { ...x, checkedIn: a.checkedIn, attendance: a.attendance } : x))
        vibrate.error()
        toast.error(`Failed to ${next ? 'check in' : 'undo'} ${a.user.name} — ${outcome.error}`)
      }
    } finally {
      setToggling(prev => { const s = new Set(prev); s.delete(a.id); return s })
    }
  }

  // useScanCheckin owns the scan flow (parse → look up → vibrate →
  // optimistic PATCH with rollback → toast). flashLastChecked still
  // happens here as the admin-only highlight side-effect.
  const { scanning, setScanning, scanResult, handleScan } = useScanCheckin({
    eventId:           selectedId,
    attendees,
    setAttendees,
    onCheckinSuccess:  flashLastChecked,
    send,
  })

  return (
    // Desktop admins reviewing a long list shouldn't be punished by the
    // mobile-kiosk column width — caps at max-w-lg on phones, max-w-3xl
    // (~768px) on lg+ where there's screen to use. flex-col + flex-1
    // overflow-y-auto used to constrain the list to its own scroll so
    // the header stayed pinned by accident; with `min-h-screen` the
    // inner container sometimes exceeded viewport and outer-main
    // scrolled instead, taking the header off-screen. Now header +
    // search are explicitly sticky to the outer scroll, and the list
    // scrolls with the page like every other admin surface.
    <div className="min-h-screen bg-black text-white max-w-lg lg:max-w-3xl mx-auto">

      {/* Sticky header — event picker + scan button + stats stay
          in view while the operator scrolls a long attendee list. */}
      <div className="sticky top-0 z-20 bg-black border-b border-zinc-800">
      <div className="px-4 pt-5 pb-3">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-lg font-bold">Check-In</h1>
          <button
            onClick={() => setScanning(true)}
            disabled={!selectedId || loadingAtts}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
            Scan Card
          </button>
        </div>

        {loadingEvents ? (
          <div className="text-zinc-500 text-sm">Loading events…</div>
        ) : eventsError ? (
          <LoadErrorBanner message={eventsError} title="Couldn't load events"
            onRetry={() => { setLoadingEvents(true); setEventsTick(t => t + 1) }} />
        ) : (
          <>
            <select
              value={selectedId}
              onChange={e => { setSelectedId(e.target.value); setSearch('') }}
              className="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-zinc-500"
            >
              {visibleEvents.length === 0 && (
                <option value="">
                  {showAllEvents ? 'No events' : 'No events today'}
                </option>
              )}
              {visibleEvents.map(e => (
                <option key={e.id} value={e.id}>{e.emoji} {e.title} — {e.date}{multiCity && e.city ? ` · ${e.city.name}` : ''}</option>
              ))}
            </select>
            {/* Toggle is a single tap to switch between today-only (the
                default kiosk view) and the full list (for prepping
                tomorrow or fixing yesterday's data). Only renders when
                there's actually more in `events` than the filter shows. */}
            {events.length > visibleEvents.length && (
              <button onClick={() => setShowAllEvents(true)}
                className="mt-2 text-xs text-zinc-500 hover:text-amber-400 transition-colors">
                Show all {events.length} events →
              </button>
            )}
            {showAllEvents && (
              <button onClick={() => setShowAllEvents(false)}
                className="mt-2 text-xs text-zinc-500 hover:text-amber-400 transition-colors">
                ← Today only
              </button>
            )}
          </>
        )}

        {event && attendees.length > 0 && (
          <>
            {/* Tiles double as filters — tap Checked in / Remaining to
                narrow the list, tap again (or Total) to show everyone. */}
            <div className="flex items-center gap-4 mt-3">
              <button onClick={() => setView(v => v === 'in' ? 'all' : 'in')}
                className={`flex-1 bg-zinc-900 rounded-xl p-3 text-center border active:scale-[0.98] transition-all ${view === 'in' ? 'border-green-500' : 'border-transparent'}`}>
                <div className="text-2xl font-bold text-green-400">{checkedInCount}</div>
                <div className="text-xs text-zinc-500 mt-0.5">{view === 'in' ? 'Showing checked-in ↓' : 'Checked in'}</div>
              </button>
              <button onClick={() => setView(v => v === 'remaining' ? 'all' : 'remaining')}
                className={`flex-1 bg-zinc-900 rounded-xl p-3 text-center border active:scale-[0.98] transition-all ${view === 'remaining' ? 'border-amber-500' : 'border-transparent'}`}>
                <div className="text-2xl font-bold">{attendees.length - checkedInCount}</div>
                {/* "Expected" used to live here, which read like "the
                    planned count" — actually this is the still-to-arrive
                    delta. "Remaining" is what an operator at the door
                    reads correctly under pressure. */}
                <div className="text-xs text-zinc-500 mt-0.5">{view === 'remaining' ? 'Showing remaining ↓' : 'Remaining'}</div>
              </button>
              <button onClick={() => setView('all')}
                className="flex-1 bg-zinc-900 rounded-xl p-3 text-center border border-transparent active:scale-[0.98] transition-all">
                <div className="text-2xl font-bold text-zinc-400">{attendees.length}</div>
                <div className="text-xs text-zinc-500 mt-0.5">Total</div>
              </button>
            </div>
            <div className="mt-3 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-300"
                style={{ width: `${(checkedInCount / attendees.length) * 100}%` }}
              />
            </div>
          </>
        )}
      </div>

      {/* Search */}
      <div className="px-4 py-3 border-t border-zinc-800">
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email… ( / to focus )"
          autoComplete="off"
          className="w-full bg-zinc-900 border border-zinc-700 text-white text-base rounded-xl px-4 py-3 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
        {pending.length > 0 && (
          <p className="mt-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            No signal — {pending.length} check-in{pending.length === 1 ? '' : 's'} saved on this device, sending as soon as it&apos;s back online.
          </p>
        )}
      </div>
      </div>

      {/* Attendee list — scrolls with the page now that header+search
          are sticky. Old flex-1 + overflow-y-auto constrained the list
          to its own internal scroll, which only worked when the inner
          container exactly matched viewport height. */}
      <div className="divide-y divide-zinc-900">
        {loadingAtts && (
          <div className="px-4 py-10 text-center text-zinc-500 text-sm">Loading attendees…</div>
        )}
        {!loadingAtts && attsError && selectedId && (
          <div className="px-4 py-6">
            <LoadErrorBanner message={attsError} title="Couldn't load attendees" onRetry={() => setAttsTick(t => t + 1)} />
          </div>
        )}
        {!loadingAtts && !attsError && filtered.length === 0 && (
          <div className="px-4 py-10 text-center text-zinc-500 text-sm">
            {/* Three distinct empty states — old code collapsed all of
                them into "No attendees registered", which was wrong on
                the "no event selected" and "search miss" paths. */}
            {!selectedId
              ? 'Pick an event to start checking in.'
              : search
                ? 'No match found.'
                : view === 'in'
                  ? 'Nobody checked in yet.'
                  : view === 'remaining'
                    ? 'Everyone is checked in 🎉'
                    : 'No attendees registered for this event yet.'}
          </div>
        )}
        {filtered.map(a => {
          const isIn     = a.checkedIn
          const justDone = lastChecked === a.userId
          const isBusy   = toggling.has(a.id)

          return (
            <button
              key={a.id}
              onClick={() => toggle(a)}
              disabled={isBusy}
              className={`w-full flex items-center gap-4 px-4 py-4 active:opacity-70 transition-colors text-left disabled:opacity-60 ${
                isIn ? 'bg-green-950/40' : 'bg-black'
              }`}
            >
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                style={{ backgroundColor: a.user.color }}
              >
                {getInitials(a.user.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-base text-white">{a.user.name}</div>
                {!isIn && a.attendance === 'no_show' && <div className="text-xs font-semibold text-red-400 mt-0.5">No-show</div>}
                {pendingIds.has(a.userId) && <div className="text-[11px] text-amber-400 mt-0.5">Not sent yet</div>}
                <div className="text-xs text-zinc-500 truncate mt-0.5">{a.user.email}</div>
              </div>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all ${
                justDone
                  ? 'bg-green-500 scale-110'
                  : isIn
                  ? 'bg-green-500/20 border-2 border-green-500'
                  : 'bg-zinc-800 border-2 border-zinc-700'
              }`}>
                {isBusy ? (
                  <div className="w-4 h-4 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />
                ) : isIn && (
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Close out the door. Counts the whole roster, not the search or tile filter. */}
      {started && !loadingAtts && rest.length > 0 && (
        <div className="px-4 py-5">
          <button
            onClick={markRest}
            disabled={closing || pending.length > 0}
            className="w-full py-3 rounded-xl border border-red-900/60 bg-red-950/30 text-sm font-semibold text-red-300 hover:bg-red-950/50 transition-colors disabled:opacity-50"
          >
            {closing ? 'Marking…' : `Mark the other ${rest.length} as no-show`}
          </button>
          <p className="text-xs text-zinc-500 text-center mt-2">
            {pending.length > 0
              ? 'Waiting for the check-ins on this device to send first.'
              : 'For the end of the event. Nothing is sent to anyone, and a late arrival can still be checked in.'}
          </p>
        </div>
      )}

      {/* QR Scanner */}
      {scanning && (
        <QRScanner onScan={handleScan} onClose={() => setScanning(false)} />
      )}

      {/* Scan result toast — shared component handles the per-type
          color, icon, and copy so the two pages can't drift again. */}
      <ScanResultToast result={scanResult} position="bottom" />
    </div>
  )
}

export default function CheckInPage() {
  return (
    <Suspense>
      <CheckInPageInner />
    </Suspense>
  )
}
