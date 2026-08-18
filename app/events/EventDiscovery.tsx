'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import posthog from 'posthog-js'
import { resolveImageUrl } from '@/lib/data'
import { isSoldOut } from '@/lib/soldOut'

interface DiscoveryEvent {
  id: string; title: string; emoji: string; date: string; time: string
  location: string; neighborhood: string | null; coverImage: string | null
  price: number; memberPrice: number | null; currency: string | null
  spotsLeft: number; totalSpots: number; limitedSpots: boolean; soldOut?: boolean
  club: { id: string; name: string; emoji: string; slug: string } | null
  series?: { count: number; cadence: string | null; moreDates: string[] } | null
}

interface Discovery {
  going: DiscoveryEvent[]
  comingUp: DiscoveryEvent[]
  soon: DiscoveryEvent[]
  weekend: DiscoveryEvent[]
  fromClubs: DiscoveryEvent[]
  nearYou: DiscoveryEvent[]
  trySomethingNew: DiscoveryEvent[]
  viewer: { isMember: boolean; neighborhood: string | null; hasClubs?: boolean }
}

function fmtDay(date: string, time: string) {
  const d = new Date(`${date}T12:00:00+03:00`)
  const todayIst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date())
  const tomorrowIst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' })
    .format(new Date(Date.now() + 86_400_000))
  const label =
    date === todayIst ? 'Today'
    : date === tomorrowIst ? 'Tomorrow'
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Istanbul' })
  return `${label} · ${time.slice(0, 5)}`
}

// §10 — at most one meaningful badge per card.
function badgeFor(e: DiscoveryEvent): { text: string; cls: string } | null {
  if (isSoldOut(e)) return { text: 'Waitlist', cls: 'bg-gray-900 text-white' }
  if (e.limitedSpots && e.spotsLeft <= 3) return { text: `${e.spotsLeft} spot${e.spotsLeft !== 1 ? 's' : ''} left`, cls: 'bg-red-500 text-white' }
  if (e.price === 0) return { text: 'Free', cls: 'bg-green-100 text-green-700' }
  return null
}

