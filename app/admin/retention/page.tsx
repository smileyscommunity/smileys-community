'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { loadFailure } from '@/lib/admin/useAdminLoad'

interface Member {
  id: string; name: string; email: string; color: string
  neighborhood: string | null; interests?: string[]; joinedAt?: string
  lastEventDate?: string; eventCount?: number
}

interface RetentionData {
  neverAttended: Member[]
  dormant: Member[]
  stats: { neverAttendedCount: number; dormantCount: number }
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const d = Math.floor(diff / 86400000)
  if (d < 30) return `${d}d ago`
  if (d < 365) return `${Math.floor(d / 30)}mo ago`
  return `${Math.floor(d / 365)}y ago`
}

function Avatar({ m }: { m: Member }) {
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
      style={{ backgroundColor: m.color }}>
      {m.name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
    </div>
  )
}

function MemberRow({ m, sub }: { m: Member; sub: string }) {
  const [drafting, setDrafting] = useState(false)
  const [sending,  setSending]  = useState(false)
  const [sent,     setSent]     = useState(false)
  const [nudge,    setNudge]    = useState('')
  const [error,    setError]    = useState<string | null>(null)

  async function draftNudge() {
    setError(null); setSent(false); setDrafting(true)
    try {
      const res = await fetch('/app/api/admin/users/reengage', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: m.id }),
      })
      const data = await res.json()
      if (!res.ok) setError(data?.error ?? 'Could not draft')
      else if (data.message) setNudge(data.message)
    } finally {
      setDrafting(false)
    }
  }

  // Send the drafted message via the same _reengage PATCH used elsewhere.
  // Without this button the drafted message had no way out — Nudge looked
  // broken because clicking it produced a read-only block of text.
  async function sendNudge() {
    if (!nudge.trim()) return
    setError(null); setSending(true)
    try {
      const res = await fetch(`/app/api/admin/users/${m.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _reengage: nudge }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d?.error ?? 'Could not send')
        return
      }
      setSent(true); setNudge('')
      setTimeout(() => setSent(false), 4000)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="px-5 py-4 hover:bg-zinc-800/30 transition-colors">
      <div className="flex items-center gap-3">
        <Avatar m={m} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/admin/users/${m.id}`} className="text-sm font-semibold text-zinc-200 hover:text-amber-400 transition-colors">
              {m.name}
            </Link>
            {m.neighborhood && (
              <span className="text-xs text-zinc-500">{m.neighborhood}</span>
            )}
            {sent && <span className="text-[10px] font-bold text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">✓ Sent</span>}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a href={`mailto:${m.email}`}
            className="text-xs text-zinc-500 hover:text-zinc-200 px-2.5 py-2 rounded-lg hover:bg-zinc-700 transition-colors">
            Email
          </a>
          <button
            onClick={draftNudge}
            disabled={drafting || sending}
            className="text-xs text-amber-400 hover:text-amber-300 font-semibold px-2.5 py-2 rounded-lg hover:bg-amber-500/10 transition-colors disabled:opacity-50"
          >
            {drafting ? '…' : nudge ? '✦ Redraft' : '✦ Nudge'}
          </button>
        </div>
      </div>

      {(nudge || error) && (
        <div className="mt-3 ml-11 space-y-2">
          {nudge && (
            <textarea
              value={nudge}
              onChange={e => setNudge(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-xs bg-zinc-800 border border-violet-500/30 rounded-xl text-zinc-200 resize-none focus:outline-none focus:ring-1 focus:ring-violet-500/50 leading-relaxed"
            />
          )}
          {error && <p className="text-xs text-red-400">⚠ {error}</p>}
          {nudge && (
            <button
              onClick={sendNudge}
              disabled={sending || !nudge.trim()}
              className="w-full py-2 text-xs font-semibold bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white rounded-xl transition-colors"
            >
              {sending ? 'Sending…' : 'Send notification'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

type Tab = 'never' | 'dormant'

export default function RetentionPage() {
  const [data, setData]     = useState<RetentionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]       = useState<Tab>('never')
  // This is a moderator page: a 403 (moderator with no city) used to render
  // "Failed to load retention data." with no reason and no way back.
  const [loadError, setLoadError]   = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    fetch('/app/api/admin/retention', { credentials: 'include' })
      .then(async r => { if (!r.ok) throw await loadFailure(r); return r.json() })
      .then(d => setData(d))
      .catch((e: Error) => { setData(null); setLoadError(e?.message ?? 'Failed to load') })
      .finally(() => setLoading(false))
  }, [reloadTick])

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Member Retention</h1>
        <p className="text-zinc-400 text-sm mt-1">Identify members who may need a nudge to get engaged.</p>
      </div>

      <LoadErrorBanner message={loadError} onRetry={() => setReloadTick(n => n + 1)} title="Couldn't load retention" className="mb-6" />

      {/* Stats */}
      {data && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className={`rounded-2xl p-5 border cursor-pointer transition-colors ${tab === 'never' ? 'bg-amber-500/10 border-amber-500/30' : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'}`}
            onClick={() => setTab('never')}>
            <p className="text-xs text-zinc-500 font-medium mb-1">Never attended</p>
            <p className="text-3xl font-extrabold text-white">{data.stats.neverAttendedCount}</p>
            <p className="text-xs text-zinc-500 mt-1">Approved &gt;7 days, 0 events</p>
          </div>
          <div className={`rounded-2xl p-5 border cursor-pointer transition-colors ${tab === 'dormant' ? 'bg-amber-500/10 border-amber-500/30' : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'}`}
            onClick={() => setTab('dormant')}>
            <p className="text-xs text-zinc-500 font-medium mb-1">Dormant</p>
            <p className="text-3xl font-extrabold text-white">{data.stats.dormantCount}</p>
            <p className="text-xs text-zinc-500 mt-1">No events in 60+ days</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-800 mb-0">
        {([
          { id: 'never',   label: `Never attended${data ? ` (${data.stats.neverAttendedCount})` : ''}` },
          { id: 'dormant', label: `Dormant${data ? ` (${data.stats.dormantCount})` : ''}` },
        ] as { id: Tab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
              tab === t.id ? 'border-amber-500 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Members list */}
      <div className="bg-zinc-900 border border-zinc-800 border-t-0 rounded-b-2xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-zinc-500">Loading…</div>
        ) : !data ? (
          <div className="p-12 text-center text-zinc-500">{loadError ? 'Could not load — see above.' : 'Failed to load retention data.'}</div>
        ) : tab === 'never' ? (
          data.neverAttended.length === 0 ? (
            <div className="p-12 text-center text-zinc-500">
              <p className="text-2xl mb-2">🎉</p>
              <p>All members have attended at least one event!</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/60">
              {data.neverAttended.map(m => (
                <MemberRow
                  key={m.id}
                  m={m}
                  sub={`Joined ${timeAgo(m.joinedAt!)} · ${m.interests?.slice(0, 3).join(', ') || 'No interests set'}`}
                />
              ))}
            </div>
          )
        ) : (
          data.dormant.length === 0 ? (
            <div className="p-12 text-center text-zinc-500">
              <p className="text-2xl mb-2">🎉</p>
              <p>No dormant members right now!</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/60">
              {data.dormant.map(m => (
                <MemberRow
                  key={m.id}
                  m={m}
                  sub={`Last event ${timeAgo(m.lastEventDate!)} · ${m.eventCount} event${m.eventCount !== 1 ? 's' : ''} total`}
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
