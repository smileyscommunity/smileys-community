'use client'

import { useState, useEffect } from 'react'
import { resolveImageUrl } from '@/lib/data'
import { toast } from 'sonner'

interface Announcement { text: string; link: string; active: boolean }
interface PollOption { id: string; text: string; _count: { votes: number } }
interface Poll { id: string; question: string; active: boolean; createdAt: string; options: PollOption[] }

interface User {
  id: string
  name: string
  email: string
  color: string
  profilePhoto: string | null
  neighborhood: string | null
}

interface Spotlight {
  user:      { id: string; name: string; color: string; profilePhoto: string | null; neighborhood: string | null }
  funFact:   string
  topSpots:  string[]
  updatedAt: string | null
}

function Avatar({ user }: { user: Pick<User, 'name' | 'color' | 'profilePhoto'> }) {
  const initials = user.name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return user.profilePhoto ? (
    <img src={resolveImageUrl(user.profilePhoto)} alt={user.name}
      className="w-10 h-10 rounded-full object-cover shrink-0" />
  ) : (
    <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-white text-sm font-bold"
      style={{ backgroundColor: user.color }}>
      {initials}
    </div>
  )
}

export default function SpotlightPage() {
  const [current,   setCurrent]   = useState<Spotlight | null>(null)
  const [search,    setSearch]    = useState('')
  const [results,   setResults]   = useState<User[]>([])
  const [selected,  setSelected]  = useState<User | null>(null)
  const [funFact,   setFunFact]   = useState('')
  const [topSpots,  setTopSpots]  = useState(['', '', ''])
  const [searching,    setSearching]    = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [announcement, setAnnouncement] = useState<Announcement>({ text: '', link: '', active: false })
  const [savingAnn,    setSavingAnn]    = useState(false)
  const [polls,        setPolls]        = useState<Poll[]>([])
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions,  setPollOptions]  = useState(['', '', '', ''])
  const [savingPoll,   setSavingPoll]   = useState(false)

  useEffect(() => {
    fetch('/app/api/admin/spotlight', { credentials: 'include' })
      .then(r => r.json()).then(d => { if (d) setCurrent(d) }).catch(() => {})
    fetch('/app/api/admin/announcement', { credentials: 'include' })
      .then(r => r.json()).then(d => { if (d) setAnnouncement(d) }).catch(() => {})
    fetch('/app/api/admin/community-poll', { credentials: 'include' })
      .then(r => r.json()).then(d => { if (Array.isArray(d)) setPolls(d) }).catch(() => {})
  }, [])

  async function handleSearch() {
    if (!search.trim()) return
    setSearching(true)
    try {
      const res  = await fetch(`/app/api/admin/users?search=${encodeURIComponent(search)}`, { credentials: 'include' })
      const data = await res.json()
      setResults(Array.isArray(data) ? data.slice(0, 8) : [])
    } finally { setSearching(false) }
  }

  function selectUser(u: User) {
    setSelected(u)
    setResults([])
    setSearch('')
  }

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    try {
      const res = await fetch('/app/api/admin/spotlight', {
        method:  'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userId: selected.id, funFact, topSpots }),
      })
      if (!res.ok) throw new Error()
      toast.success('Spotlight updated!')
      // Refresh current
      const updated = await fetch('/app/api/admin/spotlight', { credentials: 'include' }).then(r => r.json())
      if (updated) setCurrent(updated)
      setSelected(null)
      setFunFact('')
      setTopSpots(['', '', ''])
    } catch {
      toast.error('Failed to update spotlight')
    } finally { setSaving(false) }
  }

  function prefillFromCurrent() {
    if (!current) return
    setSelected({
      id:           current.user.id,
      name:         current.user.name,
      email:        '',
      color:        current.user.color,
      profilePhoto: current.user.profilePhoto,
      neighborhood: current.user.neighborhood,
    })
    setFunFact(current.funFact)
    setTopSpots(current.topSpots.length === 3 ? current.topSpots : ['', '', ''])
  }

  async function savePoll() {
    const filled = pollOptions.filter(o => o.trim())
    if (!pollQuestion.trim() || filled.length < 2) {
      toast.error('Add a question and at least 2 options')
      return
    }
    setSavingPoll(true)
    try {
      const res = await fetch('/app/api/admin/community-poll', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: pollQuestion, options: filled }),
      })
      if (!res.ok) throw new Error()
      toast.success('Poll published!')
      setPollQuestion('')
      setPollOptions(['', '', '', ''])
      const updated = await fetch('/app/api/admin/community-poll', { credentials: 'include' }).then(r => r.json())
      if (Array.isArray(updated)) setPolls(updated)
    } catch { toast.error('Failed to save poll') }
    finally { setSavingPoll(false) }
  }

  async function togglePoll(pollId: string, active: boolean) {
    await fetch('/app/api/admin/community-poll', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pollId, active }),
    })
    const updated = await fetch('/app/api/admin/community-poll', { credentials: 'include' }).then(r => r.json())
    if (Array.isArray(updated)) setPolls(updated)
  }

  async function saveAnnouncement() {
    setSavingAnn(true)
    try {
      const res = await fetch('/app/api/admin/announcement', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(announcement),
      })
      if (!res.ok) throw new Error()
      toast.success(announcement.active ? 'Announcement published!' : 'Announcement hidden')
    } catch { toast.error('Failed to save') }
    finally { setSavingAnn(false) }
  }

  const inputCls = 'w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500'

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-white">Spotlight & Announcements</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Manage the member spotlight, announcement banner, and community poll.</p>
      </div>

      {/* Announcement banner */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-4">
        <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Community announcement</h2>
        <p className="text-xs text-zinc-500">Shows as a closable banner on the dashboard.</p>
        <div>
          <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wide mb-1.5">Message</label>
          <input type="text" value={announcement.text} maxLength={120}
            onChange={e => setAnnouncement(a => ({ ...a, text: e.target.value }))}
            placeholder="e.g. New Club: Chess & Coffee is now live! ♟️"
            className={inputCls} />
          <p className="text-xs text-zinc-600 text-right mt-1">{announcement.text.length}/120</p>
        </div>
        <div>
          <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wide mb-1.5">Link <span className="font-normal text-zinc-600">(optional)</span></label>
          <input type="text" value={announcement.link}
            onChange={e => setAnnouncement(a => ({ ...a, link: e.target.value }))}
            placeholder="/clubs/chess-coffee"
            className={inputCls} />
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
          <label className="flex items-center gap-2 cursor-pointer" onClick={() => setAnnouncement(a => ({ ...a, active: !a.active }))}>
            <div className={`relative w-10 h-5 rounded-full transition-colors ${announcement.active ? 'bg-amber-500' : 'bg-zinc-700'}`}>
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${announcement.active ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
            <span className={`text-sm font-medium ${announcement.active ? 'text-amber-400' : 'text-zinc-500'}`}>{announcement.active ? 'Visible' : 'Hidden'}</span>
          </label>
          <button onClick={saveAnnouncement} disabled={savingAnn || !announcement.text.trim()}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm disabled:opacity-40 transition-colors">
            {savingAnn ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Poll of the week */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-5">
        <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Poll of the week</h2>

        {polls.length > 0 && (
          <div className="space-y-3">
            {polls.map(poll => {
              const total = poll.options.reduce((s, o) => s + o._count.votes, 0)
              return (
                <div key={poll.id} className={`border rounded-xl p-4 ${poll.active ? 'border-amber-500/30 bg-amber-500/5' : 'border-zinc-700'}`}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-sm font-semibold text-white">{poll.question}</p>
                    <button onClick={() => togglePoll(poll.id, !poll.active)}
                      className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full transition-colors ${
                        poll.active ? 'bg-amber-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-amber-500/10 hover:text-amber-400'
                      }`}>
                      {poll.active ? 'Active' : 'Set active'}
                    </button>
                  </div>
                  <div className="space-y-1">
                    {poll.options.map(o => (
                      <div key={o.id} className="flex items-center justify-between text-xs text-zinc-400">
                        <span>{o.text}</span>
                        <span className="font-semibold">{o._count.votes} votes {total > 0 ? `(${Math.round(o._count.votes / total * 100)}%)` : ''}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-zinc-600 mt-2">{total} total votes · {new Date(poll.createdAt).toLocaleDateString('en-GB')}</p>
                </div>
              )
            })}
          </div>
        )}

        <div className="space-y-3 pt-2 border-t border-zinc-800">
          <p className="text-xs text-zinc-500">Create new poll — replaces the current active one</p>
          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wide mb-1.5">Question</label>
            <input type="text" value={pollQuestion} onChange={e => setPollQuestion(e.target.value)}
              placeholder="e.g. Best neighborhood for brunch?" maxLength={150} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wide mb-1.5">Options <span className="font-normal text-zinc-600">(min 2)</span></label>
            <div className="space-y-2">
              {pollOptions.map((opt, i) => (
                <input key={i} type="text" value={opt}
                  onChange={e => setPollOptions(o => o.map((v, j) => j === i ? e.target.value : v))}
                  placeholder={`Option ${i + 1}`} maxLength={80} className={inputCls} />
              ))}
            </div>
          </div>
          <button onClick={savePoll} disabled={savingPoll}
            className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm disabled:opacity-40 transition-colors">
            {savingPoll ? 'Publishing…' : 'Publish poll'}
          </button>
        </div>
      </div>

      {/* Current spotlight */}
      {current && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Current spotlight</h2>
            <button onClick={prefillFromCurrent} className="text-xs text-amber-400 font-semibold hover:text-amber-300">Edit →</button>
          </div>
          <div className="flex items-center gap-4 mb-4">
            <Avatar user={current.user} />
            <div>
              <p className="font-bold text-white">{current.user.name}</p>
              {current.user.neighborhood && <p className="text-xs text-zinc-500">📍 {current.user.neighborhood}</p>}
              {current.updatedAt && (
                <p className="text-xs text-zinc-600 mt-0.5">
                  Set {new Date(current.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              )}
            </div>
          </div>
          {current.funFact && <p className="text-sm text-zinc-400 italic mb-3">"{current.funFact}"</p>}
          {current.topSpots.some(s => s) && (
            <div className="space-y-1">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-1">Top Istanbul spots</p>
              {current.topSpots.filter(s => s).map((spot, i) => (
                <p key={i} className="text-sm text-zinc-300"><span className="text-amber-500 font-bold">{i + 1}.</span> {spot}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Set new spotlight */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 space-y-5">
        <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
          {current ? 'Change spotlight member' : 'Set spotlight member'}
        </h2>

        <div>
          <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wide mb-1.5">Search member</label>
          <div className="flex gap-2">
            <input type="text" value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search by name or email…"
              className={`flex-1 ${inputCls}`} />
            <button onClick={handleSearch} disabled={searching || !search.trim()}
              className="px-4 py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-semibold disabled:opacity-40 transition-colors">
              {searching ? '…' : 'Search'}
            </button>
          </div>
          {results.length > 0 && (
            <div className="mt-2 border border-zinc-700 rounded-xl overflow-hidden divide-y divide-zinc-800">
              {results.map(u => (
                <button key={u.id} onClick={() => selectUser(u)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 transition-colors text-left">
                  <Avatar user={u} />
                  <div>
                    <p className="text-sm font-semibold text-white">{u.name}</p>
                    <p className="text-xs text-zinc-500">{u.email}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <div className="flex items-center gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <Avatar user={selected} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate">{selected.name}</p>
              {selected.neighborhood && <p className="text-xs text-zinc-400">📍 {selected.neighborhood}</p>}
            </div>
            <button onClick={() => setSelected(null)} className="text-zinc-500 hover:text-white text-lg leading-none">×</button>
          </div>
        )}

        <div>
          <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wide mb-1.5">Fun fact</label>
          <textarea value={funFact} onChange={e => setFunFact(e.target.value)}
            placeholder="A fun or interesting fact about this member…"
            rows={3} maxLength={200}
            className={`${inputCls} resize-none`} />
          <p className="text-xs text-zinc-600 text-right mt-1">{funFact.length}/200</p>
        </div>

        <div>
          <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wide mb-1.5">Top 3 Istanbul spots</label>
          <div className="space-y-2">
            {topSpots.map((spot, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-amber-500 font-bold text-sm w-4">{i + 1}.</span>
                <input type="text" value={spot}
                  onChange={e => setTopSpots(s => s.map((v, j) => j === i ? e.target.value : v))}
                  placeholder={`Spot ${i + 1} (e.g. Karaköy Lokantası)`} maxLength={80}
                  className={`flex-1 ${inputCls}`} />
              </div>
            ))}
          </div>
        </div>

        <button onClick={handleSave} disabled={saving || !selected}
          className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm disabled:opacity-40 transition-colors">
          {saving ? 'Saving…' : current ? 'Update spotlight' : 'Set spotlight'}
        </button>
      </div>
    </div>
  )
}
