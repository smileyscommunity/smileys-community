'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'

interface VisitorUser {
  id: string
  name: string
  color: string
  profilePhoto: string | null
}

interface Announcement {
  id:           string
  name:         string
  startsOn:     string
  endsOn:       string
  fromCity:     string | null
  neighborhood: string | null
  intro:        string
  contact:      string | null
  email:        string | null
  interests:    string[]
  user:         VisitorUser | null
}

interface EventSummary {
  id:    string
  title: string
  emoji: string
  date:  string
}

interface FeaturedLocal {
  id:           string
  name:         string
  color:        string
  profilePhoto: string | null
  neighborhood: string | null
}

interface Props {
  announcements:  Announcement[]
  events:         EventSummary[]
  cityCount:      number
  featuredLocals: FeaturedLocal[]
}

type FilterKey = 'all' | 'week' | 'month' | 'later'

function formatRange(startsOn: string, endsOn: string) {
  const s = new Date(startsOn + 'T00:00:00')
  const e = new Date(endsOn + 'T00:00:00')
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
  const fmt = (d: Date, withMonth: boolean) => d.toLocaleDateString('en-GB', withMonth
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric' })
  return sameMonth ? `${fmt(s, false)}–${fmt(e, true)}` : `${fmt(s, true)} – ${fmt(e, true)}`
}

// Bucket an announcement by when it starts. "Week" = next 7 days
// inclusive of today, "Month" = 8–30 days out, "Later" = beyond 30
// days. An announcement that started yesterday and ends tomorrow is
// still "in town now", so we treat startsOn <= today as "week".
//
// Day arithmetic is done in UTC midnight so DST transitions don't
// shift a date across a bucket boundary (the local-midnight version
// got a ±1 day error on the day clocks change).
function bucketOf(a: Announcement, todayUTC: number): Exclude<FilterKey, 'all'> {
  const [y, m, d] = a.startsOn.split('-').map(Number)
  const startsUTC = Date.UTC(y, m - 1, d)
  const daysFromNow = Math.floor((startsUTC - todayUTC) / 86_400_000)
  if (daysFromNow <= 7)  return 'week'
  if (daysFromNow <= 30) return 'month'
  return 'later'
}

const SECTION_LABELS: Record<Exclude<FilterKey, 'all'>, string> = {
  week:  'This week',
  // "Next 30 days" was misleading here because the section actually
  // contains only the 8–30 day bucket (this-week visitors render in
  // the section above). "Coming up" reads as "later but not far off".
  month: 'Coming up',
  later: 'Later',
}

function WaveButton({ targetUserId, targetName }: { targetUserId: string; targetName: string }) {
  const [sending, setSending] = useState(false)
  const [sent,    setSent]    = useState(false)

  async function handleWave() {
    if (sending || sent) return
    setSending(true)
    try {
      const res = await fetch('/app/api/visiting/wave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'Couldn\'t send wave')
        return
      }
      setSent(true)
      if (!data.alreadySent) {
        toast.success(`👋 Wave sent to ${targetName.split(' ')[0]}!`)
      }
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-xs font-bold text-green-700 bg-green-100 px-2.5 py-1.5 rounded-full whitespace-nowrap">✓ Waved</span>
        <Link href={`/messages/${targetUserId}`}
          className="text-xs font-bold text-amber-700 underline whitespace-nowrap hover:text-amber-900">
          Open chat →
        </Link>
      </div>
    )
  }

  return (
    <button onClick={handleWave} disabled={sending}
      className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full transition-colors bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-60 disabled:cursor-default whitespace-nowrap">
      {sending ? 'Waving…' : '👋 Wave hello'}
    </button>
  )
}

