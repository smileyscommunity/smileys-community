'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { promptToast } from '@/lib/promptToast'
import { confirmToast } from '@/lib/confirmToast'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { loadFailure } from '@/lib/admin/useAdminLoad'
import { useAdminCities } from '@/components/admin/CitySelect'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import { DEFAULT_TZ } from '@/lib/cityTime'
import { REVIEW_CONFLICT_MESSAGE, type ReviewConflict } from '@/lib/noShowPolicy'
import { useAuth } from '@/contexts/AuthContext'
import { memberHref } from '@/lib/adminNav'

// No-show cards inbox. Default view is what needs a decision: red cards
// under appeal. Accept clears the card; reject re-arms the block (from the
// later of "now" and the appeal deadline); overturn clears any open card
// without an appeal. Hosts waive their own event's cards from the
// participants page — this is the admin/moderator side.

interface Card {
  id: string; kind: 'yellow' | 'red'; status: string; occurredAt: string; issuedAt: string
  appealNote: string | null; appealedAt: string | null; appealStatus: string | null; appealDeadlineAt: string | null
  restrictionStartsAt: string | null; restrictionEndsAt: string | null
  waivedAt: string | null; waiveReason: string | null; resolutionNote: string | null
  user:  { id: string; name: string; email: string }
  event: { id: string; title: string; emoji: string; date: string; cityId?: string }
  // Set when the viewer may not judge this card (their own, or an event they run).
  conflict?: ReviewConflict | null
}

type View = 'appeal_pending' | 'active' | 'all'
// Card times (issued, appeal deadline, block window) read on the event
// city's clock — the device's zone put a Tbilisi deadline an hour off.
const fmt = (iso: string | null, tz: string) => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }) : '—'

const STATUS_PILL: Record<string, string> = {
  active:         'bg-zinc-700 text-zinc-200',
  appeal_pending: 'bg-violet-500/15 text-violet-300 border border-violet-500/30',
  waived:         'bg-green-500/15 text-green-400',
  overturned:     'bg-green-500/15 text-green-400',
  expired:        'bg-zinc-800 text-zinc-500',
}

