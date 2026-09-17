'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { confirmToast } from '@/lib/confirmToast'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { loadFailure } from '@/lib/admin/useAdminLoad'
import { useAuth } from '@/contexts/AuthContext'
import { REVIEW_CONFLICT_MESSAGE, type ReviewConflict } from '@/lib/noShowPolicy'

// Standing, admin side. The inbox is disputes: a member said "I was there".
// Overturn removes the offence (and withdraws a card built on it); uphold
// keeps it. Red cards whose commitments are done wait for an admin's review.
// The switch at the top decides whether any of this reaches members — until
// it is on, everything below is shadow data, to read before deciding.

type View = 'disputes' | 'review' | 'cards' | 'offences'
interface UserRef  { id: string; name: string; email?: string | null }
interface EventRef { id: string; title: string; emoji: string; date: string }
interface OffenceRow {
  id: string; kind: string; tier: string; counts: boolean; loggedReason: string | null; status: string
  occurredAt: string; recordedAt: string; disputeNote: string | null; disputedAt: string | null; resolutionNote: string | null
  user: UserRef; event: EventRef; conflict?: ReviewConflict | null
}
interface CardRow {
  id: string; level: 'yellow' | 'red'; status: string; shadow: boolean; issuedAt: string; triggeredAt: string
  resolutionNote: string | null; recoveries: number; user: UserRef
  offences: { id: string; kind: string; event: EventRef }[]
  conflict?: ReviewConflict | null
}
interface Overview {
  enforced: boolean; since: string | null
  stats: { offences30: number; counting30: number; disputed: number; liveYellow: number; liveRed: number; shadowLive: number; autoResolved30: number; forgiven30: number }
}