function ConnectButton({ targetUserId, targetName }: { targetUserId: string; targetName: string }) {
  const [sending, setSending] = useState(false)
  const [sent,    setSent]    = useState(false)

  async function handleConnect() {
    if (sending || sent) return
    setSending(true)
    try {
      const res = await fetch('/app/api/connections', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverId: targetUserId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Could not connect'); return }
      setSent(true)
      toast.success(`Request sent to ${targetName.split(' ')[0]}!`)
    } finally {
      setSending(false)
    }
  }

  if (sent) return <span className="text-xs font-bold text-green-700 bg-green-100 px-2.5 py-1.5 rounded-full whitespace-nowrap">✓ Sent</span>
  return (
    <button onClick={handleConnect} disabled={sending}
      className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full transition-colors bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-60 whitespace-nowrap">
      {sending ? '…' : '👋 Connect'}
    </button>
  )
}

function LocalsStrip({ locals, viewerId }: { locals: FeaturedLocal[]; viewerId: string | null }) {
  if (locals.length === 0) return null
  const visible = viewerId ? locals.filter(l => l.id !== viewerId) : locals
  if (visible.length === 0) return null
  return (
    <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 mb-6">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-700 mb-4">Meet some locals</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {visible.slice(0, 4).map(l => (
          <div key={l.id} className="flex flex-col items-center gap-2 text-center">
            <Link href={`/members/${l.id}`}>
              {l.profilePhoto
                ? <Image src={l.profilePhoto} alt={l.name} width={48} height={48}
                    className="w-12 h-12 rounded-full object-cover hover:ring-2 hover:ring-amber-400 transition-all" />
                : <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-bold hover:ring-2 hover:ring-amber-400 transition-all"
                       style={{ backgroundColor: l.color }}>
                    {l.name[0]?.toUpperCase()}
                  </div>
              }
            </Link>
            <div>
              <Link href={`/members/${l.id}`} className="text-xs font-semibold text-gray-800 hover:text-amber-600 transition-colors">
                {l.name.split(' ')[0]}
              </Link>
              {l.neighborhood && <p className="text-[10px] text-gray-400">{l.neighborhood}</p>}
            </div>
            {viewerId && <ConnectButton targetUserId={l.id} targetName={l.name} />}
          </div>
        ))}
      </div>
    </div>
  )
}

const CHECKLIST_KEY = 'visiting-checklist-dismissed'

function FirstTimeChecklist({ hasPosted, viewerId }: { hasPosted: boolean; viewerId: string | null }) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(CHECKLIST_KEY) === '1'
  })

  if (!viewerId || dismissed) return null

  const steps = [
    { label: 'Post your visit',    href: '/visiting/new', done: hasPosted },
    { label: 'Wave to a local',    href: '#locals',       done: false },
    { label: 'Join a club',        href: '/clubs',        done: false },
    { label: 'RSVP to an event',   href: '/events',       done: false },
  ]
  const doneCount = steps.filter(s => s.done).length

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">First time here?</p>
        <button onClick={() => { localStorage.setItem(CHECKLIST_KEY, '1'); setDismissed(true) }}
          className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors">
          Dismiss
        </button>
      </div>
      <div className="space-y-2">
        {steps.map(s => (
          <Link key={s.label} href={s.href}
            className="flex items-center gap-3 group">
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
              s.done ? 'bg-green-500 border-green-500' : 'border-gray-300 group-hover:border-amber-400'
            }`}>
              {s.done && (
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <span className={`text-sm transition-colors ${s.done ? 'line-through text-gray-400' : 'text-gray-700 group-hover:text-amber-600'}`}>
              {s.label}
            </span>
          </Link>
        ))}
      </div>
      {doneCount > 0 && (
        <p className="text-xs text-gray-400 mt-3">{doneCount}/{steps.length} done</p>
      )}
    </div>
  )
}

function AnnouncementCard({ a, viewerId, viewerInterests, events, allAnnouncements }: {
  a:                Announcement
  viewerId:         string | null
  viewerInterests:  string[]
  events:           EventSummary[]
  allAnnouncements: Announcement[]
}) {
  const isSelf          = !!(viewerId && a.user && viewerId === a.user.id)
  const sharedInterests = viewerInterests.filter(i => a.interests.includes(i)).slice(0, 3)
  const eventsInWindow  = events.filter(e => e.date >= a.startsOn && e.date <= a.endsOn)
  const overlapping     = allAnnouncements.filter(o =>
    o.id !== a.id && o.startsOn <= a.endsOn && o.endsOn >= a.startsOn
  ).slice(0, 3)
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3 mb-3">
        {a.user?.profilePhoto ? (
          <Image src={a.user.profilePhoto} alt={a.name} width={40} height={40}
            className="w-10 h-10 rounded-full object-cover shrink-0" />
        ) : (
          /* aria-hidden because the visitor name is announced as the
             next element, so the SR hearing "K" or "M" for the
             fallback initial would just be redundant noise. */
          <div aria-hidden="true"
            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
            style={{ backgroundColor: a.user?.color || '#f59e0b' }}>
            {a.name[0]?.toUpperCase() ?? '?'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {a.user ? (
              <Link href={`/members/${a.user.id}`} className="text-sm font-bold text-gray-900 hover:text-amber-600 transition-colors">{a.name}</Link>
            ) : (
              <p className="text-sm font-bold text-gray-900">{a.name}</p>
            )}
            {a.fromCity && <span className="text-xs text-gray-600">from {a.fromCity}</span>}
            {a.user && (
              <Link href={`/members/${a.user.id}`} className="text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full hover:bg-amber-200 transition-colors">Member →</Link>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-600">
            <span className="font-semibold text-amber-700">{formatRange(a.startsOn, a.endsOn)}</span>
            {a.neighborhood && <span><span aria-hidden="true">· 📍 </span>{a.neighborhood}</span>}
          </div>
        </div>
        {/* Wave sends a connection request with a templated welcome
            note; existing accepted connection → jumps straight to DM.
            Gated on viewerId — this page is now public, and an anonymous
            click would just 401 against the wave API with no explanation. */}
        {viewerId && a.user && !isSelf && (
          <WaveButton targetUserId={a.user.id} targetName={a.user.name} />
        )}
      </div>
      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap mb-3">{a.intro}</p>

      {/* Shared interests + events during stay */}
      {(sharedInterests.length > 0 || eventsInWindow.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {sharedInterests.map(i => (
            <span key={i} className="text-xs bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-full font-medium">
              🎯 {i}
            </span>
          ))}
          {eventsInWindow.length > 0 && (
            <Link href="/events"
              className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full font-medium hover:bg-blue-100 transition-colors">
              📅 {eventsInWindow.length} event{eventsInWindow.length !== 1 ? 's' : ''} while you&apos;re here
            </Link>
          )}
        </div>
      )}

      {overlapping.length > 0 && (
        <p className="text-xs text-gray-500 mb-3">
          Also visiting:{' '}
          {overlapping.map((o, i) => (
            <span key={o.id}>
              {i > 0 && ', '}
              {o.user
                ? <Link href={`/members/${o.user.id}`} className="font-semibold text-gray-700 hover:text-amber-600 transition-colors">{o.name.split(' ')[0]}</Link>
                : <span className="font-semibold text-gray-700">{o.name.split(' ')[0]}</span>
              }
            </span>
          ))}
          {' '}at the same time
        </p>
      )}

      {(a.contact || a.email) && (
        <div className="pt-3 border-t border-gray-100 text-xs text-gray-600 space-y-0.5">
          {a.contact && <p><span aria-hidden="true">📞 </span><span className="font-mono text-gray-700">{a.contact}</span></p>}
          {a.email   && <p><span aria-hidden="true">✉️ </span><span className="font-mono text-gray-700">{a.email}</span></p>}
        </div>
      )}
    </div>
  )
}

export default function VisitingClient({ announcements, events, cityCount, featuredLocals }: Props) {
  const { user, isLoggedIn } = useAuth()
  const viewerId        = isLoggedIn ? user.id        : null
  const viewerInterests = isLoggedIn ? (user.interests ?? []) as string[] : []
  const hasPosted       = isLoggedIn && announcements.some(a => a.user?.id === user.id)

  const [filter, setFilter] = useState<FilterKey>('all')

  // Today at UTC midnight — anchor for DST-safe day arithmetic in
  // bucketOf (the local-midnight version had a ±1 day drift on
  // clock-change days).
  const todayUTC = useMemo(() => {
    const d = new Date()
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  }, [])

  const buckets = useMemo(() => {
    const out = { week: 0, month: 0, later: 0 }
    for (const a of announcements) out[bucketOf(a, todayUTC)]++
    return out
  }, [announcements, todayUTC])

  // "Coming up" / month filter is inclusive of this-week visitors so
  // the count on the "Next 30 days" chip ( buckets.week + buckets.month )
  // matches what users see when they tap it. Before, the chip promised
  // N but the filter only showed the 8-30 day subset.
  const filtered = useMemo(() => {
    if (filter === 'all')   return announcements
    if (filter === 'month') return announcements.filter(a => {
      const b = bucketOf(a, todayUTC)
      return b === 'week' || b === 'month'
    })
    return announcements.filter(a => bucketOf(a, todayUTC) === filter)
  }, [announcements, filter, todayUTC])

  const CHIPS: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all',   label: 'All',          count: announcements.length },
    { key: 'week',  label: 'This week',    count: buckets.week },
    { key: 'month', label: 'Next 30 days', count: buckets.week + buckets.month },
    { key: 'later', label: 'Later',        count: buckets.later },
  ]

  const upcomingCount = buckets.week + buckets.month

  return (
    <>
      {/* Stats banner */}
      {upcomingCount > 0 && (
        <p className="text-sm text-gray-600 mb-3">
          <span className="font-semibold text-gray-800">{upcomingCount}</span> visitor{upcomingCount !== 1 ? 's' : ''} in the next 30 days
          {cityCount > 1 && <> · from <span className="font-semibold text-gray-800">{cityCount}</span> cities</>}
        </p>
      )}

      {/* Filter chips */}
      {announcements.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-4 scrollbar-hide">
          {CHIPS.map(c => (
            <button key={c.key} onClick={() => setFilter(c.key)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors border whitespace-nowrap ${
                filter === c.key
                  ? 'bg-amber-500 border-amber-500 text-white'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-amber-200 hover:text-amber-700'
              }`}>
              {c.label} <span className={`ml-1 text-[10px] tabular-nums ${filter === c.key ? 'opacity-80' : 'text-gray-400'}`}>{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Visitor list */}
      {filtered.length === 0 ? (
        announcements.length === 0 ? (
          <div className="text-center py-16">
            <div aria-hidden="true" className="text-5xl mb-4">✈️</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">No upcoming visitors yet</h2>
            <p className="text-gray-600 text-sm max-w-md mx-auto">
              Be the first to post. Tell members when you&apos;re in town and they&apos;ll reach out.
            </p>
          </div>
        ) : (
          <div className="text-center py-14 text-sm text-gray-600 border border-dashed border-gray-200 rounded-2xl">
            No visitors in this window — try a different filter.
          </div>
        )
      ) : filter === 'all' ? (
        <div className="space-y-8">
          {(['week', 'month', 'later'] as const).map(bucket => {
            const items = filtered.filter(a => bucketOf(a, todayUTC) === bucket)
            if (items.length === 0) return null
            return (
              <div key={bucket}>
                <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-3">
                  {SECTION_LABELS[bucket]} <span className="font-normal">({items.length})</span>
                </h3>
                <div className="space-y-4">
                  {items.map(a => (
                    <AnnouncementCard key={a.id} a={a} viewerId={viewerId} viewerInterests={viewerInterests} events={events} allAnnouncements={announcements} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(a => (
            <AnnouncementCard key={a.id} a={a} viewerId={viewerId} viewerInterests={viewerInterests} events={events} allAnnouncements={announcements} />
          ))}
        </div>
      )}

      {/* Meet some locals — below the list so it doesn't block content */}
      <div id="locals" className="mt-8">
        <LocalsStrip locals={featuredLocals} viewerId={viewerId} />
      </div>

      {/* First time checklist — supplementary, below the fold */}
      <FirstTimeChecklist hasPosted={hasPosted} viewerId={viewerId} />
    </>
  )
}
