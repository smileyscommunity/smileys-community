'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Announcement {
  text: string
  link: string
  active: boolean
}

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

// ─── Announcement tab ────────────────────────────────────────────────────────

function AnnouncementTab() {
  const [data, setData]       = useState<Announcement>({ text: '', link: '', active: false })
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/app/api/admin/announcement', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    await fetch('/app/api/admin/announcement', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading) return <div className="text-zinc-500 text-sm p-6">Loading…</div>

  return (
    <div className="max-w-xl space-y-5">
      <p className="text-sm text-zinc-400">
        This banner appears at the top of every page for all logged-in members.
      </p>

      {/* Preview */}
      {data.text && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${data.active ? 'bg-amber-500/15 border border-amber-500/25 text-amber-300' : 'bg-zinc-800 border border-zinc-700 text-zinc-400'}`}>
          <span className={`w-2 h-2 rounded-full shrink-0 ${data.active ? 'bg-amber-500' : 'bg-zinc-600'}`} />
          <span className="flex-1">{data.text}</span>
          {data.link && <span className="text-xs opacity-60 shrink-0">→ {data.link}</span>}
        </div>
      )}

      {/* Fields */}
      <div>
        <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Message</label>
        <input
          value={data.text}
          onChange={e => setData(d => ({ ...d, text: e.target.value }))}
          maxLength={300}
          placeholder="e.g. Our next big event is this Saturday — don't miss it!"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
        <p className="text-right text-xs text-zinc-600 mt-1">{data.text.length}/300</p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Link <span className="text-zinc-600 normal-case font-normal">(optional)</span></label>
        <input
          value={data.link}
          onChange={e => setData(d => ({ ...d, link: e.target.value }))}
          placeholder="/events or https://..."
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
      </div>

      <div className="flex items-center justify-between pt-1">
        <label className="flex items-center gap-3 cursor-pointer">
          <div
            onClick={() => setData(d => ({ ...d, active: !d.active }))}
            className={`w-11 h-6 rounded-full transition-colors relative ${data.active ? 'bg-amber-500' : 'bg-zinc-700'}`}
          >
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${data.active ? 'translate-x-6' : 'translate-x-1'}`} />
          </div>
          <span className="text-sm text-zinc-300">{data.active ? 'Visible to members' : 'Hidden'}</span>
        </label>

        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ─── Polls tab ───────────────────────────────────────────────────────────────

function PollsTab() {
  const [polls, setPolls]     = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)
  const [question, setQ]      = useState('')
  const [options, setOpts]    = useState(['', ''])
  const [creating, setCreating] = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    fetch('/app/api/admin/community-poll', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setPolls(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false))
  }, [])

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
    const res = await fetch('/app/api/admin/community-poll', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, options: filled }),
    })
    const data = await res.json()
    if (res.ok) {
      setPolls(p => [data, ...p.map(pp => ({ ...pp, active: false }))])
      setQ('')
      setOpts(['', ''])
    } else {
      setError(data.error || 'Failed to create poll')
    }
    setCreating(false)
  }

  async function deletePoll(pollId: string) {
    if (!confirm('Delete this poll? This cannot be undone.')) return
    const res = await fetch('/app/api/admin/community-poll', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pollId }),
    })
    if (res.ok) setPolls(p => p.filter(poll => poll.id !== pollId))
  }

  async function toggleActive(pollId: string, active: boolean) {
    await fetch('/app/api/admin/community-poll', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pollId, active }),
    })
    setPolls(p => p.map(poll =>
      poll.id === pollId ? { ...poll, active } : { ...poll, active: active ? false : poll.active }
    ))
  }

  const totalVotes = (poll: Poll) => poll.options.reduce((s, o) => s + o._count.votes, 0)

  return (
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
        <div className="text-zinc-500 text-sm">Loading polls…</div>
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
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'announcement' | 'polls'

function EngagementInner() {
  const searchParams  = useSearchParams()
  const [tab, setTab] = useState<Tab>('announcement')

  useEffect(() => {
    const t = searchParams.get('tab') as Tab
    if (t === 'announcement' || t === 'polls') setTab(t)
    else setTab('announcement')
  }, [searchParams])

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">{tab === 'polls' ? 'Polls' : 'Announcements'}</h1>
      </div>
      {tab === 'polls' ? <PollsTab /> : <AnnouncementTab />}
    </div>
  )
}

export default function EngagementPage() {
  return (
    <Suspense>
      <EngagementInner />
    </Suspense>
  )
}
