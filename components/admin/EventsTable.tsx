'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { resolveImageUrl } from '@/lib/data'

interface AdminEvent {
  id: string; title: string; date: string; emoji: string
  totalSpots: number; spotsLeft: number
  _count: { attendees: number }
  host: { id: string; name: string; color: string; profilePhoto: string | null } | null
}

export default function EventsTable() {
  const [events, setEvents] = useState<AdminEvent[]>([])
  const [status, setStatus] = useState<'published' | 'draft'>('published')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/app/api/admin/events?status=${status}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => {
        const today = new Date().toISOString().split('T')[0]
        const upcoming = Array.isArray(d)
          ? d.filter((e: AdminEvent) => e.date >= today).slice(0, 8)
          : []
        setEvents(upcoming)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [status])

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-zinc-800/50 p-1 rounded-xl w-fit">
        {(['published', 'draft'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
              status === s ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-8 text-center text-zinc-600 text-xs animate-pulse">Loading {status} events…</div>
      ) : events.length === 0 ? (
        <div className="py-8 text-center text-zinc-500 text-sm italic">No upcoming {status} events.</div>
      ) : (
        <div className="space-y-2">
          {events.map(e => {
            const attending = e._count.attendees
            const pct       = e.totalSpots > 0 ? Math.round((attending / e.totalSpots) * 100) : 0
            const barColor  = pct >= 90 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-500' : 'bg-green-500'
            const host      = e.host
            const initials  = host ? host.name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : ''

            return (
              <Link key={e.id} href={`/admin/events/${e.id}/edit`}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-zinc-800/60 transition-colors group">
                <span className="text-lg w-7 text-center shrink-0">{e.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-zinc-200 group-hover:text-white truncate transition-colors">{e.title}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-zinc-500 shrink-0">{attending}/{e.totalSpots}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-zinc-400">
                    {new Date(e.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </div>
                  {host && (
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center text-white text-[8px] font-bold shrink-0"
                        style={{ backgroundColor: host.color }}>
                        {host.profilePhoto
                          ? <img src={resolveImageUrl(host.profilePhoto)} alt={host.name} className="w-full h-full object-cover" />
                          : initials}
                      </div>
                      <span className="text-xs text-zinc-500 truncate max-w-[70px]">{host.name.split(' ')[0]}</span>
                    </div>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