const VIEWS: { key: View; label: string }[] = [
  { key: 'disputes', label: 'Disputes' },
  { key: 'review',   label: 'Red cards' },
  { key: 'cards',    label: 'Live cards' },
  { key: 'offences', label: 'Offences' },
]
const KIND: Record<string, string> = { no_show: 'No-show', late_cancel: 'Late cancel' }
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export default function AdminStandingPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [view,      setView]      = useState<View>('disputes')
  const [items,     setItems]     = useState<(OffenceRow | CardRow)[] | null>(null)
  const [overview,  setOverview]  = useState<Overview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notes,     setNotes]     = useState<Record<string, string>>({})
  const [busy,      setBusy]      = useState<string | null>(null)

  const load = useCallback(() => {
    setItems(null); setLoadError(null)
    fetch(`/app/api/admin/standing?view=${view}`, { credentials: 'include' })
      .then(async r => { if (!r.ok) throw await loadFailure(r); return r.json() })
      .then(d => setItems(d.items ?? []))
      .catch((e: Error) => setLoadError(e?.message ?? 'Failed to load'))
    fetch('/app/api/admin/standing/enforcement', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setOverview(d) })
      .catch(() => {})
  }, [view])
  useEffect(() => { load() }, [load])

  async function post(url: string, body: object, success: string, key: string) {
    setBusy(key)
    try {
      const res  = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? `Failed (HTTP ${res.status})`); return false }
      toast.success(success)
      load()
      return true
    } catch {
      toast.error('No connection — nothing changed.')
      return false
    } finally {
      setBusy(null)
    }
  }

  async function decide(o: OffenceRow, decision: 'overturn' | 'uphold') {
    const ok = await confirmToast(decision === 'overturn'
      ? `Overturn ${o.user.name}'s ${KIND[o.kind]?.toLowerCase() ?? 'offence'} at "${o.event.title}"? Any card built on it is withdrawn.`
      : `Keep ${o.user.name}'s ${KIND[o.kind]?.toLowerCase() ?? 'offence'} at "${o.event.title}" on the record?`,
      { confirmLabel: decision === 'overturn' ? 'Overturn' : 'Uphold' })
    if (!ok) return
    await post(`/app/api/admin/standing/offences/${o.id}`, { decision, note: notes[o.id] ?? '' },
      decision === 'overturn' ? 'Overturned' : 'Upheld', o.id)
  }

  async function restore(c: CardRow) {
    if (!await confirmToast(`Restore ${c.user.name}'s standing? The red card closes.`, { confirmLabel: 'Restore' })) return
    await post(`/app/api/admin/standing/cards/${c.id}`, { action: 'restore', note: notes[c.id] ?? '' }, 'Standing restored', c.id)
  }

  async function toggle(on: boolean) {
    const ok = await confirmToast(on
      ? 'Switch standing on? Members start seeing cards and notifications, red cards need host approval at limited events, and carded members join limited waitlists at the back. Shadow cards are retired and the count starts fresh.'
      : 'Switch standing off? Effects and notifications pause; cards keep their state.',
      { confirmLabel: on ? 'Switch on' : 'Switch off' })
    if (!ok) return
    await post('/app/api/admin/standing/enforcement', { on }, on ? 'Standing is on' : 'Standing is off', 'switch')
  }

  const s = overview?.stats

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-white">Standing</h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          Limited events only. Two offences in 90 days is yellow; one more is red. Yellow clears after two scanned commitments; red after three, on review.
        </p>
      </div>

      {overview && (
        <div className={`rounded-xl border p-4 mb-5 ${overview.enforced ? 'bg-green-500/5 border-green-500/30' : 'bg-zinc-900 border-zinc-800'}`}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-white">
                {overview.enforced ? `On since ${when(overview.since!)}` : 'Off — recording in shadow'}
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">
                {overview.enforced
                  ? 'Members see their cards; red cards need host approval at limited events.'
                  : 'Nothing reaches members. Cards issued now are shadow and are retired when this is switched on.'}
              </p>
            </div>
            {isAdmin && (
              <button onClick={() => toggle(!overview.enforced)} disabled={busy === 'switch'}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 ${
                  overview.enforced ? 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600' : 'bg-amber-500 text-white hover:bg-amber-600'
                }`}>
                {overview.enforced ? 'Switch off' : 'Switch on'}
              </button>
            )}
          </div>
          {s && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-xs">
              {[
                ['Offences, 30 days', s.offences30],
                ['Counting', s.counting30],
                ['Forgiven (seat refilled)', s.forgiven30],
                ['RSVPs auto-resolved', s.autoResolved30],
                ['Disputes open', s.disputed],
                ['Live yellow', s.liveYellow],
                ['Live red', s.liveRed],
                ['Live shadow cards', s.shadowLive],
              ].map(([label, n]) => (
                <div key={label as string} className="bg-zinc-800/60 rounded-lg px-2.5 py-2">
                  <div className="text-base font-bold text-white">{n}</div>
                  <div className="text-zinc-500">{label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex rounded-lg overflow-hidden text-xs font-semibold mb-4 w-fit">
        {VIEWS.map(v => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`px-3 py-1.5 transition-colors ${view === v.key ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
            {v.label}
          </button>
        ))}
      </div>

      {loadError ? <LoadErrorBanner message={loadError} onRetry={load} title="Couldn't load standing" />
       : items === null ? <p className="text-zinc-500 text-sm">Loading…</p>
       : items.length === 0 ? <p className="text-zinc-500 text-sm">{view === 'disputes' ? 'No disputes waiting.' : 'Nothing here.'}</p>
       : (view === 'disputes' || view === 'offences') ? (
        <div className="space-y-3">
          {(items as OffenceRow[]).map(o => (
            <div key={o.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-start gap-3 flex-wrap">
                <span className="text-xl" aria-hidden="true">{o.event.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/admin/users/${o.user.id}`} className="font-semibold text-white hover:underline">{o.user.name}</Link>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase bg-zinc-700 text-zinc-200">{KIND[o.kind] ?? o.kind}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase bg-zinc-800 text-zinc-400">
                      {o.counts ? o.tier : `logged · ${o.loggedReason === 'new_city' ? 'new city' : 'open'}`}
                    </span>
                    {o.status !== 'open' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase bg-violet-500/15 text-violet-300">{o.status}</span>}
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    <Link href={`/admin/events/${o.event.id}/participants`} className="hover:underline">{o.event.title}</Link> · {o.event.date}
                  </p>
                  {o.disputeNote && <p className="text-sm text-zinc-200 mt-2 italic">&ldquo;{o.disputeNote}&rdquo;</p>}
                  {o.resolutionNote && <p className="text-xs text-zinc-500 mt-1">{o.resolutionNote}</p>}
                </div>
              </div>
              {(o.status === 'disputed' || o.status === 'open') && (
                o.conflict ? (
                  <p className="text-xs text-zinc-500 mt-3">{REVIEW_CONFLICT_MESSAGE[o.conflict]}</p>
                ) : (
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <input value={notes[o.id] ?? ''} onChange={e => setNotes(n => ({ ...n, [o.id]: e.target.value }))}
                      placeholder="Note (what the host said)" maxLength={1000}
                      className="flex-1 min-w-[12rem] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500" />
                    <button onClick={() => decide(o, 'overturn')} disabled={busy === o.id}
                      className="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 text-xs font-semibold disabled:opacity-50">
                      {o.status === 'disputed' ? 'Overturn' : 'They were there'}
                    </button>
                    {o.status === 'disputed' && (
                      <button onClick={() => decide(o, 'uphold')} disabled={busy === o.id}
                        className="px-3 py-1.5 rounded-lg bg-zinc-700 text-zinc-200 hover:bg-zinc-600 text-xs font-semibold disabled:opacity-50">Uphold</button>
                    )}
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {(items as CardRow[]).map(c => (
            <div key={c.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-start gap-3 flex-wrap">
                <span className="text-xl" aria-hidden="true">{c.level === 'red' ? '🟥' : '🟨'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/admin/users/${c.user.id}`} className="font-semibold text-white hover:underline">{c.user.name}</Link>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase bg-zinc-700 text-zinc-200">{c.status}</span>
                    {c.shadow && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase bg-zinc-800 text-zinc-500">shadow</span>}
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    Issued {when(c.issuedAt)} · {c.recoveries} commitment{c.recoveries === 1 ? '' : 's'} since
                  </p>
                  <ul className="text-xs text-zinc-500 mt-1 space-y-0.5">
                    {c.offences.map(o => <li key={o.id}>{KIND[o.kind] ?? o.kind} · {o.event.emoji} {o.event.title} · {o.event.date}</li>)}
                  </ul>
                </div>
              </div>
              {isAdmin && c.level === 'red' && !c.conflict && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <input value={notes[c.id] ?? ''} onChange={e => setNotes(n => ({ ...n, [c.id]: e.target.value }))}
                    placeholder="Review note" maxLength={1000}
                    className="flex-1 min-w-[12rem] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500" />
                  <button onClick={() => restore(c)} disabled={busy === c.id}
                    className="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 text-xs font-semibold disabled:opacity-50">
                    Restore standing
                  </button>
                </div>
              )}
              {c.conflict && <p className="text-xs text-zinc-500 mt-3">{REVIEW_CONFLICT_MESSAGE[c.conflict]}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
