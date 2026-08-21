'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { formatDate, formatTime, resolveImageUrl } from '@/lib/data'

// "Your First Event" — the invitation block shown to members who have never
// RSVP'd. Attacks the signed-in→first-RSVP leak by making a specific, nearby,
// low-commitment event feel personally chosen. Cards link to the event page
// (where RSVP already handles waitlists/approval); a click beacon attributes
// the tap for lift measurement. Supplemental surface: on any error it simply
// renders nothing rather than breaking the dashboard.

type Card = {
  id: string
  title: string
  date: string
  time: string
  neighborhood: string
  emoji: string
  coverImage: string | null
  price: number
  spotsLeft: number
  isFirstTimerFriendly: boolean
  attendeeCount: number
  matchedTagIds: string[]
}

export default function FirstEventBlock() {
  const [state, setState] = useState<{ events: Card[]; empty: boolean } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/app/api/first-event?limit=3')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => { if (alive) setState(d) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [])

  // Non-critical surface — stay invisible while loading or on failure.
  if (failed || !state) return null

  const markClick = (id: string) => {
    // keepalive so the beacon survives the navigation the <Link> triggers.
    fetch(`/app/api/first-event/${id}/click`, { method: 'POST', keepalive: true }).catch(() => {})
  }

  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-extrabold text-gray-900">👋 Your first event</h2>
        <Link href="/events" className="text-sm font-semibold text-amber-700 hover:text-amber-800">
          See all →
        </Link>
      </div>

      {state.empty ? (
        // Whole-city empty: keep it warm, point at the full calendar.
        <div className="rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50 p-5 text-center">
          <p className="text-2xl mb-1">🌱</p>
          <p className="font-semibold text-gray-900">Nothing open near you just yet</p>
          <p className="text-sm text-gray-600 mt-1">
            New events pop up across the city every week — the next one is often worth the trip.
          </p>
          <Link href="/events" className="inline-block mt-3 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold px-4 py-2 rounded-xl">
            Explore all events
          </Link>
        </div>
      ) : (
        <p className="text-sm text-gray-500 mb-3 -mt-1">Picked for you — a warm, easy way to meet people.</p>
      )}

      <div className="space-y-3">
        {state.events.map(ev => (
          <Link
            key={ev.id}
            href={`/events/${ev.id}`}
            onClick={() => markClick(ev.id)}
            className="flex gap-3 items-stretch rounded-2xl border border-gray-100 bg-white p-3 shadow-sm hover:shadow-md hover:border-amber-200 transition group"
          >
            <div className="relative w-20 h-20 shrink-0 rounded-xl overflow-hidden bg-amber-50 flex items-center justify-center">
              {ev.coverImage ? (
                <Image src={resolveImageUrl(ev.coverImage)} alt="" fill sizes="80px" className="object-cover" />
              ) : (
                <span className="text-3xl">{ev.emoji}</span>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                {ev.isFirstTimerFriendly && (
                  <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                    👋 First-timer friendly
                  </span>
                )}
                {ev.attendeeCount >= 3 && (
                  <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                    {ev.attendeeCount} going
                  </span>
                )}
              </div>
              <h3 className="font-bold text-gray-900 truncate mt-1 group-hover:text-amber-800">{ev.title}</h3>
              <p className="text-sm text-gray-500 truncate">
                {formatDate(ev.date)} · {formatTime(ev.time)} · {ev.neighborhood}
              </p>
              <span className="inline-block mt-1 text-sm font-semibold text-amber-700">RSVP →</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
