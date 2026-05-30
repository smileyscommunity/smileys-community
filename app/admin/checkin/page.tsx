'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { getInitials } from '@/lib/data'
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

  useEffect(() => {
    fetch('/app/api/admin/events', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data.filter((e: Event) => e.status !== 'cancelled' && e.status !== 'archived') : []
        setEvents(list)
        if (!defaultEventId && list.length > 0) setSelectedId(list[0].id)
      })
      .finally(() => setLoadingEvents(false))
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

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return q
      ? attendees.filter(a => a.user.name.toLowerCase().includes(q) || a.user.email.toLowerCase().includes(q))
      : attendees
  }, [attendees, search])

  const checkedInCount = attendees.filter(a => a.checkedIn).length
  const event = events.find(e => e.id === selectedId)

  async function toggle(a: Attendee) {
    const next = !a.checkedIn
    setAttendees(prev => prev.map(x => x.id === a.id ? { ...x, checkedIn: next } : x))
    setLastChecked(a.userId)
    setTimeout(() => setLastChecked(null), 1500)
    await fetch(`/app/api/events/${selectedId}/checkin`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: a.userId, checkedIn: next }),
    })
  }

  const handleScan = useCallback(async (raw: string) => {
    setScanning(false)

    // Shared parser accepts both the member-card format and the legacy
    // event-bound format — older codes used to fail silently on the
    // admin page because it only recognised the new one.
    const userId = parseCheckinQR(raw, selectedId)
    if (!userId) {
      vibrate.error()
      setScanResult({ type: 'invalid' })
      setTimeout(() => setScanResult(null), 3000)
      return
    }

    const attendee = attendees.find(a => a.userId === userId)

    if (!attendee) {
      vibrate.error()
      setScanResult({ type: 'notfound' })
      setTimeout(() => setScanResult(null), 3000)
      return
    }

    if (attendee.checkedIn) {
      vibrate.alreadyCheckedIn()
      setScanResult({ type: 'already', name: attendee.user.name })
      setTimeout(() => setScanResult(null), 3000)
      return
    }

    // Check them in
    setAttendees(prev => prev.map(a => a.userId === userId ? { ...a, checkedIn: true } : a))
    setLastChecked(userId)
    setTimeout(() => setLastChecked(null), 1500)
    vibrate.success()
    setScanResult({ type: 'success', name: attendee.user.name })
    setTimeout(() => setScanResult(null), 3000)

    await fetch(`/app/api/events/${selectedId}/checkin`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, checkedIn: true }),
    })
  }, [attendees, selectedId])

  return (
    <div className="min-h-screen bg-black text-white flex flex-col max-w-lg mx-auto">

      {/* Header */}
      <div className="px-4 pt-5 pb-3 border-b border-zinc-800">
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
          <select
            value={selectedId}
            onChange={e => { setSelectedId(e.target.value); setSearch('') }}
            className="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-zinc-500"
          >
            {events.length === 0 && <option value="">No events</option>}
            {events.map(e => (
              <option key={e.id} value={e.id}>{e.emoji} {e.title} — {e.date}</option>
            ))}
          </select>
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
                <div className="text-xs text-zinc-500 mt-0.5">Expected</div>
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
      <div className="px-4 py-3 border-b border-zinc-800">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          autoComplete="off"
          className="w-full bg-zinc-900 border border-zinc-700 text-white text-base rounded-xl px-4 py-3 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
      </div>

      {/* Attendee list */}
      <div className="flex-1 divide-y divide-zinc-900 overflow-y-auto">
        {loadingAtts && (
          <div className="px-4 py-10 text-center text-zinc-500 text-sm">Loading attendees…</div>
        )}
        {!loadingAtts && filtered.length === 0 && (
          <div className="px-4 py-10 text-center text-zinc-500 text-sm">
            {search ? 'No match found' : 'No attendees registered'}
          </div>
        )}
        {filtered.map(a => {
          const isIn     = a.checkedIn
          const justDone = lastChecked === a.userId

          return (
            <button
              key={a.id}
              onClick={() => toggle(a)}
              className={`w-full flex items-center gap-4 px-4 py-4 active:opacity-70 transition-colors text-left ${
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
                {isIn && (
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
