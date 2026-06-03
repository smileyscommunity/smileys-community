'use client'

import { useState, useMemo } from 'react'
import { toast } from 'sonner'
import { useAdminLoad } from '@/lib/admin/useAdminLoad'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'

// Server caps mirrored here for inline UI validation.
const QUESTION_MAX = 300
const OPTION_MAX   = 200
const MAX_OPTIONS  = 10

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s  = Math.floor(ms / 1000)
  if (s < 60)   return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60)   return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)   return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30)   return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

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
  id:        string
  question:  string
  active:    boolean
  createdAt: string
  updatedAt: string
  options:   PollOption[]
}

export default function PollsPage() {
  const { data, loading, error: loadError, retry: load, setData } = useAdminLoad<Poll[]>(
    '/app/api/admin/community-poll',
    (v): v is Poll[] => Array.isArray(v),
  )
  const polls = data ?? []
  // Functional updater pattern — previously we captured `data` at call
  // time, so rapid back-to-back updates worked off a stale snapshot.
  // useAdminLoad.setData accepts a functional updater, so route through.
  const setPolls = (next: Poll[] | ((prev: Poll[]) => Poll[])) => {
    setData(prev =>
      typeof next === 'function' ? next(prev ?? []) : next,
    )
  }

  const [question,   setQ]        = useState('')
  const [options,    setOpts]     = useState(['', ''])
  const [creating,   setCreating] = useState(false)
  const [error,      setError]    = useState('')
  // Inline-confirm state for delete — replaces window.confirm so a
  // misclick doesn't immediately nuke a poll.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  // Per-poll busy state so rapid clicks on End/Reactivate don't fire
  // multiple PATCHes against the same row.
  const [busyPollId, setBusyPollId] = useState<string | null>(null)

  // Pre-compute validation state for the create form so the Publish
  // button and the inline error reflect what the server would say.
  const filledOptions = useMemo(
    () => options.map(o => o.trim()).filter(Boolean),
    [options],
  )
  const duplicateOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const o of filledOptions) {
      const k = o.toLowerCase()
      if (seen.has(k)) return true
      seen.add(k)
    }
    return false
  }, [filledOptions])
  const canPublish = !creating
                  && !!question.trim()
                  && filledOptions.length >= 2
                  && !duplicateOptions

  function addOption() {
    if (options.length < 10) setOpts(o => [...o, ''])
  }

  function removeOption(i: number) {
    if (options.length <= 2) return
    setOpts(o => o.filter((_, idx) => idx !== i))
  }

  async function createPoll() {
    setError('')
    if (!canPublish) {
      // Mirror what the button-disable state would have said.
      if (!question.trim())          setError('Question is required')
      else if (filledOptions.length < 2) setError('At least 2 options required')
      else if (duplicateOptions)     setError('Options must be unique')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/app/api/admin/community-poll', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, options: filledOptions }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Single source of error feedback — the inline pill below the
        // form. Previously this also fired a toast with the SAME
        // message, so failures briefly flashed twice.
        setError(data?.error ?? 'Failed to create poll')
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
    setBusyPollId(pollId)
    try {
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
      setConfirmDelete(null)
      toast.success('Poll deleted')
    } finally {
      setBusyPollId(null)
    }
  }

  async function toggleActive(pollId: string, active: boolean) {
    setBusyPollId(pollId)
    try {
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
      const now = new Date().toISOString()
      setPolls(p => p.map(poll =>
        poll.id === pollId
          ? { ...poll, active, updatedAt: now }
          : { ...poll, active: active ? false : poll.active, updatedAt: active && poll.active ? now : poll.updatedAt },
      ))
      toast.success(active ? 'Poll reactivated' : 'Poll ended')
    } finally {
      setBusyPollId(null)
    }
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

      <LoadErrorBanner message={loadError} onRetry={load} title="Couldn't load polls" className="mb-6" />

      <div className="space-y-6 max-w-2xl">

        {/* Create new poll */}
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-white">Create new poll</h3>

          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Question</label>
            <input
              value={question}
              onChange={e => setQ(e.target.value)}
              maxLength={QUESTION_MAX}
              placeholder="e.g. What kind of events do you want more of?"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <p className="text-right text-xs text-zinc-600 mt-1">{question.length}/{QUESTION_MAX}</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Options</label>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i}>
                  <div className="flex gap-2">
                    <input
                      value={opt}
                      onChange={e => setOpts(o => o.map((v, idx) => idx === i ? e.target.value : v))}
                      maxLength={OPTION_MAX}
                      placeholder={`Option ${i + 1}`}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    {options.length > 2 && (
                      <button onClick={() => removeOption(i)} className="text-zinc-600 hover:text-red-400 px-2 transition-colors" aria-label={`Remove option ${i + 1}`}>✕</button>
                    )}
                  </div>
                  {opt.length > OPTION_MAX - 20 && (
                    <p className="text-right text-[10px] text-zinc-600 mt-0.5">{opt.length}/{OPTION_MAX}</p>
                  )}
                </div>
              ))}
            </div>
            {options.length < MAX_OPTIONS && (
              <button onClick={addOption} className="mt-2 text-xs text-amber-400 hover:text-amber-300 font-semibold transition-colors">
                + Add option
              </button>
            )}
            {duplicateOptions && (
              <p className="mt-2 text-xs text-amber-400">Some options are duplicates — make each one unique.</p>
            )}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end">
            <button
              onClick={createPoll}
              disabled={!canPublish}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
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
                        disabled={busyPollId === poll.id}
                        className="text-xs font-semibold text-zinc-400 hover:text-white px-3 py-2 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {busyPollId === poll.id ? '…' : poll.active ? 'End' : 'Reactivate'}
                      </button>
                      {confirmDelete === poll.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => deletePoll(poll.id)}
                            disabled={busyPollId === poll.id}
                            className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 px-2 py-2 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {busyPollId === poll.id ? 'Deleting…' : 'Delete?'}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="text-xs font-semibold text-zinc-400 hover:text-white px-2 py-2 rounded-lg hover:bg-white/5 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(poll.id)}
                          className="text-xs font-semibold text-red-500 hover:text-red-400 px-2 py-2 rounded-lg hover:bg-red-500/10 transition-colors"
                          title="Delete poll"
                        >
                          ✕
                        </button>
                      )}
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

                  <p className="text-xs text-zinc-600 mt-3">
                    {total} total vote{total !== 1 ? 's' : ''}
                    {' · Created '}
                    {timeAgo(poll.createdAt)}
                    {poll.updatedAt && poll.updatedAt !== poll.createdAt && (
                      <> · Updated {timeAgo(poll.updatedAt)}</>
                    )}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
