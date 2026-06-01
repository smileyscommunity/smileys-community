'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'

// Polls live on /admin/polls and the announcement banner lives
// on /admin/announcements. Both used to share /admin/announcements
// behind a ?tab= query param, which left the tab nav visible
// from both sidebar entries and made it look like polls were
// part of the announcements page (and vice versa). Each surface
// now has its own focused route.

interface PollOption {
  id: string
  text: string
  order: number
  _count: { votes: number }
}

interface Poll {
  id: string
  question: string
  active: boolean
  createdAt: string
  options: PollOption[]
}

export default function PollsPage() {
  const [polls, setPolls]       = useState<Poll[]>([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [question, setQ]        = useState('')
  const [options, setOpts]      = useState(['', ''])
  const [creating, setCreating] = useState(false)
  const [error, setError]       = useState('')

  function load() {
    setLoading(true)
    setLoadError(null)
    fetch('/app/api/admin/community-poll', { credentials: 'include' })
      .then(async r => {
        if (!r.ok) {
          const text = await r.text().catch(() => '')
          throw new Error(`${r.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
        }
        return r.json()
      })
      .then(d => setPolls(Array.isArray(d) ? d : []))
      .catch((e: Error) => setLoadError(e?.message ?? 'Failed to load'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  function addOption() {
    if (options.length < 10) setOpts(o => [...o, ''])
  }

  function removeOption(i: number) {
    if (options.length <= 2) return
    setOpts(o => o.filter((_, idx) => idx !== i))
  }

  async function createPoll() {
    setError('')
    if (!question.trim()) { setError('Question is required'); return }
    const filled = options.filter(o => o.trim())
    if (filled.length < 2) { setError('At least 2 options required'); return }
    setCreating(true)
    try {
      const res = await fetch('/app/api/admin/community-poll', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, options: filled }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Inline error pill stays for validation-shaped messages
        // (useful inside the form); toast covers server-side
        // failures so the feedback isn't trapped inside the panel.
        setError(data.error || 'Failed to create poll')
        toast.error(data?.error ?? 'Failed to create poll')
        return
      }
      setPolls(p => [data, ...p.map(pp => ({ ...pp, active: false }))])
      setQ('')
      setOpts(['', ''])
      toast.success('Poll published')
    } finally {
      setCreating(false)
    }
  }

  async function deletePoll(pollId: string) {
    if (!confirm('Delete this poll? This cannot be undone.')) return
    const res = await fetch('/app/api/admin/community-poll', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pollId }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error(d?.error ?? 'Failed to delete poll')
      return
    }
    setPolls(p => p.filter(poll => poll.id !== pollId))
    toast.success('Poll deleted')
  }

  async function toggleActive(pollId: string, active: boolean) {
    const res = await fetch('/app/api/admin/community-poll', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pollId, active }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error(d?.error ?? 'Failed to toggle poll')
      return
    }
    setPolls(p => p.map(poll =>
      poll.id === pollId ? { ...poll, active } : { ...poll, active: active ? false : poll.active }
    ))
    toast.success(active ? 'Poll reactivated' : 'Poll ended')
  }

  const totalVotes = (poll: Poll) => poll.options.reduce((s, o) => s + o._count.votes, 0)

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Polls</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Member-facing polls — collect feedback on what to program next.
        </p>
      </div>

      {/* Load error banner */}
      {loadError && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-300">Couldn&apos;t load polls</p>
            <p className="text-xs text-red-400/80 mt-1 break-all">{loadError}</p>
          </div>
          <button onClick={load}
            className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 font-semibold shrink-0">
            Retry
          </button>
        </div>
      )}

      <div className="space-y-6 max-w-2xl">

        {/* Create new poll */}
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-white">Create new poll</h3>

          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Question</label>
            <input
              value={question}
              onChange={e => setQ(e.target.value)}
              maxLength={300}
              placeholder="e.g. What kind of events do you want more of?"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Options</label>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={opt}
                    onChange={e => setOpts(o => o.map((v, idx) => idx === i ? e.target.value : v))}
                    maxLength={200}
                    placeholder={`Option ${i + 1}`}
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  {options.length > 2 && (
                    <button onClick={() => removeOption(i)} className="text-zinc-600 hover:text-red-400 px-2 transition-colors">✕</button>
                  )}
                </div>
              ))}
            </div>
            {options.length < 10 && (
              <button onClick={addOption} className="mt-2 text-xs text-amber-400 hover:text-amber-300 font-semibold transition-colors">
                + Add option
              </button>
            )}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end">
            <button
              onClick={createPoll}
              disabled={creating}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {creating ? 'Creating…' : 'Publish poll'}
            </button>
          </div>
        </div>

        {/* Existing polls */}
        {loading ? (
          // Page-shape skeleton matching the eventual row layout.
          <div className="space-y-3">
            <div className="h-3 w-32 rounded bg-zinc-800/60 animate-pulse" />
            {[0, 1].map(i => (
              <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="h-4 w-2/3 rounded bg-zinc-800 animate-pulse" />
                  <div className="flex gap-2">
                    <div className="h-6 w-12 rounded-lg bg-zinc-800 animate-pulse" />
                    <div className="h-6 w-16 rounded-lg bg-zinc-800 animate-pulse" />
                  </div>
                </div>
                {[0, 1, 2].map(j => (
                  <div key={j} className="h-3 w-full rounded bg-zinc-800/60 animate-pulse" />
                ))}
              </div>
            ))}
          </div>
        ) : polls.length === 0 ? (
          <p className="text-zinc-500 text-sm">No polls created yet.</p>
        ) : (
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Previous polls</h3>
            {polls.map(poll => {
              const total = totalVotes(poll)
              return (
                <div key={poll.id} className={`rounded-2xl border p-5 ${poll.active ? 'border-amber-500/30 bg-amber-500/5' : 'border-zinc-800 bg-zinc-900'}`}>
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <p className="text-sm font-semibold text-white leading-snug">{poll.question}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-bold px-2 py-1 rounded-lg uppercase tracking-wide ${poll.active ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800 text-zinc-500'}`}>
                        {poll.active ? 'Live' : 'Ended'}
                      </span>
                      <button
                        onClick={() => toggleActive(poll.id, !poll.active)}
                        className="text-xs font-semibold text-zinc-400 hover:text-white px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
                      >
                        {poll.active ? 'End' : 'Reactivate'}
                      </button>
                      <button
                        onClick={() => deletePoll(poll.id)}
                        className="text-xs font-semibold text-red-500 hover:text-red-400 px-2 py-2 rounded-lg hover:bg-red-500/10 transition-colors"
                        title="Delete poll"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {poll.options.map(opt => {
                      const pct = total > 0 ? Math.round((opt._count.votes / total) * 100) : 0
                      return (
                        <div key={opt.id}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-zinc-300">{opt.text}</span>
                            <span className="text-zinc-500">{opt._count.votes} vote{opt._count.votes !== 1 ? 's' : ''} · {pct}%</span>
                          </div>
                          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <p className="text-xs text-zinc-600 mt-3">{total} total vote{total !== 1 ? 's' : ''} · Created {new Date(poll.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
