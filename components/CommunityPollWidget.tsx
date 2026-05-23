'use client'

import { useState } from 'react'

interface Option {
  id:      string
  text:    string
  votes:   number
  percent: number
}

interface Poll {
  id:            string
  question:      string
  totalVotes:    number
  votedOptionId: string | null
  options:       Option[]
}

export default function CommunityPollWidget({ initial }: { initial: Poll | null }) {
  const [poll,    setPoll]    = useState<Poll | null>(initial)
  const [voting,  setVoting]  = useState(false)

  if (!poll) return null

  const hasVoted = !!poll.votedOptionId

  async function vote(optionId: string) {
    if (voting || hasVoted) return
    setVoting(true)
    try {
      const res = await fetch('/app/api/community-poll', {
        method:  'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pollId: poll!.id, optionId }),
      })
      if (!res.ok) return
      // Refresh poll data
      const updated = await fetch('/app/api/community-poll', { credentials: 'include' }).then(r => r.json())
      if (updated) setPoll(updated)
    } finally { setVoting(false) }
  }

  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-sm">📊</span>
        <h2 className="text-sm font-bold text-gray-900">Poll of the week</h2>
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
