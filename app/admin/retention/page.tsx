'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

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
  const [nudge, setNudge]       = useState('')

  async function draftNudge() {
    setDrafting(true)
    const res = await fetch('/app/api/admin/users/reengage', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: m.id }),
    })
    const data = await res.json()
    if (data.message) setNudge(data.message)
    setDrafting(false)
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
            disabled={drafting}
            className="text-xs text-amber-400 hover:text-amber-300 font-semibold px-2.5 py-2 rounded-lg hover:bg-amber-500/10 transition-colors disabled:opacity-50"
          >
            {drafting ? '…' : '✦ Nudge'}
          </button>
        </div>
      </div>

      {nudge && (
        <div className="mt-3 ml-11 p-3 bg-zinc-800 rounded-xl border border-zinc-700 text-xs text-zinc-300 leading-relaxed">
          {nudge}
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

  useEffect(() => {
    fetch('/app/api/admin/retention', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Member Retention</h1>
        <p className="text-zinc-400 text-sm mt-1">Identify members who may need a nudge to get engaged.</p>
      </div>

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
          <div className="p-12 text-center text-zinc-500">Failed to load retention data.</div>
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
