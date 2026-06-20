'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { todayIstanbul } from '@/lib/data'
import HostImpactStats from '@/components/HostImpactStats'

interface Event {
  id: string
  title: string
  date: string
  time: string
  location: string
  status: string
  emoji: string
  totalSpots: number
  checkedInCount?: number
  _count?: { attendees: number }
}


export default function HostDashboard() {
  const { user } = useAuth()
  const [events,  setEvents]  = useState<Event[]>([])
  const [loading, setLoading] = useState(true)

  const canEvents = user.isClubHost || user.role === 'admin'
  const canClubs  = canEvents

  useEffect(() => {
    if (!canEvents) { setLoading(false); return }
    fetch('/app/api/host/events', { credentials: 'include' })
      .then(r => r.json()).then(d => setEvents(Array.isArray(d) ? d : [])).catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const today     = todayIstanbul()
  const upcoming  = events.filter(e => e.status === 'published' && e.date >= today)
  const past      = events
    .filter(e => e.date < today && e.status !== 'cancelled' && e.status !== 'draft')
    .sort((a, b) => b.date.localeCompare(a.date))
  const totalAtts = events
    .filter(e => e.status !== 'cancelled' && e.status !== 'draft')
    .reduce((s, e) => s + (e._count?.attendees ?? 0), 0)

  // Exclude unlimited events (totalSpots === 0) from fill rate — they'd always contribute 0%
  const ratedPast = past.filter(e => e.totalSpots > 0)
  const avgFillRate = ratedPast.length > 0
    ? Math.round(ratedPast.reduce((s, e) => s + ((e._count?.attendees ?? 0) / e.totalSpots) * 100, 0) / ratedPast.length)
    : null

  // Avg show-up rate: checked-in / registered, for past events that had any registrations
  const checkinPast = past.filter(e => (e._count?.attendees ?? 0) > 0 && (e.checkedInCount ?? 0) > 0)
  const avgCheckinRate = checkinPast.length > 0
    ? Math.round(checkinPast.reduce((s, e) => s + ((e.checkedInCount ?? 0) / (e._count?.attendees ?? 1)) * 100, 0) / checkinPast.length)
    : null

  const nextEvent = upcoming.sort((a, b) => a.date.localeCompare(b.date))[0]
  const daysUntilNext = nextEvent
    ? Math.ceil((new Date(nextEvent.date).getTime() - new Date(today).getTime()) / 86400000)
    : null

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold text-white">Welcome back, {user.name.split(' ')[0]}</h1>
        <p className="text-zinc-400 text-sm mt-1">
          {canEvents && canClubs ? "You manage events and clubs."
            : canClubs ? "You manage clubs."
            : "Here's an overview of your events."}
        </p>
      </div>

      <HostImpactStats />

      {/* Clubs shortcut for moderator-only users */}
      {canClubs && !canEvents && (
        <Link href="/host/clubs" className="block bg-zinc-900 border border-zinc-800 hover:border-amber-500/50 rounded-xl p-6 mb-6 transition-colors group">
          <div className="text-2xl mb-2">🏛️</div>
          <div className="text-white font-semibold group-hover:text-amber-400 transition-colors">Go to My Clubs</div>
          <div className="text-zinc-500 text-sm mt-0.5">Manage announcements, spotlight, rules, resources and photos.</div>
        </Link>
      )}

      {/* Stats — events hosts only */}
      {canEvents && (
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
          <div className="text-3xl font-bold text-white">{totalAtts}</div>
          <div className="text-xs text-zinc-400 mt-1">Total Attendees</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
          <div className="text-3xl font-bold text-white">{upcoming.length}</div>
          <div className="text-xs text-zinc-400 mt-1">Upcoming Events</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
          <div className={`text-3xl font-bold ${avgFillRate !== null ? (avgFillRate >= 70 ? 'text-green-400' : avgFillRate >= 40 ? 'text-amber-400' : 'text-red-400') : 'text-zinc-600'}`}>
            {avgFillRate !== null ? `${avgFillRate}%` : '—'}
          </div>
          <div className="text-xs text-zinc-400 mt-1">Avg Fill Rate</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
          <div className={`text-3xl font-bold ${avgCheckinRate !== null ? (avgCheckinRate >= 70 ? 'text-green-400' : avgCheckinRate >= 40 ? 'text-amber-400' : 'text-red-400') : 'text-zinc-600'}`}>
            {avgCheckinRate !== null ? `${avgCheckinRate}%` : '—'}
          </div>
          <div className="text-xs text-zinc-400 mt-1">Avg Show-up Rate</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
          <div className={`text-3xl font-bold ${daysUntilNext !== null ? (daysUntilNext <= 3 ? 'text-amber-400' : 'text-white') : 'text-zinc-600'}`}>
            {daysUntilNext !== null ? (daysUntilNext === 0 ? 'Today' : `${daysUntilNext}d`) : '—'}
          </div>
          <div className="text-xs text-zinc-400 mt-1">Until Next Event</div>
        </div>
      </div>
      )}

      {/* Upcoming events */}
      {canEvents && <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-zinc-300">Upcoming Events</h2>
        <Link href="/host/events/new" className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">
          + New Event
        </Link>
      </div>

      {loading ? (
        <div className="text-zinc-500 text-sm">Loading…</div>
      ) : upcoming.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
          <div className="text-3xl mb-2">🎉</div>
          <div className="text-zinc-400 text-sm">No upcoming events. Create your first one!</div>
          <Link href="/host/events/new" className="inline-block mt-4 text-xs bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg font-medium transition-colors">
            Create Event
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {upcoming.map(e => (
            <div key={e.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="text-2xl shrink-0">{e.emoji}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/host/events/${e.id}/edit`} className="text-sm font-medium text-white hover:text-amber-400 transition-colors truncate">{e.title}</Link>
                    </div>
                    <div className="text-xs text-zinc-400 mt-0.5">{e.date} · {e.time}</div>
                    <div className="text-xs text-zinc-500 mt-0.5 truncate">{e.location}</div>
                  </div>
                </div>
                <Link href={`/host/events/${e.id}/participants`} className="text-xs text-zinc-400 hover:text-white border border-zinc-700 px-3 py-1.5 rounded-lg transition-colors shrink-0">
                  Participants
                </Link>
                <Link href={`/host/events/${e.id}/edit`} className="text-xs text-zinc-400 hover:text-white border border-zinc-700 px-3 py-1.5 rounded-lg transition-colors shrink-0">
                  Edit
                </Link>
              </div>
              <div className="mt-2 text-xs text-zinc-500 pl-11">
                {e._count?.attendees ?? 0} / {e.totalSpots} attendees
              </div>
            </div>
          ))}
        </div>
      )}

      {past.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">Past Events</h2>
          <div className="space-y-3">
            {past.slice(0, 5).map(e => (
              <div key={e.id} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 opacity-60">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="text-2xl shrink-0">{e.emoji}</span>
                    <div className="min-w-0">
                      <Link href={`/host/events/${e.id}/edit`} className="text-sm font-medium text-white hover:text-amber-400 transition-colors truncate block">{e.title}</Link>
                      <div className="text-xs text-zinc-400 mt-0.5">{e.date} · {e.location}</div>
                    </div>
                  </div>
                  <div className="text-xs text-zinc-500 shrink-0 text-right">
                    <div>{e._count?.attendees ?? 0} registered</div>
                    {(e.checkedInCount ?? 0) > 0 && (() => {
                      const total = e._count?.attendees ?? 0
                      const pct = total > 0 ? Math.round((e.checkedInCount! / total) * 100) : 0
                      return <div className="text-green-400 font-semibold">{e.checkedInCount} showed up ({pct}%)</div>
                    })()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </>}
    </div>
  )
}
