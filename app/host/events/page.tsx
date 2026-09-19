'use client'

import { useState, useEffect, Suspense } from 'react'
import { confirmToast } from '@/lib/confirmToast'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import {resolveImageUrl} from '@/lib/data'
import { todayInTz, DEFAULT_TZ } from '@/lib/cityTime'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import { useAuth } from '@/contexts/AuthContext'
import { eventHasStarted } from '@/lib/eventTime'
import { eventTz } from '@/lib/hostPanel'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { loadFailure } from '@/lib/admin/useAdminLoad'

interface Event {
  id: string
  title: string
  date: string
  time: string
  location: string
  status: string
  emoji: string
  totalSpots: number
  coverImage: string | null
  checkedInCount?: number
  _count?: { attendees: number }
  endTime?: string | null
  // The event's own city clock (/api/host/events); the browsed city's when absent.
  timezone?: string | null
}

const STATUS_COLORS: Record<string, string> = {
  published:   'bg-green-500/10 text-green-400',
  draft:       'bg-zinc-700/50 text-zinc-400',
  cancelled:   'bg-red-500/10 text-red-400',
  postponed:   'bg-amber-500/10 text-amber-400',
  archived:    'bg-zinc-700/50 text-zinc-500',
  pending:     'bg-violet-500/10 text-violet-400',
  flagged:     'bg-red-500/15 text-red-300',
  unpublished: 'bg-zinc-700/50 text-zinc-400',
}

// The raw status words meant nothing to a host: "flagged" read like a
// warning about a member, "pending" like a payment.
const STATUS_LABELS: Record<string, string> = {
  pending:     'Awaiting review',
  flagged:     'Not approved',
  unpublished: 'Unpublished',
}

// Statuses only a moderator moves an event out of. A host may still cancel
// one (the PUT route refuses every other move), so that is all the menu offers.
const STAFF_HELD = new Set(['pending', 'flagged', 'unpublished'])

// Asked before a host parks a published event. Draft/Postponed used to read
// like a harmless toggle; it takes the event off the public feed.
function parkLiveEventMessage(status: string) {
  const back = 'You can publish it again yourself if staff published it before — otherwise a moderator has to.'
  return status === 'draft'
    ? `Move this live event to Draft? It leaves the public feed and members can't RSVP. ${back}`
    : `Postpone this live event? It leaves the public feed and everyone going is notified. ${back}`
}

type Tab = 'upcoming' | 'pending' | 'past'

