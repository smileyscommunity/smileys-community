'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import EventCard from '@/components/EventCard'
import type { Event } from '@/lib/data'

// Tabbed event discovery for the marketing pages: Today / This week / Weekend /
// All. Filtering happens client-side over one already-fetched list — the
// homepage caches its data for 60s, and refetching per tab would trade that
// away for nothing.
//
// The date boundaries are computed on the SERVER and passed in, deliberately.
// Event.date is a plain 'YYYY-MM-DD' string in Istanbul terms, so deriving
// "today" from the visitor's clock would show a member in Los Angeles a
// different Tuesday than the platform means. Same reasoning as hourCycle:'h23'
// elsewhere in the codebase: never let the viewer's timezone decide what day it
// is for the community.

export interface EventWindow {
  today:        string   // YYYY-MM-DD, Istanbul
  weekEnd:      string   // last day of the current week (Sunday), inclusive
  weekendStart: string   // the coming Saturday
  weekendEnd:   string   // the coming Sunday
}

type TabKey = 'today' | 'week' | 'weekend' | 'all'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'today',   label: 'Today' },
  { key: 'week',    label: 'This week' },
  { key: 'weekend', label: 'Weekend' },
  { key: 'all',     label: 'All events' },
]

function matches(e: Event, tab: TabKey, w: EventWindow): boolean {
  switch (tab) {
    case 'today':   return e.date === w.today
    case 'week':    return e.date >= w.today && e.date <= w.weekEnd
    case 'weekend': return e.date >= w.weekendStart && e.date <= w.weekendEnd
    case 'all':     return true
  }
}

export default function EventTabs({
  events,
  window: w,
  linkPrefix = '/events',
  limit = 3,
}: {
  // cityName rides each event when the caller mixes cities (the global
  // landing page) so every card names where its dinner actually is.
  events: (Event & { cityName?: string })[]
  window: EventWindow
  linkPrefix?: string
  limit?: number
}) {
  // Open on the first tab that actually has something. A "Today" tab that
  // greets every visitor with an empty state makes a busy calendar look dead.
  const counts = useMemo(
    () => Object.fromEntries(TABS.map(t => [t.key, events.filter(e => matches(e, t.key, w)).length])) as Record<TabKey, number>,
    [events, w],
  )
  const [tab, setTab] = useState<TabKey>(() => TABS.find(t => counts[t.key] > 0)?.key ?? 'all')

  const shown = events.filter(e => matches(e, tab, w)).slice(0, limit)

  return (
    <>
      <div role="tablist" aria-label="Filter events by date" className="flex flex-wrap gap-2 mb-6">
        {TABS.map(t => {
          const active = t.key === tab
          const n = counts[t.key]
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                active
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {t.label}
              {/* The count is the useful part — it says "worth a click" before
                  the click. Omitted at zero rather than shown as "(0)". */}
              {n > 0 && <span className={`ml-1.5 tabular-nums ${active ? 'text-white/60' : 'text-gray-400'}`}>{n}</span>}
            </button>
          )
        })}
      </div>

      {shown.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {shown.map(e => <EventCard key={e.id} event={e} linkPrefix={linkPrefix} cityName={e.cityName} />)}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-gray-600">
            Nothing on {tab === 'today' ? 'today' : tab === 'weekend' ? 'this weekend' : 'this week'} just yet.
          </p>
          <button onClick={() => setTab('all')} className="mt-3 text-sm font-semibold text-amber-600 hover:underline">
            See what's coming up →
          </button>
        </div>
      )}

      <div className="mt-8 text-center md:text-left">
        <Link href="/events" className="btn-secondary md:btn-ghost">View all events</Link>
      </div>
    </>
  )
}
