'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { Suspense } from 'react'
import { getInitials, todayIstanbul } from '@/lib/data'
import { parseCheckinQR, vibrate } from '@/lib/checkin'
import QRScanner from '@/components/QRScanner'

interface Event {
  id: string
  title: string
  date: string
  time: string
  emoji: string
  status: string
}

interface Attendee {
  id: string
  userId: string
  checkedIn: boolean
  user: { id: string; name: string; color: string; email: string }
}

interface ScanResult {
  type: 'success' | 'already' | 'notfound' | 'invalid'
  name?: string
}

function CheckInPageInner() {
  const searchParams    = useSearchParams()
  const router          = useRouter()
  const pathname        = usePathname()
  const defaultEventId  = searchParams.get('event') ?? ''

  const [events,        setEvents]        = useState<Event[]>([])
  const [selectedId,    setSelectedId]    = useState(defaultEventId)
  const [attendees,     setAttendees]     = useState<Attendee[]>([])
  const [loadingEvents, setLoadingEvents] = useState(true)
  const [loadingAtts,   setLoadingAtts]   = useState(false)
  const [search,        setSearch]        = useState('')
  const [lastChecked,   setLastChecked]   = useState<string | null>(null)
  const [scanning,      setScanning]      = useState(false)
  const [scanResult,    setScanResult]    = useState<ScanResult | null>(null)
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

  // Shared refs for both visual timers (lastChecked highlight + scan
  // result toast). Storing them in refs lets us cancel the previous
  // timeout when a new check-in lands and clear both on unmount, so a
  // scanner kiosk that's been running all evening doesn't leak handles
  // or fire setState on an unmounted page.
  const lastCheckedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scanResultTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashLastChecked = useCallback((userId: string) => {
    setLastChecked(userId)
    if (lastCheckedTimer.current) clearTimeout(lastCheckedTimer.current)
    lastCheckedTimer.current = setTimeout(() => setLastChecked(null), 1500)
  }, [])
  const flashScanResult = useCallback((result: ScanResult, ms = 3000) => {
    setScanResult(result)
    if (scanResultTimer.current) clearTimeout(scanResultTimer.current)
    scanResultTimer.current = setTimeout(() => setScanResult(null), ms)
  }, [])
  useEffect(() => () => {
    if (lastCheckedTimer.current) clearTimeout(lastCheckedTimer.current)
    if (scanResultTimer.current)  clearTimeout(scanResultTimer.current)
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
    fetch('/app/api/admin/events', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data.filter((e: Event) => e.status !== 'cancelled' && e.status !== 'archived') : []
        setEvents(list)
        if (!defaultEventId && list.length > 0) setSelectedId(list[0].id)
      })
      .finally(() => setLoadingEvents(false))
  // defaultEventId is intentionally read once on mount — adding it to
  // deps would refire the events fetch every time we router.replace()
  // to sync the URL with the active selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedId) return
    setLoadingAtts(true)
    setAttendees([])
    fetch(`/app/api/events/${selectedId}/checkin`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setAttendees(Array.isArray(data) ? data : []))
      .finally(() => setLoadingAtts(false))
  }, [selectedId])

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
    return q
      ? attendees.filter(a => a.user.name.toLowerCase().includes(q) || a.user.email.toLowerCase().includes(q))
      : attendees
  }, [attendees, search])

  const checkedInCount = attendees.filter(a => a.checkedIn).length
  const event = events.find(e => e.id === selectedId)

  // Event picker scope. Default to "today" so a kiosk operator opens
  // the page and sees only the events they're actually checking people
  // into. The "Show all" toggle below the dropdown reveals the full
  // list (still excluding archived/cancelled — those are filtered at
  // fetch time). The currently-selected event is always included so a
  // deep link to a past event still shows its title in the dropdown.
  const visibleEvents = useMemo(() => {
    if (showAllEvents) return events
    const today = todayIstanbul()
    return events.filter(e => e.date === today || e.id === selectedId)
  }, [events, showAllEvents, selectedId])

  async function toggle(a: Attendee) {
    if (toggling.has(a.id)) return  // ignore double-taps while inflight
    const next = !a.checkedIn
    // Optimistic update — kept in scope so we can roll back on failure.
    // The old impl fired-and-forgot the fetch; a 500 would leave the
    // row showing "checked in" forever while the server still said
    // otherwise.
    setAttendees(prev => prev.map(x => x.id === a.id ? { ...x, checkedIn: next } : x))
    setToggling(prev => { const s = new Set(prev); s.add(a.id); return s })
    flashLastChecked(a.userId)
    try {
      const res = await fetch(`/app/api/events/${selectedId}/checkin`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: a.userId, checkedIn: next }),
      })
      if (!res.ok) throw new Error()
    } catch {
      // Roll back the optimistic flip and tell the operator. Vibrate so
      // a kiosk operator scanning rapidly notices without looking.
      setAttendees(prev => prev.map(x => x.id === a.id ? { ...x, checkedIn: a.checkedIn } : x))
      vibrate.error()
      toast.error(`Failed to ${next ? 'check in' : 'undo'} ${a.user.name}`)
    } finally {
      setToggling(prev => { const s = new Set(prev); s.delete(a.id); return s })
    }
  }

  const handleScan = useCallback(async (raw: string) => {
    setScanning(false)

    // Shared parser accepts both the member-card format and the legacy
    // event-bound format — older codes used to fail silently on the
    // admin page because it only recognised the new one.
    const userId = parseCheckinQR(raw, selectedId)
    if (!userId) {
      vibrate.error()
      flashScanResult({ type: 'invalid' })
      return
    }

    const attendee = attendees.find(a => a.userId === userId)

    if (!attendee) {
      vibrate.error()
      flashScanResult({ type: 'notfound' })
      return
    }

    if (attendee.checkedIn) {
      vibrate.alreadyCheckedIn()
      flashScanResult({ type: 'already', name: attendee.user.name })
      return
    }

    // Check them in. Old impl flipped the optimistic state, fired the
    // PATCH, and called the scan a success without ever inspecting the
    // response. A 500 would leave the row showing "checked in" forever
    // while the server still said otherwise. Now we await + roll back
    // on failure.
    setAttendees(prev => prev.map(a => a.userId === userId ? { ...a, checkedIn: true } : a))
    flashLastChecked(userId)
    try {
      const res = await fetch(`/app/api/events/${selectedId}/checkin`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, checkedIn: true }),
      })
      if (!res.ok) throw new Error()
      vibrate.success()
      flashScanResult({ type: 'success', name: attendee.user.name })
    } catch {
      setAttendees(prev => prev.map(a => a.userId === userId ? { ...a, checkedIn: false } : a))
      vibrate.error()
      flashScanResult({ type: 'notfound', name: attendee.user.name })  // surfaces via the red toast
      toast.error(`Failed to check in ${attendee.user.name}`)
    }
  }, [attendees, selectedId, flashLastChecked, flashScanResult])

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
                <option key={e.id} value={e.id}>{e.emoji} {e.title} — {e.date}</option>
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
            <div className="flex items-center gap-4 mt-3">
              <div className="flex-1 bg-zinc-900 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-green-400">{checkedInCount}</div>
                <div className="text-xs text-zinc-500 mt-0.5">Checked in</div>
              </div>
              <div className="flex-1 bg-zinc-900 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold">{attendees.length - checkedInCount}</div>
                {/* "Expected" used to live here, which read like "the
                    planned count" — actually this is the still-to-arrive
                    delta. "Remaining" is what an operator at the door
                    reads correctly under pressure. */}
                <div className="text-xs text-zinc-500 mt-0.5">Remaining</div>
              </div>
              <div className="flex-1 bg-zinc-900 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-zinc-400">{attendees.length}</div>
                <div className="text-xs text-zinc-500 mt-0.5">Total</div>
              </div>
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
        {!loadingAtts && filtered.length === 0 && (
          <div className="px-4 py-10 text-center text-zinc-500 text-sm">
            {/* Three distinct empty states — old code collapsed all of
                them into "No attendees registered", which was wrong on
                the "no event selected" and "search miss" paths. */}
            {!selectedId
              ? 'Pick an event to start checking in.'
              : search
                ? 'No match found.'
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

      {/* QR Scanner */}
      {scanning && (
        <QRScanner onScan={handleScan} onClose={() => setScanning(false)} />
      )}

      {/* Scan result toast */}
      {scanResult && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold flex items-center gap-2 ${
          scanResult.type === 'success'  ? 'bg-green-500 text-white' :
          scanResult.type === 'already' ? 'bg-amber-500 text-white' :
          'bg-red-500 text-white'
        }`}>
          {scanResult.type === 'success'  && <><span>✓</span><span>{scanResult.name} checked in!</span></>}
          {scanResult.type === 'already'  && <><span>↩</span><span>{scanResult.name} already checked in</span></>}
          {scanResult.type === 'notfound' && <><span>✕</span><span>Not registered for this event</span></>}
          {scanResult.type === 'invalid'  && <><span>✕</span><span>Invalid QR code</span></>}
        </div>
      )}
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