function StatusMenu({ e, started, isStaff, saving, onStatusChange }: { e: Event; started: boolean; isStaff: boolean; saving: boolean; onStatusChange: (id: string, status: string) => void }) {
  const [open, setOpen] = useState(false)
  // Once the event has started there is nothing to cancel or postpone — the
  // guests are there (or not), and the PUT route refuses both with a 409.
  const held = STAFF_HELD.has(e.status)
  const actions = [
    !started && e.status !== 'cancelled'  && { label: 'Cancel',    status: 'cancelled',  cls: 'text-red-400' },
    // A cancelled event stays cancelled through these moves — no spots come
    // back and only a moderator can publish it again.
    !held && !started && e.status !== 'postponed'  && { label: e.status === 'cancelled' ? 'Postpone (stays cancelled)' : 'Postpone',  status: 'postponed',  cls: 'text-amber-400' },
    // Archiving is staff's: the standing sweep reads an archived event as
    // held, so the PUT route refuses it from a host.
    isStaff && !held && e.status !== 'archived'   && { label: e.status === 'cancelled' ? 'Archive (stays cancelled)'  : 'Archive',   status: 'archived',   cls: 'text-zinc-400' },
    // Publishing is a staff decision (the edit route blocks a host's move
    // INTO published) — offering it here produced a failure every time.
    // Nor Draft once it has started: that too rewrites what was held.
    !held && !started && e.status !== 'draft'      && { label: e.status === 'cancelled' ? 'Draft (stays cancelled)'    : 'Draft',     status: 'draft',      cls: 'text-zinc-400' },
  ].filter(Boolean) as { label: string; status: string; cls: string }[]

  if (actions.length === 0) return null

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} title="Change status" disabled={saving}
        className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border border-zinc-700 transition-colors disabled:opacity-40">
        {saving ? (
          <div className="w-3.5 h-3.5 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
          </svg>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 bg-zinc-800 border border-zinc-700 rounded-xl shadow-xl z-20 py-1 min-w-[130px]">
            {actions.map(a => (
              <button key={a.status} onClick={() => { setOpen(false); onStatusChange(e.id, a.status) }}
                className={`w-full text-left px-4 py-2 text-xs font-semibold hover:bg-zinc-700 transition-colors ${a.cls}`}>
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function EventRow({ e, started, isStaff, saving, onDuplicate, onStatusChange, isPast }: { e: Event; started: boolean; isStaff: boolean; saving: boolean; onDuplicate: () => void; onStatusChange: (id: string, status: string) => void; isPast?: boolean }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      {/* Top: image + info */}
      <div className="flex items-center gap-3">
        <Link href={`/host/events/${e.id}/edit`} className="shrink-0">
          {e.coverImage ? (
            <img src={resolveImageUrl(e.coverImage)} alt={e.title} className="w-14 h-14 rounded-lg object-cover hover:opacity-80 transition-opacity" />
          ) : (
            <div aria-hidden="true" className="w-14 h-14 rounded-lg bg-zinc-800 flex items-center justify-center text-2xl hover:bg-zinc-700 transition-colors">{e.emoji}</div>
          )}
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <Link href={`/host/events/${e.id}/edit`} className="text-sm font-semibold text-white hover:text-amber-400 transition-colors truncate">
              {e.title}
            </Link>
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold shrink-0 ${STATUS_COLORS[e.status] ?? STATUS_COLORS.draft}`}>
              {STATUS_LABELS[e.status] ?? e.status}
            </span>
          </div>
          {/* A declined event used to sit in the list as "flagged" with no word
              on what that meant or what to do next. */}
          {e.status === 'flagged' && (
            <p className="text-xs text-red-300/90 mb-1">A moderator didn&apos;t approve this — open Edit to change it and resubmit for review, or contact the team.</p>
          )}
          <div className="text-xs text-zinc-400 truncate">{e.date} · {e.time}</div>
          <div className="text-xs text-zinc-500 mt-0.5">{e._count?.attendees ?? 0} / {e.totalSpots} attendees · {e.location}</div>
          {isPast && (e.checkedInCount ?? 0) > 0 && (() => {
            const total = e._count?.attendees ?? 0
            const pct   = total > 0 ? Math.round((e.checkedInCount! / total) * 100) : 0
            const color = pct >= 80 ? '#34d399' : pct >= 50 ? '#f59e0b' : '#71717a'
            return (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
                </div>
                <span className="text-xs font-semibold shrink-0" style={{ color }}>{e.checkedInCount} showed up ({pct}%)</span>
              </div>
            )
          })()}
          {!isPast && e.totalSpots > 0 && (() => {
            const pct = Math.round(((e._count?.attendees ?? 0) / e.totalSpots) * 100)
            const color = pct >= 80 ? '#34d399' : pct >= 50 ? '#f59e0b' : '#71717a'
            return (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
                </div>
                <span className="text-xs font-semibold shrink-0" style={{ color }}>{pct}%</span>
              </div>
            )
          })()}
        </div>
      </div>

      {/* Bottom: actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
        <Link href={`/host/events/${e.id}/participants`}
          className="flex-1 text-center text-xs text-zinc-400 hover:text-white border border-zinc-700 px-3 py-1.5 rounded-lg transition-colors">
          Participants
        </Link>
        <Link href={`/host/events/${e.id}/edit`}
          className="flex-1 text-center text-xs text-zinc-400 hover:text-white border border-zinc-700 px-3 py-1.5 rounded-lg transition-colors">
          Edit
        </Link>
        <button onClick={onDuplicate} title="Duplicate"
          className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-amber-400 border border-zinc-700 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
        </button>
        <StatusMenu e={e} started={started} isStaff={isStaff} saving={saving} onStatusChange={onStatusChange} />
      </div>
    </div>
  )
}

export default function HostEventsPage() {
  return <Suspense><HostEventsList /></Suspense>
}

function HostEventsList() {
  // "Today" is each event's CITY's calendar day (its `timezone`, falling back
  // to the browsed city's) — a member abroad, or a city in another zone, must
  // not get a different Tuesday than the community means.
  const tz = useCurrentCity()?.timezone ?? DEFAULT_TZ
  const router   = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const isStaff  = user?.role === 'admin' || user?.role === 'moderator'
  const [events,       setEvents]       = useState<Event[]>([])
  const [loading,      setLoading]      = useState(true)
  const [loadError,    setLoadError]    = useState<string | null>(null)
  const [reloadTick,   setReloadTick]   = useState(0)
  const [savingId,     setSavingId]     = useState<string | null>(null)
  // ?tab=pending: where the create form lands a host whose event went to
  // review, so the event they just made is the first thing they see.
  const initialTab = searchParams.get('tab')
  const [tab,          setTab]          = useState<Tab>(initialTab === 'pending' || initialTab === 'past' ? initialTab : 'upcoming')

  // A failed load showed "No upcoming events — create your first" to a host
  // with a full calendar. It raises a Retry banner instead.
  useEffect(() => {
    setLoadError(null)
    fetch('/app/api/host/events', { credentials: 'include' })
      .then(async r => { if (!r.ok) throw await loadFailure(r); return r.json() })
      .then(d => setEvents(Array.isArray(d) ? d : []))
      .catch((e: Error) => setLoadError(e?.message ?? 'Failed to load'))
      .finally(() => setLoading(false))
  }, [reloadTick])

  async function handleDuplicate(id: string) {
    try {
      const res = await fetch(`/app/api/events/${id}`, { credentials: 'include' })
      if (!res.ok) { toast.error('Failed to duplicate event'); return }
      const event = await res.json()
      sessionStorage.setItem('smileys_dup_event', JSON.stringify(event))
      router.push('/host/events/new')
    } catch { toast.error('Failed to duplicate event') }
  }

  async function handleStatusChange(id: string, status: string) {
    if (status === 'cancelled' && !(await confirmToast('Cancel this event? Attendees will be notified.'))) return
    // Parking a LIVE event pulls it off the public feed — say so before it
    // happens, and say how it comes back (the PUT route lets a host republish
    // only an event staff published before).
    const current = events.find(e => e.id === id)
    if (current?.status === 'published' && (status === 'draft' || status === 'postponed') &&
        !(await confirmToast(parkLiveEventMessage(status), { confirmLabel: status === 'draft' ? 'Move to draft' : 'Postpone', cancelLabel: 'Keep it live' }))) return
    setSavingId(id)
    const res = await fetch(`/app/api/admin/events/${id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) setEvents(prev => prev.map(e => e.id === id ? { ...e, status } : e))
    else toast.error((await res.json().catch(() => ({})))?.error ?? 'Failed to update status')
    setSavingId(null)
  }

  const todayOf  = (e: Event) => todayInTz(eventTz(e, tz))
  const started  = (e: Event) => eventHasStarted(e, eventTz(e, tz))
  const pending  = events.filter(e => e.status === 'pending')
  const upcoming = events.filter(e => e.date >= todayOf(e) && e.status !== 'pending').sort((a, b) => a.date.localeCompare(b.date))
  const past     = events.filter(e => e.date < todayOf(e) && e.status !== 'pending').sort((a, b) => b.date.localeCompare(a.date))
  const displayed = tab === 'upcoming' ? upcoming : tab === 'pending' ? pending : past

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">My Events</h1>
        <Link href="/host/events/new" className="text-sm bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl font-medium transition-colors">
          + New Event
        </Link>
      </div>

      {/* Tabs — one row that scrolls sideways on a phone; wrapped, the
          active underline landed on a second line under the wrong tab. */}
      <div className="flex gap-1 border-b border-zinc-800 mb-6 overflow-x-auto scrollbar-hide">
        {([
          { key: 'upcoming', label: 'Upcoming',       count: upcoming.length,               accent: false },
          ...(pending.length > 0 || tab === 'pending' ? [{ key: 'pending', label: 'Awaiting Review', count: pending.length, accent: true  }] : []),
          { key: 'past',     label: 'Past',            count: past.length,                   accent: false },
        ] as { key: Tab; label: string; count: number; accent: boolean }[]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`shrink-0 whitespace-nowrap px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? t.accent ? 'border-violet-500 text-violet-400' : 'border-amber-500 text-amber-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-200'
            }`}>
            {t.label}
            {t.count > 0 && (
              <span className={`ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full ${
                tab === t.key
                  ? t.accent ? 'bg-violet-500/20 text-violet-400' : 'bg-amber-500/20 text-amber-400'
                  : t.accent ? 'bg-violet-500/10 text-violet-500' : 'bg-zinc-800 text-zinc-500'
              }`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-zinc-500 text-sm">Loading…</div>
      ) : loadError ? (
        <LoadErrorBanner message={loadError} title="Couldn't load your events"
          onRetry={() => { setLoading(true); setReloadTick(t => t + 1) }} />
      ) : displayed.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
          <div aria-hidden="true" className="text-4xl mb-3">{tab === 'upcoming' ? '🎉' : tab === 'pending' ? '✅' : '📚'}</div>
          <div className="text-zinc-300 font-medium mb-1">
            {tab === 'upcoming' ? 'No upcoming events' : tab === 'pending' ? 'Nothing awaiting review' : 'No past events'}
          </div>
          <div className="text-zinc-500 text-sm mb-6">
            {tab === 'upcoming' ? 'Create your first event to get started.' : tab === 'pending' ? 'Nothing of yours is waiting on a moderator.' : 'Past events will appear here.'}
          </div>
          {tab === 'upcoming' && (
            <Link href="/host/events/new" className="inline-block bg-amber-500 hover:bg-amber-600 text-white text-sm px-5 py-2.5 rounded-xl font-medium transition-colors">
              Create Event
            </Link>
          )}
        </div>
      ) : (
        <div className={`space-y-3 ${tab === 'past' ? 'opacity-75' : ''}`}>
          {tab === 'pending' && (
            <p className="text-xs text-zinc-500">A moderator checks new events before they go live. You&apos;ll be notified when one is approved.</p>
          )}
          {displayed.map(e => <EventRow key={e.id} e={e} started={started(e)} isStaff={isStaff} saving={savingId === e.id} onDuplicate={() => handleDuplicate(e.id)} onStatusChange={handleStatusChange} isPast={tab === 'past'} />)}
        </div>
      )}
    </div>
  )
}
