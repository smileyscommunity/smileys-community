'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { formatDay } from '@/lib/cityTime'
import {
  CANCEL_CUTOFF_HOURS, STANDING_WINDOW_DAYS, YELLOW_CLEARS_AT_COMMITMENTS,
  RED_REVIEW_AT_ATTENDANCES, CARD_LAPSE_DAYS, DISPUTE_WINDOW_DAYS, LATE_SEAT_HOURS,
} from '@/lib/standingPolicy'

// A member's own standing: good, or a card with its path back as filled-or-
// empty markers — a count of commitments, never a percentage or a score. Then
// what is on record, with "I was there" where it applies, and the rules in
// full. Nobody else's data appears here. Until standing is switched on there
// is nothing on record to show.

interface EventRef { id: string; title: string; emoji: string; date: string }
interface Offence {
  id: string; kind: 'no_show' | 'late_cancel'; tier: string; counts: boolean; loggedReason: string | null
  status: string; occurredAt: string; disputeNote: string | null; resolutionNote: string | null
  event: EventRef; canDispute: boolean
}
interface Card {
  id: string; level: 'yellow' | 'red'; status: string; issuedAt: string; have: number; need: number
  recoveries: { source: string; awardedAt: string; event: EventRef | null }[]
}
interface Status { enforced: boolean; level: 'good' | 'yellow' | 'red'; card: Card | null; offences: Offence[] }

// An event's date is a bare calendar day: formatDay keeps it the same day everywhere.
const day = (iso: string) => formatDay(iso, { day: 'numeric', month: 'long' })

const KIND_LABEL: Record<Offence['kind'], string> = { no_show: 'Marked absent', late_cancel: 'Late cancellation' }

function offenceNote(o: Offence): string {
  if (o.status === 'disputed')   return 'You said you were there — waiting on a moderator.'
  if (o.status === 'overturned') return 'Removed — you were there.'
  if (o.status === 'forgiven')   return 'Forgiven — someone from the waitlist took your seat and came.'
  if (!o.counts) return o.loggedReason === 'new_city'
    ? "Noted only — the city is new, so it doesn't count."
    : "Noted only — an open event, so it doesn't count."
  return 'Counts toward a card.'
}

