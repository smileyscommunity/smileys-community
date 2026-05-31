'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

// Quarterly Net Promoter Score — one question, 0–10 picker, optional
// follow-up comment. The form lives at /survey/nps (not bound to an
// event) so the same URL works every quarter; the period gets stamped
// server-side. Promoters see a referral nudge after submit; detractors
// see a gentle "anything we can do better?" — but BOTH branches reach
// the same anonymous admin rollup. We never out the responder.

type Reason = 'submitted' | 'too-new'
interface Eligibility {
  eligible: boolean
  period:   string
  reason?:  Reason
  minDays?: number     // only when reason === 'too-new'
  yourScore?: number   // only when reason === 'submitted'
}

const SCALE_LABELS: Record<number, string> = {
  0:  'Not at all likely',
  10: 'Extremely likely',
}

export default function NpsPage() {
  const router = useRouter()
  const [ctx,        setCtx]        = useState<Eligibility | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [score,      setScore]      = useState<number | null>(null)
  const [comment,    setComment]    = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done,       setDone]       = useState(false)

  useEffect(() => {
    fetch('/app/api/survey/nps', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setCtx(d); else setLoadFailed(true) })
      .catch(() => setLoadFailed(true))
  }, [])

  async function submit() {
    if (score === null) return
    setSubmitting(true)
    try {
      const res = await fetch('/app/api/survey/nps', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, comment: comment.trim() || undefined }),
      })
      if (res.ok) {
        setDone(true)
      } else {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error ?? 'Could not submit')
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

  // Post-submit thanks state. Promoter branch nudges referrals,
  // detractor branch invites a follow-up message — both routes back
  // to /events so the responder never feels stuck on the survey
  // page.
  if (done) {
    const isPromoter  = score !== null && score >= 9
    const isDetractor = score !== null && score <= 6
    return (
      <Shell>
        <h1 className="text-xl font-bold text-white mb-2">Thanks 🙏</h1>
        <p className="text-zinc-400 text-sm">
          {isPromoter  ? 'Glad we’re doing right by you. If a friend would fit, our apply page is /apply — your referral helps keep the bar high.'
         : isDetractor ? "Sorry it’s not landing. We read every comment — and if you want a real conversation, drop us a line at hello@smileys.community."
         :               'Your input keeps the bar honest. We tally quarterly and act on the trend.'}
        </p>
        <button onClick={() => router.push('/events')} className="mt-6 text-amber-400 text-sm hover:underline">
          ← Back to events
        </button>
      </Shell>
    )
  }

  // Not eligible — either already responded for this quarter or
  // joined too recently. Both branches show a clear reason and a
  // way out.
  if (!ctx.eligible) {
    const msg =
      ctx.reason === 'submitted' ? `You've already shared your score for ${ctx.period}${ctx.yourScore !== undefined ? ` — you scored ${ctx.yourScore}` : ''}. Thanks again.`
    : ctx.reason === 'too-new'   ? `Welcome aboard! Your quarterly NPS unlocks after ${ctx.minDays ?? 30} days — give yourself time to come to a few things first.`
    :                              'Survey not available right now.'
    return (
      <Shell>
        <h1 className="text-xl font-bold text-white mb-2">Quarterly check-in</h1>
        <p className="text-zinc-400 text-sm">{msg}</p>
        <button onClick={() => router.push('/events')} className="mt-6 text-amber-400 text-sm hover:underline">
          ← Back to events
        </button>
      </Shell>
    )
  }

  // The eligible form. Colour-graded 0–10 picker, optional comment
  // box. Comment placeholder swaps by score band so the prompt
  // matches what we want to hear back ("why did you score that?").
  return (
    <Shell>
      <div className="text-xs text-zinc-500 uppercase tracking-widest mb-2">{ctx.period} check-in</div>
      <h1 className="text-xl font-bold text-white">How likely are you to recommend Smileys to a friend?</h1>
      <p className="text-xs text-zinc-500 mt-2">One question. Anonymous — admins see your score and comment but never who wrote it.</p>

      {/* 0–10 picker — 11 squares laid out 6+5 on phones so the row
          doesn't squeeze sub-32px tap targets at 360px. The colour
          band hints at which way the scale runs without giving the
          impression of a "right" answer. */}
      <div className="mt-6">
        <div className="grid grid-cols-6 sm:grid-cols-11 gap-1.5 sm:gap-2">
          {Array.from({ length: 11 }).map((_, n) => {
            const active = score === n
            const tone = n <= 6 ? 'detractor' : n <= 8 ? 'passive' : 'promoter'
            const activeCls =
              tone === 'promoter'  ? 'bg-green-500 text-white  border-green-500'
            : tone === 'passive'   ? 'bg-amber-500 text-white  border-amber-500'
            :                        'bg-red-500   text-white  border-red-500'
            const idleCls =
              tone === 'promoter'  ? 'bg-zinc-900 text-green-400 border-zinc-700 hover:bg-zinc-800'
            : tone === 'passive'   ? 'bg-zinc-900 text-amber-400 border-zinc-700 hover:bg-zinc-800'
            :                        'bg-zinc-900 text-red-400   border-zinc-700 hover:bg-zinc-800'
            return (
              <button
                key={n}
                onClick={() => setScore(n)}
                className={`aspect-square rounded-lg text-sm font-bold border transition-colors ${active ? activeCls : idleCls}`}
              >
                {n}
              </button>
            )
          })}
        </div>
        <div className="flex justify-between mt-2 text-[10px] text-zinc-600 uppercase tracking-wide">
          <span>{SCALE_LABELS[0]}</span>
          <span>{SCALE_LABELS[10]}</span>
        </div>
      </div>

      {/* Comment — placeholder adapts to score so the prompt invites
          the right kind of follow-up. Stays optional throughout. */}
      <div className="mt-6 space-y-2">
        <p className="text-sm font-semibold text-white">Want to say more? <span className="text-zinc-500 font-normal text-xs">(optional)</span></p>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder={
            score === null     ? 'Anything you want us to read…'
          : score >= 9         ? 'What’s working? What should we double down on?'
          : score >= 7         ? 'What would push your score up by 2?'
          :                      'What would have to change for you to recommend us?'
          }
          rows={4}
          className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
        />
      </div>

      <button
        onClick={submit}
        disabled={score === null || submitting}
        className="w-full mt-8 py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? 'Sending…' : 'Submit'}
      </button>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-6">
      <div className="max-w-md mx-auto pt-6">{children}</div>
    </div>
  )
}