export default function AdminNoShowsPage() {
  // Moderators work this inbox but can't open /admin/users/:id (see memberHref).
  const { user: me } = useAuth()
  const [view,  setView]  = useState<View>('appeal_pending')
  const [cards, setCards] = useState<Card[] | null>(null)
  const [busy,  setBusy]  = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const adminCities = useAdminCities()
  const currentTz   = useCurrentCity()?.timezone ?? DEFAULT_TZ
  const tzFor = (c: Card) => adminCities.find(x => x.id === c.event.cityId)?.timezone ?? currentTz

  // A refused or failed load used to become [] — "No appeals waiting." while
  // appeals sat unanswered. It now shows the reason and a Retry.
  const load = useCallback(() => {
    setCards(null)
    setLoadError(null)
    fetch(`/app/api/admin/no-show/cards?status=${view}`, { credentials: 'include' })
      .then(async r => { if (!r.ok) throw await loadFailure(r); return r.json() })
      .then(d => setCards(Array.isArray(d?.cards) ? d.cards : []))
      .catch((e: Error) => setLoadError(e?.message ?? 'Failed to load'))
  }, [view])
  useEffect(() => { load() }, [load])

  async function resolve(card: Card, action: 'accept' | 'reject' | 'overturn') {
    const note = action === 'overturn'
      ? await promptToast('Why is this card being cleared?', { placeholder: 'Reason (kept in the audit log)', confirmLabel: 'Overturn' })
      : action === 'reject'
        ? await promptToast('Note to the member (optional — leave blank to skip)', { placeholder: 'e.g. Check-in list shows no scan', confirmLabel: 'Reject appeal', allowEmpty: true })
        : (await confirmToast(`Accept ${card.user.name}'s appeal? The card is cleared.`, { confirmLabel: 'Accept' })) ? '' : null
    if (note === null) return
    setBusy(card.id)
    try {
      const res  = await fetch(`/app/api/admin/no-show/cards/${card.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: note || undefined }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Failed'); return }
      toast.success(action === 'reject' ? 'Appeal rejected — block re-armed' : 'Card cleared')
      load()
    } finally { setBusy(null) }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-xl font-bold text-white">No-show cards</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Yellow = warning. Red = RSVPs paused after the appeal window. Hosts waive their own events&apos; cards from Participants.</p>
        </div>
        <div className="flex rounded-lg overflow-hidden text-xs font-semibold">
          {(['appeal_pending', 'active', 'all'] as View[]).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 transition-colors ${view === v ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
              {v === 'appeal_pending' ? 'Appeals' : v === 'active' ? 'Active' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {loadError ? <LoadErrorBanner message={loadError} onRetry={load} title="Couldn't load no-show cards" />
       : cards === null ? <p className="text-zinc-500 text-sm">Loading…</p>
       : cards.length === 0 ? <p className="text-zinc-500 text-sm">{view === 'appeal_pending' ? 'No appeals waiting.' : 'No cards.'}</p>
       : (
        <div className="space-y-3">
          {cards.map(c => (
            <div key={c.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-start gap-3 flex-wrap">
                <span className="text-xl" aria-hidden="true">{c.kind === 'red' ? '🟥' : '🟨'}</span>
                <div className="flex-1 min-w-[12rem]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={memberHref(c.user.id, me?.role)} className="font-semibold text-white hover:underline">{c.user.name}</Link>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase ${STATUS_PILL[c.status] ?? STATUS_PILL.active}`}>{c.status.replace('_', ' ')}</span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {c.event.emoji} <Link href={`/admin/events/${c.event.id}/participants`} className="hover:underline">{c.event.title}</Link> · {c.event.date} · issued {fmt(c.issuedAt, tzFor(c))}
                  </p>
                  {c.kind === 'red' && (
                    <p className="text-xs text-zinc-500 mt-1">
                      Appeal until {fmt(c.appealDeadlineAt, tzFor(c))} · block {fmt(c.restrictionStartsAt, tzFor(c))} → {fmt(c.restrictionEndsAt, tzFor(c))}
                    </p>
                  )}
                  {c.appealNote && (
                    <blockquote className="mt-2 text-sm text-zinc-200 bg-zinc-800/60 rounded-lg px-3 py-2 border-l-2 border-violet-500/50">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Appeal · {fmt(c.appealedAt, tzFor(c))}{c.appealStatus && c.appealStatus !== 'pending' ? ` · ${c.appealStatus}` : ''}</span>
                      <p className="whitespace-pre-wrap break-words mt-1">{c.appealNote}</p>
                    </blockquote>
                  )}
                  {c.waiveReason && <p className="text-xs text-green-400 mt-2">Waived by host: {c.waiveReason}</p>}
                  {c.resolutionNote && <p className="text-xs text-zinc-400 mt-2">Resolution: {c.resolutionNote}</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  {c.conflict ? (
                    (c.status === 'appeal_pending' || c.status === 'active') && (
                      <p className="text-xs text-amber-400 sm:max-w-[14rem]">{REVIEW_CONFLICT_MESSAGE[c.conflict]}</p>
                    )
                  ) : <>
                  {c.status === 'appeal_pending' && (
                    <>
                      <button onClick={() => resolve(c, 'accept')} disabled={busy === c.id}
                        className="px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 hover:bg-green-500/25 text-xs font-semibold disabled:opacity-40">Accept</button>
                      <button onClick={() => resolve(c, 'reject')} disabled={busy === c.id}
                        className="px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 text-xs font-semibold disabled:opacity-40">Reject</button>
                    </>
                  )}
                  {c.status === 'active' && (
                    <button onClick={() => resolve(c, 'overturn')} disabled={busy === c.id}
                      className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-xs font-semibold disabled:opacity-40">Overturn</button>
                  )}
                  </>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