function EventTile({ e, from }: { e: DiscoveryEvent; from: string }) {
  const cover = e.coverImage ? resolveImageUrl(e.coverImage) : null
  const badge = badgeFor(e)
  return (
    <Link href={`/events/${e.id}`}
      onClick={() => posthog.capture('event_viewed', { from, eventId: e.id })}
      // w-full, not w-64: these rows were horizontal scrollers once, where a
      // fixed 16rem card and shrink-0 were the point. They are grids now
      // (grid-cols-1 on a phone), so the fixed width left every card at 256px
      // inside a full-width cell — visibly narrower than the feed below it,
      // for no reason anyone could see.
      className="w-full bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md hover:border-amber-200 hover:-translate-y-0.5 transition-all overflow-hidden group">
      <div className="relative h-32 bg-gradient-to-br from-amber-100 to-orange-50">
        {cover
          ? <Image src={cover} alt="" fill sizes="(max-width: 640px) 100vw, 25vw" className="object-cover group-hover:scale-105 transition-transform duration-300" />
          : <div className="absolute inset-0 flex items-center justify-center text-4xl">{e.emoji}</div>}
        {badge && (
          <span className={`absolute top-2 left-2 text-[11px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>
            {badge.text}
          </span>
        )}
      </div>
      <div className="p-4">
        <p className="text-xs font-bold text-amber-600">{fmtDay(e.date, e.time)}</p>
        <p className="font-bold text-gray-900 text-sm leading-snug mt-1 line-clamp-2 group-hover:text-amber-700 transition-colors">
          {e.title}
        </p>
        <p className="text-xs text-gray-500 mt-1.5 truncate">
          <span aria-hidden="true">📍</span> {e.neighborhood || e.location}
        </p>
        {/* §38 — series collapse: one card, the rest of the dates named. */}
        {e.series?.cadence && (
          <p className="text-[11px] font-semibold text-gray-400 mt-1.5">🔁 {e.series.cadence}</p>
        )}
      </div>
    </Link>
  )
}

function Row({ title, subtitle, events, cta, from }: {
  title: string; subtitle?: string; events: DiscoveryEvent[]
  cta?: { href: string; label: string }; from: string
}) {
  if (events.length === 0) return null
  return (
    <div className="mb-8">
      {/* min-w-0 so a long CTA can't squeeze the heading: the link is shrink-0
          by design (a wrapped "My events →" reads as two links), which means
          the title is the side that has to give. Without this a neighborhood
          like "Near Küçükçekmece" got crushed on a narrow screen. */}
      <div className="flex items-end justify-between gap-4 mb-3">
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-gray-900 truncate">{title}</h2>
          {subtitle && <p className="text-sm text-gray-600 mt-0.5">{subtitle}</p>}
        </div>
        {/* Desktop only. On a phone these sat in the heading row taking width
            from the title beside them, and the row's cards are the thing you
            came for — /neighborhoods, /clubs and /my-events are all a tap away
            in the nav anyway. Kept on wider screens, where the space is free. */}
        {cta && <Link href={cta.href} className="hidden sm:inline text-xs font-bold text-amber-600 hover:text-amber-700 shrink-0">{cta.label}</Link>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pb-2">
        {events.map(e => <EventTile key={e.id} e={e} from={from} />)}
      </div>
    </div>
  )
}

// Events discovery (§6-7, §14-18, §55) — the personalized rows above the
// full feed. Client island so the existing events page keeps its
// architecture; one fetch serves every row.
export default function EventDiscovery() {
  const [d, setD] = useState<Discovery | null>(null)

  useEffect(() => {
    fetch('/app/api/events/discovery', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(setD)
      .catch(() => {})
  }, [])

  if (!d) return null

  const going = d.going[0]

  return (
    <div>
      {/* §6 — the member's own next event leads everything. */}
      {going && (
        <div className="mb-8 bg-amber-50 border border-amber-200 rounded-2xl p-5">
          <p className="text-xs font-extrabold text-amber-800 uppercase tracking-widest mb-2">You&apos;re going 🎉</p>
          <Link href={`/events/${going.id}`}
            onClick={() => posthog.capture('event_viewed', { from: 'youre_going', eventId: going.id })}
            className="flex items-center gap-4 group">
            <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-white shrink-0">
              {going.coverImage
                ? <Image src={resolveImageUrl(going.coverImage)} alt="" fill sizes="80px" className="object-cover" />
                : <div className="absolute inset-0 flex items-center justify-center text-3xl">{going.emoji}</div>}
            </div>
            <div className="min-w-0">
              <p className="font-extrabold text-gray-900 leading-snug group-hover:text-amber-700 transition-colors">{going.title}</p>
              <p className="text-sm text-gray-700 mt-0.5">{fmtDay(going.date, going.time)}</p>
              <p className="text-xs text-gray-500 mt-0.5 truncate">📍 {going.location}{going.neighborhood ? ` · ${going.neighborhood}` : ''}</p>
            </div>
          </Link>
        </div>
      )}

      <Row title="Coming up for you" events={d.comingUp}
        cta={{ href: '/my-events', label: 'My events →' }} from="coming_up" />

      <Row title="This weekend" subtitle="Plans worth blocking out."
        events={d.weekend} from="weekend" />

      {/* §56 — logged-out visitors get a series-collapsed "happening
          soon" row. Members don't: the full chronological feed sits
          directly below, and repeating it here is the duplication the
          rest of this redesign exists to remove. */}
      {!d.viewer.isMember && (
        <Row title="Happening soon" subtitle="The next few things on the calendar."
          events={d.soon.slice(0, 8)} from="soon_guest" />
      )}

      <Row title="From your clubs" events={d.fromClubs}
        cta={{ href: '/clubs', label: 'Your clubs →' }} from="from_clubs" />

      {d.viewer.isMember && (d.viewer.neighborhood
        ? <Row title={`Near ${d.viewer.neighborhood}`} events={d.nearYou}
            cta={{ href: '/neighborhoods', label: 'Explore neighborhoods →' }} from="near_you" />
        : (
          <div className="mb-8 bg-gray-50 border border-gray-200 rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-gray-700">Choose your neighborhood to see what&apos;s happening nearby.</p>
            <Link href="/profile" className="shrink-0 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
              Choose neighborhood
            </Link>
          </div>
        ))}

      {/* §17 — outside the viewer's usual clubs, so personalization
          doesn't turn into a filter bubble. */}
      <Row title="Try something new" subtitle="Outside your usual circles."
        events={d.trySomethingNew} from="try_new" />
    </div>
  )
}
