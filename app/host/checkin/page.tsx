'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { resolveImageUrl, getInitials, todayIstanbul } from '@/lib/data'
import SwipeRow from '@/components/SwipeRow'
import dynamic from 'next/dynamic'

const QRScanner = dynamic(() => import('@/components/QRScanner'), { ssr: false })

interface HostEvent {
  id: string
  title: string
  date: string
  time: string
  emoji: string
}

interface Attendee {
  userId: string
  checkedIn: boolean
  user: { id: string; name: string; color: string; email: string; profilePhoto?: string | null }
}

function EventList() {
  const [events,  setEvents]  = useState<HostEvent[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    fetch('/app/api/host/events', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const today = todayIstanbul()
        setEvents(Array.isArray(d) ? d.filter((e: HostEvent) => e.date === today) : [])
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-zinc-500 text-sm">Loading…</div>

  if (events.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center">
        <div className="text-3xl mb-2">📅</div>
        <div className="text-zinc-400 text-sm">No events today.</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {events.map(e => (
        <button key={e.id} onClick={() => router.push(`/host/checkin?event=${e.id}`)}
          className="w-full flex items-center gap-4 bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-600 transition-colors text-left">
          <span className="text-3xl">{e.emoji}</span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-white truncate">{e.title}</div>
            <div className="text-xs text-zinc-400 mt-0.5">{e.time}</div>
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

  const [attendees,   setAttendees]   = useState<Attendee[]>([])
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [eventName,   setEventName]   = useState('')
  const [toggling,    setToggling]    = useState<string | null>(null)
  const [scanning,    setScanning]    = useState(false)
  const [scanResult,  setScanResult]  = useState<{ name: string; ok: boolean } | null>(null)

  useEffect(() => {
    if (!eventId) return
    Promise.all([
      fetch(`/app/api/events/${eventId}/checkin`, { credentials: 'include' }).then(r => r.json()),
      fetch(`/app/api/events/${eventId}`, { credentials: 'include' }).then(r => r.json()),
    ]).then(([att, ev]) => {
      setAttendees(Array.isArray(att) ? att : [])
      if (ev?.title) setEventName(ev.title)
    }).finally(() => setLoading(false))
  }, [eventId])

  async function toggleCheckin(userId: string, current: boolean) {
    setToggling(userId)
    const res = await fetch(`/app/api/events/${eventId}/checkin`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, checkedIn: !current }),
    })
    if (res.ok) {
      setAttendees(prev => prev.map(a => a.userId === userId ? { ...a, checkedIn: !current } : a))
      if (!current) navigator.vibrate?.([50, 30, 80])
    }
    setToggling(null)
  }

  async function handleQRScan(value: string) {
    setScanning(false)
    const parts = value.split(':')

    // Accept member card QR: "smileys:member:{userId}"
    // Also accept legacy event-specific QR: "smileys-checkin:{eventId}:{userId}"
    let userId: string | undefined
    if (parts[0] === 'smileys' && parts[1] === 'member') {
      userId = parts[2]
    } else if (parts[0] === 'smileys-checkin' && parts[1] === eventId) {
      userId = parts[2]
    }

    if (!userId) {
      setScanResult({ name: 'Invalid QR code', ok: false })
      setTimeout(() => setScanResult(null), 3000)
      return
    }

    const attendee = attendees.find(a => a.userId === userId)
    if (!attendee) {
      setScanResult({ name: 'Not on the guest list', ok: false })
      navigator.vibrate?.([100, 50, 100])
      setTimeout(() => setScanResult(null), 3000)
      return
    }
    if (attendee.checkedIn) {
      setScanResult({ name: `${attendee.user.name} — already checked in`, ok: true })
      navigator.vibrate?.(40)
      setTimeout(() => setScanResult(null), 2500)
      return
    }
    const res = await fetch(`/app/api/events/${eventId}/checkin`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, checkedIn: true }),
    })
    if (res.ok) {
      setAttendees(prev => prev.map(a => a.userId === userId ? { ...a, checkedIn: true } : a))
      setScanResult({ name: attendee.user.name, ok: true })
      navigator.vibrate?.([50, 30, 80])
    } else {
      setScanResult({ name: 'Check-in failed', ok: false })
      navigator.vibrate?.([100, 50, 100])
    }
    setTimeout(() => setScanResult(null), 3000)
  }

  const checkedInCount = attendees.filter(a => a.checkedIn).length
  const visible = attendees.filter(a =>
    !search || a.user.name.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) return <div className="text-zinc-500 text-sm">Loading attendees…</div>

  return (
    <div className="space-y-4">
      {scanning && <QRScanner onScan={handleQRScan} onClose={() => setScanning(false)} />}

      {scanResult && (
        <div className={`fixed top-4 left-4 right-4 z-40 px-4 py-3 rounded-2xl text-sm font-semibold text-center shadow-xl ${
          scanResult.ok ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {scanResult.ok ? '✓ ' : '✕ '}{scanResult.name}
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
          <p className="text-xs text-zinc-400">{checkedInCount} / {attendees.length} checked in</p>
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
          style={{ width: attendees.length > 0 ? `${(checkedInCount / attendees.length) * 100}%` : '0%' }}
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

      {/* Attendee list */}
      {visible.length === 0 ? (
        <div className="text-zinc-500 text-sm text-center py-8">No attendees found.</div>
      ) : (
        <div className="space-y-2">
          {visible.map(a => {
            const photo = resolveImageUrl(a.user.profilePhoto ?? null)
            return (
              <SwipeRow
                key={a.userId}
                onSwipeRight={a.checkedIn ? undefined : () => toggleCheckin(a.userId, false)}
                onSwipeLeft={a.checkedIn ? () => toggleCheckin(a.userId, true) : undefined}
              >
                <div
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                    a.checkedIn ? 'bg-green-900/20 border-green-800' : 'bg-zinc-900 border-zinc-800'
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
                    <p className="text-xs text-zinc-400 truncate">{a.user.email}</p>
                  </div>
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
        <h1 className="text-2xl font-bold text-white">Check-In</h1>
        <p className="text-zinc-400 text-sm mt-1">Tap the + to check in an attendee</p>
      </div>
      <Suspense fallback={<div className="text-zinc-500 text-sm">Loading…</div>}>
        <CheckinContent />
      </Suspense>
    </div>
  )
}
