'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

// Post-event safety survey — two questions, anonymous from the host's
// perspective. Renders only when the viewer is an eligible attendee of
// a recently-ended event. Other states (not attending, too early, past
// the window, already submitted) show a quick explanation and let the
// user navigate back rather than presenting a half-broken form.

type Reason = 'submitted' | 'not-attendee' | 'too-early' | 'window-closed'

interface Eligibility {
  event: { id: string; title: string; emoji: string; date: string }
  eligible: boolean
  reason?: Reason
  // Directory listing for this event's venue, when one exists and the
  // viewer hasn't reviewed it yet — unlocks the optional Q3.
  venue?: { id: string; name: string } | null
}

export default function FeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [ctx,         setCtx]         = useState<Eligibility | null>(null)
  const [loadFailed,  setLoadFailed]  = useState(false)
  const [anomaly,     setAnomaly]     = useState<boolean | null>(null)
  const [anomalyNote, setAnomalyNote] = useState('')
  const [wouldReturn, setWouldReturn] = useState<boolean | null>(null)
  // Optional venue review — 0 means "skipped". Tapping the selected
  // star again clears it.
  const [venueRating,  setVenueRating]  = useState(0)
  const [venueComment, setVenueComment] = useState('')
  const [submitting,  setSubmitting]  = useState(false)
  const [done,        setDone]        = useState(false)

  useEffect(() => {
    fetch(`/app/api/events/${id}/feedback`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setCtx(d); else setLoadFailed(true) })
      .catch(() => setLoadFailed(true))
  }, [id])

  async function submit() {
    if (anomaly === null || wouldReturn === null) return
    setSubmitting(true)
    try {
      const res = await fetch(`/app/api/events/${id}/feedback`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anomaly,
          anomalyNote: anomaly ? anomalyNote.trim() : undefined,
          wouldReturn,
          ...(venueRating > 0 ? { venueRating, venueComment: venueComment.trim() || undefined } : {}),
        }),
      })
      if (res.ok) {
        setDone(true)
      } else {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error ?? 'Could not submit feedback')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loadFailed) {
    return <Shell><p className="text-zinc-400 text-sm">Could not load this survey. Try again later.</p></Shell>
  }

  if (!ctx) {
    return (
      <Shell>
        <div className="space-y-3">
          <div className="h-6 w-2/3 rounded bg-zinc-800 animate-pulse" />
          <div className="h-4 w-1/2 rounded bg-zinc-800/60 animate-pulse" />
          <div className="h-20 w-full rounded-xl bg-zinc-800/40 animate-pulse mt-4" />
        </div>
      </Shell>
    )
  }

  // Non-eligible terminal states get a plain-language explanation +
  // a way out. We never reveal anything about other respondents.
  if (done) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-white mb-2">Thanks 🙏</h1>
        <p className="text-zinc-400 text-sm">Your feedback is in. {anomaly ? 'A moderator will review what you flagged.' : "We'll use this to keep curation tight."}</p>
        <button onClick={() => router.push('/events')} className="mt-6 text-amber-400 text-sm hover:underline">
          ← Back to events
        </button>
      </Shell>
    )
  }
  if (!ctx.eligible) {
    const msg =
      ctx.reason === 'submitted'     ? "You've already shared feedback for this event. Thanks again."
    : ctx.reason === 'not-attendee'  ? "You weren't registered for this event."
    : ctx.reason === 'too-early'     ? "This event hasn't ended yet — come back after."
    :                                  'The feedback window for this event has closed (we collect within 7 days).'
    return (
      <Shell>
        <h1 className="text-xl font-bold text-white mb-2">{ctx.event.emoji} {ctx.event.title}</h1>
        <p className="text-zinc-400 text-sm">{msg}</p>
        <button onClick={() => router.push('/events')} className="mt-6 text-amber-400 text-sm hover:underline">
          ← Back to events
        </button>
      </Shell>
    )
  }

  // The eligible form. Two questions, large tap targets. When anomaly
  // === true a written note is REQUIRED (min 10 chars) — an empty flag
  // files a report moderators can't action. The common "nothing weird,
  // would go again" path stays a two-tap submit.
  const noteOk     = anomaly !== true || anomalyNote.trim().length >= 10
  const canSubmit  = anomaly !== null && wouldReturn !== null && noteOk
  return (
    <Shell>
      <div className="text-xs text-zinc-500 uppercase tracking-widest mb-2">Quick feedback</div>
      <h1 className="text-xl font-bold text-white">{ctx.event.emoji} {ctx.event.title}</h1>
      <p className="text-xs text-zinc-500 mt-0.5">{new Date(ctx.event.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <p className="text-xs text-zinc-500 mt-2">Two questions. Your name isn't shared with the host.</p>

      {/* Q1 — anomaly */}
      <div className="mt-6 space-y-2">
        <p className="text-sm font-semibold text-white">Did anything feel off at this event?</p>
        <div className="flex gap-2">
          <Choice label="No, all good" active={anomaly === false} onClick={() => setAnomaly(false)} variant="ok" />
          <Choice label="Yes — flag it" active={anomaly === true}  onClick={() => setAnomaly(true)}  variant="warn" />
        </div>
        {anomaly === true && (
          <div className="mt-2">
            <textarea
              value={anomalyNote}
              onChange={e => setAnomalyNote(e.target.value)}
              placeholder="What happened? Moderators read this, not the host. The more detail the better."
              rows={4}
              required
              className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
            />
            <p className="text-xs text-zinc-500 mt-1">
              {anomalyNote.trim().length < 10
                ? `Required — add a bit of detail so moderators can act (${anomalyNote.trim().length}/10).`
                : 'Thanks — this gives moderators something to act on.'}
            </p>
          </div>
        )}
      </div>

      {/* Q2 — wouldReturn */}
      <div className="mt-6 space-y-2">
        <p className="text-sm font-semibold text-white">Would you go to another event like this?</p>
        <div className="flex gap-2">
          <Choice label="Yes" active={wouldReturn === true}  onClick={() => setWouldReturn(true)}  variant="ok" />
          <Choice label="No"  active={wouldReturn === false} onClick={() => setWouldReturn(false)} variant="warn" />
        </div>
      </div>

      {/* Q3 — optional venue review. Only offered when the venue has a
          directory listing the member hasn't reviewed. Unlike Q1/Q2
          this is PUBLIC — the copy says so explicitly before they tap. */}
      {ctx.venue && (
        <div className="mt-6 space-y-2">
          <p className="text-sm font-semibold text-white">How was {ctx.venue.name}? <span className="text-zinc-500 font-normal">(optional)</span></p>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onClick={() => setVenueRating(r => r === n ? 0 : n)}
                aria-label={`${n} star${n === 1 ? '' : 's'}`}
                className={`flex-1 py-2.5 rounded-xl text-xl border transition-colors ${
                  venueRating >= n
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                    : 'bg-zinc-900 border-zinc-700 text-zinc-600 hover:bg-zinc-800'
                }`}
              >
                ★
              </button>
            ))}
          </div>
          {venueRating > 0 && (
            <>
              <textarea
                value={venueComment}
                onChange={e => setVenueComment(e.target.value)}
                placeholder={`What makes ${ctx.venue.name} good (or not)? Optional.`}
                rows={3}
                maxLength={1000}
                className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
              />
              <p className="text-xs text-zinc-500">
                Posted publicly on the directory as your review, with your name. Tap the star again to skip.
              </p>
            </>
          )}
        </div>
      )}

      <button
        onClick={submit}
        disabled={!canSubmit || submitting}
        className="w-full mt-8 py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? 'Sending…' : 'Submit feedback'}
      </button>
    </Shell>
  )
}

function Choice({ label, active, onClick, variant }: { label: string; active: boolean; onClick: () => void; variant: 'ok' | 'warn' }) {
  const activeCls = variant === 'ok'
    ? 'bg-green-500/20 text-green-300 border-green-500/40'
    : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-3 rounded-xl text-sm font-semibold border transition-colors ${
        active ? activeCls : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:bg-zinc-800'
      }`}
    >
      {label}
    </button>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-6">
      <div className="max-w-md mx-auto pt-6">{children}</div>
    </div>
  )
}
