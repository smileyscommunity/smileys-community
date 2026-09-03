'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { VISITOR_TRAVELER_TYPES, VISITOR_LOOKING_FOR, avatarUrl } from '@/lib/data'
import { sharedSignals } from '@/lib/visitorMatch'

const TRAVELER_LABEL: Record<string, string> = Object.fromEntries(VISITOR_TRAVELER_TYPES.map(t => [t.value, t.label]))
const LOOKING_FOR_META: Record<string, { label: string; emoji: string }> = Object.fromEntries(
  VISITOR_LOOKING_FOR.map(t => [t.value, { label: t.label, emoji: t.emoji }]),
)

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
  travelerType: string | null
  languages:    string[]
  lookingFor:   string[]
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
  // What this member said they're open to, in settings. Shown to signed-in
  // viewers only: the flags live on the members-only directory today, and
  // /visiting is a public page — ordering by them leaks nothing, printing
  // them to the open web would be a new disclosure the member never agreed to.
  openToHosting?:  boolean
  openToCoffee?:   boolean
  openToLanguage?: boolean
}

interface Props {
  announcements:  Announcement[]
  events:         EventSummary[]
  cityCount:      number
  featuredLocals: FeaturedLocal[]
  /** The city being viewed — this heading said Istanbul to every city. */
  cityName:       string
}

type FilterKey = 'all' | 'now' | 'week' | 'month' | 'later'

