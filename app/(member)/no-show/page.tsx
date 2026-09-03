'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { NO_SHOW_CANCELLATION_CUTOFF_HOURS, NO_SHOW_ROLLING_WINDOW_DAYS, RED_CARD_BLOCK_DAYS, NO_SHOW_POLICY_PATH } from '@/lib/noShowPolicy'

// The member's own no-show standing, in full: every live card, what it
// means, and the appeal form for a red card inside its window. Same facts
// as the banner, room to explain them. Nobody else's data appears here.

interface Card {
  id: string; kind: 'yellow' | 'red'; status: string; occurredAt: string
  event: { id: string; title: string; emoji: string; date: string }
  acknowledgedAt: string | null
  appealDeadlineAt: string | null; appealStatus: string | null; appealedAt: string | null
  restrictionStartsAt: string | null; restrictionEndsAt: string | null
  canAppeal: boolean
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
const fmtT = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function NoShowPage() {
  const [cards,   setCards]   = useState<Card[] | null>(null)
  const [note,    setNote]    = useState('')
  const [sending, setSending] = useState(false)

  const [failed, setFailed] = useState(false)
  const load = () => fetch('/app/api/no-show/status', { credentials: 'include' })
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
    .then(d => { setCards(d?.cards ?? []); setFailed(false) })
    .catch(() => { setCards([]); setFailed(true) })
  useEffect(() => { load() }, [])

  async function appeal(cardId: string) {
    setSending(true)
    try {
      const res  = await fetch(`/app/api/no-show/cards/${cardId}/appeal`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Could not send the appeal'); return }
      toast.success('Appeal sent — nothing is paused while it is reviewed.')
      setNote('')
      load()
    } finally { setSending(false) }
  }

  if (cards === null) return <div className="min-h-screen bg-warm" />

  const red    = cards.find(c => c.kind === 'red')
  const yellow = cards.filter(c => c.kind === 'yellow')

  return (
    <div className="min-h-screen bg-warm px-4 py-10">
      <div className="max-w-xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">Your RSVP standing</h1>
          <p className="text-sm text-gray-600 mt-1">
            Spots at free events are limited. When someone RSVPs and doesn&apos;t come, a place on the waitlist went unused.
            Cancelling at least {NO_SHOW_CANCELLATION_CUTOFF_HOURS} hours before an event always keeps you clear.
          </p>
          {/* This page answers "what happened to me"; the article answers "why
              does this exist and what are the actual rules". A member who lands
              here from a card email needs both. */}
          <Link href={NO_SHOW_POLICY_PATH} className="inline-block mt-2 text-sm font-semibold text-amber-600 hover:text-amber-700 underline">
            Read how free-event spots work →
          </Link>
        </div>

        {failed && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-800">Couldn&apos;t load your standing right now. Try again in a moment.</div>
        )}
        {cards.length === 0 && !failed && (
          <div className="bg-white rounded-2xl shadow-card p-6 text-center">
            <div className="text-4xl mb-2">✅</div>
            <p className="font-semibold text-gray-900">Nothing on record</p>
            <p className="text-sm text-gray-500 mt-1">You have no active no-show notices.</p>
            <Link href="/events" className="inline-block mt-4 text-sm font-semibold text-amber-600 hover:text-amber-700 underline">Browse events →</Link>
          </div>
        )}

        {red && (
          <div className="bg-white rounded-2xl shadow-card p-6 border-l-4 border-red-400">
            <div className="flex items-start gap-3">
              <span className="text-2xl" aria-hidden="true">🟥</span>
              <div className="flex-1">
                <h2 className="font-bold text-gray-900">Second no-show — {red.event.emoji} {red.event.title}</h2>
                <p className="text-xs text-gray-500 mt-0.5">{fmt(red.event.date)}</p>
                {red.status === 'appeal_pending' ? (
                  <p className="text-sm text-gray-700 mt-3">
                    Your appeal from {red.appealedAt ? fmtT(red.appealedAt) : 'earlier'} is being reviewed. Nothing is paused while it is open; we&apos;ll notify you either way.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-gray-700 mt-3">
                      RSVPs and waitlists are paused for {RED_CARD_BLOCK_DAYS} days,
                      {red.restrictionStartsAt && red.restrictionEndsAt && <> from <strong>{fmt(red.restrictionStartsAt)}</strong> to <strong>{fmt(red.restrictionEndsAt)}</strong></>}.
                      Everything else stays open. Any RSVP you already hold still stands.
                    </p>
                    {red.appealStatus === 'rejected' && (
                      <p className="text-xs text-gray-500 mt-2">Your appeal was reviewed and the card stands.</p>
                    )}
                    {red.canAppeal && red.appealDeadlineAt && (
                      <div className="mt-4">
                        <p className="text-sm font-semibold text-gray-900">Think this is wrong?</p>
                        <p className="text-xs text-gray-500 mb-2">
                          You can appeal until <strong>{fmtT(red.appealDeadlineAt)}</strong>. If you were there, or the host missed your check-in, say so — the host can also clear it directly.
                        </p>
                        <textarea
                          value={note} onChange={e => setNote(e.target.value)} maxLength={2000} rows={4}
                          placeholder="What happened?"
                          className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        <button onClick={() => appeal(red.id)} disabled={sending || note.trim().length < 10}
                          className="mt-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
                          {sending ? 'Sending…' : 'Send appeal'}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {yellow.map(c => (
          <div key={c.id} className="bg-white rounded-2xl shadow-card p-6 border-l-4 border-amber-400">
            <div className="flex items-start gap-3">
              <span className="text-2xl" aria-hidden="true">🟨</span>
              <div className="flex-1">
                <h2 className="font-bold text-gray-900">We missed you — {c.event.emoji} {c.event.title}</h2>
                <p className="text-xs text-gray-500 mt-0.5">{fmt(c.event.date)}</p>
                <p className="text-sm text-gray-700 mt-3">
                  You had a confirmed spot, check-in ran, and you weren&apos;t checked in. This is a heads-up only.
                  {c.acknowledgedAt
                    ? ' You\'ve since confirmed you\'ll come to your next event — thank you.'
                    : ' Next time you RSVP we\'ll ask you to confirm you\'re really coming.'}
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  A second no-show within {NO_SHOW_ROLLING_WINDOW_DAYS} days pauses RSVPs for {RED_CARD_BLOCK_DAYS} days. If this one is a mistake, the event&apos;s host can clear it.
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