export default function StandingPage() {
  const [status,  setStatus]  = useState<Status | null>(null)
  const [failed,  setFailed]  = useState(false)
  const [open,    setOpen]    = useState<string | null>(null)
  const [note,    setNote]    = useState('')
  const [sending, setSending] = useState(false)

  const load = () => fetch('/app/api/standing/status', { credentials: 'include' })
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
    .then(d => { setStatus(d); setFailed(false) })
    .catch(() => setFailed(true))
  useEffect(() => { load() }, [])

  async function dispute(id: string) {
    setSending(true)
    try {
      const res  = await fetch(`/app/api/standing/offences/${id}/dispute`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? "Couldn't send that"); return }
      toast.success("Sent. A moderator will check with the host — nothing new counts against you meanwhile.")
      setOpen(null); setNote(''); load()
    } catch {
      toast.error('No connection — nothing was sent.')
    } finally {
      setSending(false)
    }
  }

  const card = status?.card ?? null
  const red  = card?.level === 'red'

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900">Your standing</h1>
        <p className="text-sm text-gray-600 mt-1">Whether hosts can count on you when you take a seat. Only you can see this page.</p>
      </div>

      {failed ? (
        <div className="rounded-2xl bg-red-50 border border-red-200 p-4 text-sm text-red-800">
          Couldn&apos;t load your standing. <button onClick={load} className="underline font-semibold">Try again</button>
        </div>
      ) : !status ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          {!card ? (
            <div className="rounded-2xl bg-green-50 border border-green-200 p-5">
              <p className="text-lg font-extrabold text-green-900">✅ You&apos;re in good standing</p>
              <p className="text-sm text-green-800 mt-1">Book any event freely.</p>
            </div>
          ) : (
            <div className={`rounded-2xl border p-5 ${red ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
              <p className={`text-lg font-extrabold ${red ? 'text-red-900' : 'text-amber-900'}`}>
                {red ? '🟥 Red card' : '🟨 Yellow card'} — {Math.min(card.have, card.need)} of {card.need}
              </p>
              <div className="flex gap-2 mt-3" role="img" aria-label={`${Math.min(card.have, card.need)} of ${card.need} successful commitments`}>
                {Array.from({ length: card.need }, (_, i) => (
                  <span key={i} className={`w-6 h-6 rounded-full border-2 ${
                    i < card.have ? (red ? 'bg-red-500 border-red-500' : 'bg-amber-500 border-amber-500') : 'bg-white border-gray-300'
                  }`} />
                ))}
              </div>
              <p className={`text-sm mt-3 leading-relaxed ${red ? 'text-red-800' : 'text-amber-900'}`}>
                {card.status === 'review'
                  ? "You've made your commitments. An admin will review your card and restore your standing."
                  : red
                    ? `Seats at limited events need the host's approval for now, and you join their waitlists at the back. After ${card.need} successful commitments an admin reviews your card. Open events are unaffected.`
                    : `${card.need - card.have} more successful commitment${card.need - card.have === 1 ? '' : 's'} clears your card — being checked in at any event counts. Until then you join limited waitlists at the back.`}
              </p>
              {card.recoveries.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm text-gray-700">
                  {card.recoveries.map((r, i) => (
                    <li key={i}>✓ {r.event ? <>Checked in at {r.event.emoji} {r.event.title} · {day(r.event.date)}</> : 'A successful commitment'}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {status.enforced && status.offences.length > 0 && (
            <div className="rounded-2xl bg-white shadow-card p-5">
              <h2 className="font-bold text-gray-900 mb-3">On your record · last {STANDING_WINDOW_DAYS} days</h2>
              <ul className="divide-y divide-gray-100">
                {status.offences.map(o => (
                  <li key={o.id} className="py-3">
                    <div className="flex items-start gap-3">
                      <span className="text-xl leading-none" aria-hidden="true">{o.event.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{o.event.title}</p>
                        <p className="text-xs text-gray-500">{KIND_LABEL[o.kind]} · {day(o.event.date)}</p>
                        <p className="text-xs text-gray-600 mt-1">{offenceNote(o)}</p>
                      </div>
                      {o.canDispute && open !== o.id && (
                        <button onClick={() => { setOpen(o.id); setNote('') }}
                          className="text-xs font-semibold text-violet-700 hover:text-violet-900 underline whitespace-nowrap">
                          I was there
                        </button>
                      )}
                    </div>
                    {open === o.id && (
                      <div className="mt-3 space-y-2">
                        <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={1000} rows={3}
                          placeholder="Anything that helps the host remember — when you arrived, who you sat with."
                          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
                        <div className="flex gap-2">
                          <button onClick={() => dispute(o.id)} disabled={sending}
                            className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">
                            {sending ? 'Sending…' : 'Send'}
                          </button>
                          <button onClick={() => setOpen(null)} className="px-4 py-2 rounded-xl text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-2xl bg-white shadow-card p-5 text-sm text-gray-700">
            <h2 className="font-bold text-gray-900 mb-2">How it works</h2>
            <ul className="list-disc pl-5 space-y-1.5 leading-relaxed">
              <li>It only concerns <strong>limited events</strong>: any event with limited spots, whatever its size, or a booking the host has promised a venue. Events with no cap on who comes never affect your standing.</li>
              <li>Not coming counts when the host marks you absent, or when the host checked people in and you weren&apos;t. The host sees that list the next day and can excuse you; events where nobody was checked in never count against anyone.</li>
              <li>A seat you took less than {LATE_SEAT_HOURS} hours before the start never counts against you.</li>
              <li>Cancelling a limited event less than {CANCEL_CUTOFF_HOURS.scarce} hours before it starts counts the same as not coming — unless someone from the waitlist takes your seat and comes, or you&apos;re answering the day-before &ldquo;still coming?&rdquo; message.</li>
              <li>Two of those within {STANDING_WINDOW_DAYS} days is a yellow card. One more while on yellow is a red card.</li>
              <li>A yellow card clears after {YELLOW_CLEARS_AT_COMMITMENTS} successful commitments — being checked in at any event. A red card needs {RED_REVIEW_AT_ATTENDANCES}, then an admin&apos;s review.</li>
              <li>With either card you join limited waitlists at the back; with a red card the host approves your seat at limited events.</li>
              <li>A card with no RSVPs for {CARD_LAPSE_DAYS} days lapses. Marked absent by mistake? Tap &ldquo;I was there&rdquo; within {DISPUTE_WINDOW_DAYS} days.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