function formatRange(startsOn: string, endsOn: string) {
  const s = new Date(startsOn + 'T00:00:00')
  const e = new Date(endsOn + 'T00:00:00')
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
  const fmt = (d: Date, withMonth: boolean) => d.toLocaleDateString('en-GB', withMonth
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric' })
  return sameMonth ? `${fmt(s, false)}–${fmt(e, true)}` : `${fmt(s, true)} – ${fmt(e, true)}`
}

// Bucket an announcement by when it starts. "Now" = mid-trip today,
// "Week" = arriving in the next 7 days, "Month" = 8–30 days out,
// "Later" = beyond 30 days. Someone already in town used to be folded
// into "week", which made the chips contradict the card's "Here now"
// badge (and the header's "arriving" count).
//
// Day arithmetic is done in UTC midnight so DST transitions don't
// shift a date across a bucket boundary (the local-midnight version
// got a ±1 day error on the day clocks change).
function bucketOf(a: Announcement, todayUTC: number): Exclude<FilterKey, 'all'> {
  const [sy, sm, sd] = a.startsOn.split('-').map(Number)
  const [ey, em, ed] = a.endsOn.split('-').map(Number)
  const startsUTC = Date.UTC(sy, sm - 1, sd)
  const endsUTC   = Date.UTC(ey, em - 1, ed)
  if (startsUTC <= todayUTC && endsUTC >= todayUTC) return 'now'
  const daysFromNow = Math.floor((startsUTC - todayUTC) / 86_400_000)
  if (daysFromNow <= 7)  return 'week'
  if (daysFromNow <= 30) return 'month'
  return 'later'
}

// Arrival status shown as a badge on each card. "Here now" wins over any
// countdown — someone mid-trip is the most actionable person on the page,
// which is also why they sort first. Day maths uses the same UTC-midnight
// anchor as bucketOf so both agree on a boundary day.
type ArrivalStatus = { label: string; tone: 'now' | 'soon' | 'later' }

function arrivalStatus(a: Announcement, todayUTC: number): ArrivalStatus {
  const [sy, sm, sd] = a.startsOn.split('-').map(Number)
  const [ey, em, ed] = a.endsOn.split('-').map(Number)
  const startUTC = Date.UTC(sy, sm - 1, sd)
  const endUTC   = Date.UTC(ey, em - 1, ed)

  if (startUTC <= todayUTC && endUTC >= todayUTC) return { label: 'Here now', tone: 'now' }

  const days = Math.round((startUTC - todayUTC) / 86_400_000)
  if (days < 0)  return { label: 'Visit ended',      tone: 'later' }
  if (days === 0) return { label: 'Arriving today',   tone: 'now'  }
  if (days === 1) return { label: 'Arriving tomorrow', tone: 'soon' }
  if (days <= 7)  return { label: `Arriving in ${days} days`, tone: 'soon' }
  if (days <= 14) return { label: 'Coming next week', tone: 'soon' }
  return {
    label: `Visiting in ${new Date(startUTC).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })}`,
    tone:  'later',
  }
}

const STATUS_TONE: Record<ArrivalStatus['tone'], string> = {
  now:   'bg-green-100 text-green-800',
  soon:  'bg-amber-100 text-amber-800',
  later: 'bg-gray-100 text-gray-600',
}

// The only way a member can reach a visitor from this page, and it goes out
// as a CONNECTION REQUEST carrying the details as its note — not a DM. The
// visitor accepts or declines before a thread exists.
//
// There used to be two channels that skipped that consent step: a one-tap
// "wave" that sent a fixed template, and a one-way "tip" notification. The
// wave's only measurable output was one visitor receiving the same canned
// sentence from 18 different members over five weeks, ending in a
// harassment report; the tip was never used once. Both are gone. A visitor
// who wants more contact browses the locals strip below and reaches out
// themselves — initiation belongs to the person whose inbox it is.
function CoffeeInviteModal({ target, onClose }: { target: VisitorUser; onClose: () => void }) {
  const [when,         setWhen]         = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [message,      setMessage]      = useState('')
  const [sending,      setSending]      = useState(false)

  const firstName = target.name.split(' ')[0]

  async function send() {
    if (sending) return
    setSending(true)
    try {
      const parts = [
        `☕ Coffee invite${when ? ` — ${when}` : ''}${neighborhood ? ` in ${neighborhood}` : ''}`,
        message.trim(),
      ].filter(Boolean)
      const res = await fetch('/app/api/connections', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ receiverId: target.id, note: parts.join('\n').slice(0, 280) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Could not send invite'); return }
      toast.success(`Invite sent to ${firstName}!`)
      onClose()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 shadow-xl"
        onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 mb-1">Invite {firstName} for coffee</h3>
        <p className="text-xs text-gray-500 mb-4">
          Sends a connection request with your invite. {firstName} sees it once they accept.
        </p>

        <label className="block text-xs font-bold text-gray-700 mb-1">Suggested day</label>
        <input value={when} onChange={e => setWhen(e.target.value)}
          placeholder="e.g. Thursday afternoon"
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-amber-400" />

        <label className="block text-xs font-bold text-gray-700 mb-1">Neighborhood</label>
        <input value={neighborhood} onChange={e => setNeighborhood(e.target.value)}
          placeholder="e.g. a neighborhood you like"
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-amber-400" />

        <label className="block text-xs font-bold text-gray-700 mb-1">Message <span className="font-normal text-gray-400">(optional)</span></label>
        <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} maxLength={280}
          placeholder="Happy to show you around the neighborhood…"
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm mb-4 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400" />

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-bold rounded-xl transition-colors">
            Cancel
          </button>
          <button onClick={send} disabled={sending}
            className="flex-1 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-sm font-bold rounded-xl transition-colors">
            {sending ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </div>
    </div>
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
  // Only claim they welcome visitors when they said so. Otherwise this is the
  // same neutral "here are some members" strip it has always been.
  const anyHost = visible.slice(0, 4).some(l => l.openToHosting)
  return (
    <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 mb-6">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-700 mb-4">
        {viewerId && anyHost ? 'Locals happy to meet visitors' : 'Meet some locals'}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {visible.slice(0, 4).map(l => (
          <div key={l.id} className="flex flex-col items-center gap-2 text-center">
            <Link href={`/members/${l.id}`}>
              {l.profilePhoto
                ? <img src={avatarUrl(l.profilePhoto, 96)} alt={l.name} width={48} height={48} loading="lazy" decoding="async"
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
              {viewerId && (l.openToHosting || l.openToCoffee || l.openToLanguage) && (
                <div className="flex flex-wrap justify-center gap-1 mt-1">
                  {l.openToHosting  && <span title="Open to hosting visitors" aria-label="Open to hosting visitors" className="text-[10px] px-1.5 py-0.5 bg-green-50 text-green-700 border border-green-100 rounded-full">🏠</span>}
                  {l.openToCoffee   && <span title="Open to coffee with newcomers" aria-label="Open to coffee with newcomers" className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-100 rounded-full">☕</span>}
                  {l.openToLanguage && <span title="Open to language exchange" aria-label="Open to language exchange" className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-100 rounded-full">🗣️</span>}
                </div>
              )}
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

function AnnouncementCard({ a, viewerId, viewerInterests, viewerLanguages, viewerNeighborhood, events, allAnnouncements, todayUTC }: {
  a:                Announcement
  viewerId:         string | null
  viewerInterests:  string[]
  viewerLanguages:  string[]
  viewerNeighborhood: string | null
  events:           EventSummary[]
  allAnnouncements: Announcement[]
  todayUTC:         number
}) {
  const [coffeeOpen, setCoffeeOpen] = useState(false)
  const status          = arrivalStatus(a, todayUTC)
  const isSelf          = !!(viewerId && a.user && viewerId === a.user.id)
  // Why a local might say hi — see lib/visitorMatch.
  const { interests: sharedInterests, languages: sharedLanguages, sameNeighborhood } = sharedSignals(
    { interests: viewerInterests, languages: viewerLanguages, neighborhood: viewerNeighborhood },
    { interests: a.interests,     languages: a.languages,     neighborhood: a.neighborhood ?? null },
  )
  const eventsInWindow  = events.filter(e => e.date >= a.startsOn && e.date <= a.endsOn)
  // Overlapping visitors ranked by shared "looking for" tags first (e.g. two
  // people who both want a coworking buddy during the same week are a much
  // better match than two people who merely happen to overlap in dates).
  const overlapping = allAnnouncements
    .filter(o => o.id !== a.id && o.startsOn <= a.endsOn && o.endsOn >= a.startsOn)
    .map(o => ({ o, shared: o.lookingFor.filter(v => a.lookingFor.includes(v)) }))
    .sort((x, y) => y.shared.length - x.shared.length)
    .slice(0, 3)
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
      <div className="flex items-start gap-3 mb-3">
        {a.user?.profilePhoto ? (
          <img src={avatarUrl(a.user.profilePhoto, 128)} alt={a.name} width={56} height={56} loading="lazy" decoding="async"
            className="w-14 h-14 rounded-full object-cover shrink-0" />
        ) : (
          /* aria-hidden because the visitor name is announced as the
             next element, so the SR hearing "K" or "M" for the
             fallback initial would just be redundant noise. */
          <div aria-hidden="true"
            className="w-14 h-14 rounded-full flex items-center justify-center text-white text-lg font-bold shrink-0"
            style={{ backgroundColor: a.user?.color || '#f59e0b' }}>
            {a.name[0]?.toUpperCase() ?? '?'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <span className={`inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full mb-1.5 ${STATUS_TONE[status.tone]}`}>
            {status.label}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {a.user ? (
              <Link href={`/members/${a.user.id}`} className="text-base font-bold text-gray-900 hover:text-amber-600 transition-colors">{a.name}</Link>
            ) : (
              <p className="text-base font-bold text-gray-900">{a.name}</p>
            )}
            {a.fromCity && <span className="text-xs text-gray-600">from {a.fromCity}</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-600 flex-wrap">
            <span className="font-semibold text-amber-700">{formatRange(a.startsOn, a.endsOn)}</span>
            {a.neighborhood && <span><span aria-hidden="true">· 📍 </span>{a.neighborhood}</span>}
            {a.travelerType && TRAVELER_LABEL[a.travelerType] && (
              <span><span aria-hidden="true">· </span>{TRAVELER_LABEL[a.travelerType]}</span>
            )}
            {a.languages.length > 0 && (
              <span><span aria-hidden="true">· 🗣️ </span>{a.languages.join(', ')}</span>
            )}
          </div>
        </div>
      </div>
      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap mb-3">{a.intro}</p>

      {/* Looking for + shared interests + events during stay */}
      {(a.lookingFor.length > 0 || sharedInterests.length > 0 || sharedLanguages.length > 0
        || sameNeighborhood || eventsInWindow.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {a.lookingFor.map(v => LOOKING_FOR_META[v] && (
            <span key={v} className="text-xs bg-violet-50 text-violet-700 border border-violet-100 px-2 py-0.5 rounded-full font-medium">
              {LOOKING_FOR_META[v].emoji} {LOOKING_FOR_META[v].label}
            </span>
          ))}
          {sharedInterests.map(i => (
            <span key={i} className="text-xs bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-full font-medium">
              🎯 {i}
            </span>
          ))}
          {sharedLanguages.map(l => (
            <span key={l} className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full font-medium">
              <span aria-hidden="true">🗣️ </span>You both speak {l}
            </span>
          ))}
          {sameNeighborhood && (
            <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full font-medium">
              <span aria-hidden="true">📍 </span>Staying in your neighbourhood
            </span>
          )}
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
          {overlapping.map(({ o, shared }, i) => (
            <span key={o.id}>
              {i > 0 && ', '}
              {o.user
                ? <Link href={`/members/${o.user.id}`} className="font-semibold text-gray-700 hover:text-amber-600 transition-colors">{o.name.split(' ')[0]}</Link>
                : <span className="font-semibold text-gray-700">{o.name.split(' ')[0]}</span>
              }
              {shared.length > 0 && LOOKING_FOR_META[shared[0]] && (
                <span className="text-violet-600"> (also wants {LOOKING_FOR_META[shared[0]].label.toLowerCase()})</span>
              )}
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

      {/* Actions pinned to the card bottom (mt-auto) so cards in a row keep
          their buttons on one line regardless of intro length. Hidden for
          logged-out viewers — this page browses publicly, and an anonymous
          click would just 401 with no explanation. */}
      {viewerId && a.user && !isSelf && (
        <div className="flex flex-wrap items-center gap-2 mt-auto pt-4">
          <button onClick={() => setCoffeeOpen(true)}
            className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full bg-amber-500 hover:bg-amber-600 text-white transition-colors whitespace-nowrap">
            ☕ Invite for coffee
          </button>
          <Link href={`/members/${a.user.id}`}
            className="text-xs font-semibold text-gray-500 hover:text-amber-600 transition-colors whitespace-nowrap">
            View profile →
          </Link>
        </div>
      )}

      {coffeeOpen && a.user && (
        <CoffeeInviteModal target={a.user} onClose={() => setCoffeeOpen(false)} />
      )}
    </div>
  )
}

export default function VisitingClient({ announcements, events, cityCount, featuredLocals, cityName }: Props) {
  const { user, isLoggedIn } = useAuth()
  const viewerId        = isLoggedIn ? user.id        : null
  const viewerInterests = isLoggedIn ? (user.interests ?? []) as string[] : []
  const viewerLanguages = isLoggedIn ? (user.languages ?? []) as string[] : []
  const viewerNeighborhood = isLoggedIn ? (user.neighborhood ?? null) : null
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
    const out = { now: 0, week: 0, month: 0, later: 0 }
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

  // Anyone currently in the city sorts to the top — they're the only people
  // on this page you can actually meet today — then by arrival date so the
  // soonest arrivals lead the rest.
  const sorted = useMemo(() => {
    const rank = (a: Announcement) => (arrivalStatus(a, todayUTC).tone === 'now' ? 0 : 1)
    return [...filtered].sort((x, y) => rank(x) - rank(y) || x.startsOn.localeCompare(y.startsOn))
  }, [filtered, todayUTC])

  const CHIPS: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all',   label: 'All',          count: announcements.length },
    { key: 'now',   label: 'Here now',     count: buckets.now },
    { key: 'week',  label: 'This week',    count: buckets.week },
    { key: 'month', label: 'Next 30 days', count: buckets.week + buckets.month },
    { key: 'later', label: 'Later',        count: buckets.later },
  ]

  const upcomingCount = buckets.week + buckets.month

  return (
    <>
      <div className="mb-6">
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">
          Who&apos;s Coming to {cityName}?
        </h2>
        <p className="text-gray-600 mt-2">
          Meet Smileys members arriving soon and help them feel at home.
        </p>
        {/* Stats banner */}
        {(buckets.now > 0 || upcomingCount > 0) && (
          <p className="text-sm text-gray-500 mt-3">
            {buckets.now > 0 && <><span className="font-semibold text-gray-700">{buckets.now}</span> here now</>}
            {buckets.now > 0 && upcomingCount > 0 && ' · '}
            {upcomingCount > 0 && <><span className="font-semibold text-gray-700">{upcomingCount}</span> arriving in the next 30 days</>}
            {cityCount > 1 && <> · from <span className="font-semibold text-gray-700">{cityCount}</span> cities</>}
          </p>
        )}
      </div>

      {/* Filter chips */}
      {announcements.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-4">
          {CHIPS.map(c => (
            <button key={c.key} onClick={() => setFilter(c.key)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors border whitespace-nowrap ${
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
      ) : (
        /* Grid widens with the roster rather than forcing a 3-up layout the
           page can't fill yet: one visitor gets a single readable card, not
           a lone tile stranded beside two empty columns. Bucket headings are
           gone because each card now carries its own arrival badge, which
           says the same thing more precisely. */
        <div className={
          sorted.length === 1 ? 'grid grid-cols-1 max-w-2xl gap-5'
          : sorted.length === 2 ? 'grid grid-cols-1 md:grid-cols-2 gap-5'
          : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5'
        }>
          {sorted.map(a => (
            <AnnouncementCard key={a.id} a={a} viewerId={viewerId} viewerInterests={viewerInterests}
              viewerLanguages={viewerLanguages} viewerNeighborhood={viewerNeighborhood}
              events={events} allAnnouncements={announcements} todayUTC={todayUTC} />
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
