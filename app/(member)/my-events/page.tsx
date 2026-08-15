'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { formatPrice, formatShortDate, formatTime, resolveImageUrl, todayIstanbul } from '@/lib/data'
import { useAuth } from '@/contexts/AuthContext'
import dynamic from 'next/dynamic'
import EmptyState from '@/components/EmptyState'
import { SkeletonList } from '@/components/Skeleton'

const QRCode = dynamic(() => import('@/components/QRCode'), { ssr: false })

interface MyEvent {
  id: string
  title: string
  date: string
  time: string
  neighborhood: string
  emoji: string
  price: number
  currency?: string
  coverImage?: string | null
  status: 'pending' | 'approved' | 'waitlisted'
  eventStatus?: string
  waitlistPosition?: number
}

function EventCard({ e, showQr, onQr }: { e: MyEvent; showQr?: boolean; onQr?: () => void }) {
  return (
    <div className="flex gap-4 bg-white rounded-2xl shadow-card p-4 group relative">
      {e.coverImage ? (
        <div className="relative w-16 h-16 rounded-xl overflow-hidden shrink-0">
          <Image src={resolveImageUrl(e.coverImage)} alt={e.title} fill className="object-cover" sizes="64px" loading="lazy" />
        </div>
      ) : (
        <div className="w-16 h-16 rounded-xl bg-amber-50 flex items-center justify-center text-2xl shrink-0">
          {e.emoji}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-gray-900 group-hover:text-amber-600 transition-colors truncate">{e.title}</h3>
          {e.eventStatus === 'cancelled' && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 shrink-0">Cancelled</span>}
          {e.eventStatus === 'postponed' && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0">Postponed</span>}
          {e.status === 'pending'   && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 shrink-0">⏳ Pending</span>}
          {e.status === 'waitlisted' && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 shrink-0">#{e.waitlistPosition} waitlist</span>}
        </div>
        <p className="text-xs text-gray-600 mt-0.5">{formatShortDate(e.date)} · {formatTime(e.time)}</p>
        <p className="text-xs text-gray-400 mt-0.5">📍 {e.neighborhood}</p>
      </div>
      <div className="text-right shrink-0 flex flex-col items-end justify-between gap-2">
        <span className="text-sm font-bold text-gray-900">{e.price === 0 ? 'Free' : formatPrice(e.price, e.currency)}</span>
        {showQr && e.eventStatus !== 'cancelled' && onQr && (
          <button onClick={onQr}
            className="flex items-center gap-1 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-600 rounded-lg text-xs font-semibold transition-colors"
            title="Show QR check-in code"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
            QR
          </button>
        )}
        <Link href={`/events/${e.id}`} className="text-xs text-gray-400 hover:text-amber-600 transition-colors font-medium">View →</Link>
      </div>
    </div>
  )
}

type Tab = 'upcoming' | 'pending' | 'waitlist' | 'hosting' | 'saved' | 'past'

export default function MyEventsPage() {
  const { user }  = useAuth()
  const [events,  setEvents]  = useState<MyEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState<Tab>('upcoming')
  // §36 — hosting + saved come from /api/events/mine; attending/pending/
  // waitlist keep using the existing attending endpoint.
  const [hosting, setHosting] = useState<MyEvent[]>([])
  const [saved,   setSaved]   = useState<MyEvent[]>([])
  const [qrEvent, setQrEvent] = useState<MyEvent | null>(null)

  const today = todayIstanbul()

  useEffect(() => {
    Promise.all([
      fetch('/app/api/events/attending', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/app/api/events/mine',      { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([attending, mine]) => {
      if (Array.isArray(attending)) setEvents(attending)
      if (mine) { setHosting(mine.hosting ?? []); setSaved(mine.saved ?? []) }
    }).finally(() => setLoading(false))
  }, [])

  const upcoming  = events.filter(e => e.status === 'approved'  && e.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  const pending   = events.filter(e => e.status === 'pending').sort((a, b) => a.date.localeCompare(b.date))
  const waitlist  = events.filter(e => e.status === 'waitlisted').sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0))
  const past      = events.filter(e => e.status === 'approved'  && e.date < today).sort((a, b) => b.date.localeCompare(a.date))
  const displayed =
    tab === 'upcoming' ? upcoming
    : tab === 'pending'  ? pending
    : tab === 'waitlist' ? waitlist
    : tab === 'hosting'  ? hosting
    : tab === 'saved'    ? saved
    : past

  return (
    <div className="min-h-screen bg-warm pb-20 md:pb-0">
      {/* QR code modal */}
      {qrEvent && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setQrEvent(null)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-xs text-center shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Your check-in QR</p>
            <p className="font-bold text-gray-900 mb-5 leading-snug">{qrEvent.title}</p>
            <div className="flex justify-center mb-5">
              <QRCode value={`smileys-checkin:${qrEvent.id}:${user.id}`} size={200} />
            </div>
            <p className="text-xs text-gray-400 mb-4">Show this to the host at the event entrance.</p>
            <button onClick={() => setQrEvent(null)} className="w-full py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 transition-colors">
              Close
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-0">
          <div className="max-w-3xl">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">My Events</h1>
          <p className="text-base text-gray-600 mt-1 mb-4">{upcoming.length} upcoming · {events.length} total</p>
          {/* Tabs */}
          <div className="flex gap-1">
            {([
              { key: 'upcoming', label: 'Upcoming', count: upcoming.length },
              { key: 'pending',  label: 'Pending',  count: pending.length  },
              { key: 'waitlist', label: 'Waitlist', count: waitlist.length },
              { key: 'hosting',  label: 'Hosting',  count: hosting.length  },
              { key: 'saved',    label: 'Saved',    count: saved.length    },
              { key: 'past',     label: 'Past',     count: past.length     },
            ] as { key: Tab; label: string; count: number }[]).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
                  tab === t.key ? 'border-amber-500 text-amber-600' : 'border-transparent text-gray-600 hover:text-gray-800'
                }`}>
                {t.label}
                {t.count > 0 && (
                  <span className={`ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full ${
                    tab === t.key ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                  }`}>{t.count}</span>
                )}
              </button>
            ))}
          </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="max-w-3xl">
        {loading ? (
          <SkeletonList rows={3} />
        ) : displayed.length === 0 ? (
          <EmptyState
            icon={tab === 'upcoming' ? '📅' : tab === 'pending' ? '⏳' : tab === 'waitlist' ? '⏳'
              : tab === 'hosting' ? '🎤' : tab === 'saved' ? '♡' : '🎊'}
            title={tab === 'upcoming' ? 'No upcoming events'
              : tab === 'pending' ? 'No pending requests'
              : tab === 'waitlist' ? 'Not on any waitlists'
              : tab === 'hosting' ? "You're not hosting anything yet"
              : tab === 'saved' ? 'Nothing saved yet'
              : 'No past events yet'}
            body={tab === 'upcoming' ? 'Find something fun and lock in your spot.'
              : tab === 'pending' ? 'Any events awaiting approval will show up here.'
              : tab === 'waitlist' ? 'Full events you join the waitlist for will appear here.'
              : tab === 'hosting' ? 'Events you host or co-host will appear here.'
              : tab === 'saved' ? 'Tap ♡ on any event to keep it here for later.'
              : "Once you attend events, they'll appear here."}
            action={tab !== 'pending' ? { label: 'Browse events', href: '/events' } : undefined}
          />
        ) : (
          <div className={`space-y-3 ${tab === 'past' ? 'opacity-80' : ''}`}>
            {displayed.map(e => (
              <EventCard key={e.id} e={e}
                showQr={tab === 'upcoming'}
                onQr={() => setQrEvent(e)} />
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
