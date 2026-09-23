'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { applyOptimisticVote, type PollState as Poll } from '@/lib/pollOptimistic'

export default function CommunityPollWidget({ initial }: { initial: Poll | null }) {
  const [poll,    setPoll]    = useState<Poll | null>(initial)
  const [voting,  setVoting]  = useState(false)

  if (!poll) return null

  const hasVoted = !!poll.votedOptionId

  // The vote shows at once; if the server refuses it (closed poll, rate
  // limit, lost connection) the member is told why and the poll goes back to
  // votable. It used to fail silently, leaving "Tap to vote" under a tap that
  // had done nothing.
  async function vote(optionId: string) {
    if (voting || hasVoted || !poll) return
    const before = poll
    setVoting(true)
    setPoll(applyOptimisticVote(before, optionId))
    try {
      const res = await fetch('/app/api/community-poll', {
        method:  'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pollId: before.id, optionId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? "Couldn't record your vote")
        setPoll(before)
        return
      }
      // Swap the local guess for the real tallies. A failed refresh keeps the
      // guess — the vote itself went through.
      const updated = await fetch('/app/api/community-poll', { credentials: 'include' })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
      if (updated) setPoll(updated)
    } catch {
      toast.error('Something went wrong — check your connection')
      setPoll(before)
    } finally { setVoting(false) }
  }

  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-sm">📊</span>
        {/* Not "of the week": the query takes the newest ACTIVE poll with no
            closing date and no rotation, and the live one has been up since
            May — nineteen weeks of calling it weekly. The heading now says
            what it is rather than promising a cadence nothing enforces. */}
        <h2 className="text-sm font-bold text-gray-900">Community poll</h2>
      </div>

      <p className="text-sm font-semibold text-gray-800 leading-snug mb-3">{poll.question}</p>

      <div className="space-y-2">
        {poll.options.map(opt => {
          const isVoted = poll.votedOptionId === opt.id
          return (
            <button
              key={opt.id}
              onClick={() => vote(opt.id)}
              disabled={hasVoted || voting}
              className={`w-full text-left rounded-xl overflow-hidden relative transition-all ${
                hasVoted ? 'cursor-default' : 'hover:opacity-90 cursor-pointer'
              }`}
            >
              {/* Background fill */}
              {hasVoted && (
                <div
                  className={`absolute inset-y-0 left-0 rounded-xl transition-all duration-700 ${
                    isVoted ? 'bg-amber-200' : 'bg-gray-100'
                  }`}
                  style={{ width: `${opt.percent}%` }}
                />
              )}

              <div className={`relative flex items-center justify-between px-3 py-2 rounded-xl border text-sm ${
                hasVoted
                  ? isVoted
                    ? 'border-amber-400 bg-amber-50/50'
                    : 'border-gray-200 bg-gray-50/50'
                  : 'border-gray-200 bg-gray-50 hover:border-amber-300'
              }`}>
                <span className={`font-medium leading-snug ${isVoted ? 'text-amber-800' : 'text-gray-700'}`}>
                  {isVoted && <span className="mr-1">✓</span>}
                  {opt.text}
                </span>
                {hasVoted && (
                  <span className={`text-xs font-bold shrink-0 ml-2 ${isVoted ? 'text-amber-700' : 'text-gray-400'}`}>
                    {opt.percent}%
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        {poll.totalVotes} vote{poll.totalVotes !== 1 ? 's' : ''}
        {!hasVoted && ' · Tap to vote'}
      </p>
    </div>
  )
}
