'use client'

import Link from 'next/link'
import { formatDay } from '@/lib/cityTime'
import posthog from 'posthog-js'

export interface MatchedEvent { id: string; title: string; emoji: string; date: string; neighborhood: string | null }

// §15 + §30 — nearby-event links with the guide_to_event outcome metric.
// Client component purely for the click capture; the data arrives
// server-rendered from the ISR page.
export default function EventMatches({ events }: { events: MatchedEvent[] }) {
  if (events.length === 0) return null
  return (
    <div className="relative space-y-2 mb-5">
      <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">Coming up nearby</p>
      {events.map(ev => (
        <Link key={ev.id} href={`/events/${ev.id}`}
          onClick={() => posthog.capture('guide_to_event', { eventId: ev.id })}
          className="flex items-center gap-3 bg-white/10 hover:bg-white/20 rounded-xl px-4 py-2.5 transition-colors">
          <span aria-hidden="true" className="shrink-0">{ev.emoji}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white truncate">{ev.title}</p>
            <p className="text-xs text-gray-300 mt-0.5">
              {formatDay(ev.date)}
              {ev.neighborhood && <> · 📍 {ev.neighborhood}</>}
            </p>
          </div>
          <span className="shrink-0 text-xs font-bold text-amber-400">View →</span>
        </Link>
      ))}
    </div>
  )
}
