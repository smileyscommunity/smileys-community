'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// The attendance review queue, shared by /admin/attendance-review and
// /host/review. Read-only on purpose: every action already exists on
// /host/checkin, and a second place to check someone in is a second place to
// get it wrong. What this screen adds is the part nobody could see — the
// ratio against the bar, who is unmarked, who was actually warned, and how
// long is left before the room settles.

interface Guest {
  attendeeId: string; userId: string; name: string; email: string | null
  warned: boolean; saysCame: boolean
}
interface Row {
  eventId: string; title: string; emoji: string; date: string
  hostId: string; hostName: string | null
  stage: 'running' | 'review' | 'settled'
  room: number; scanned: number; ratio: number; checkInRan: boolean; bar: number
  unmarked: Guest[]; listSent: boolean
  opensAt: string; settlesAt: string; endsAt: string
}

const STAGES: { key: Row['stage']; label: string; blurb: string }[] = [
  { key: 'review',  label: 'Needs the host',  blurb: 'Anyone left on these lists at the end of the day counts as a no-show. The host can waive it for a month afterwards.' },
  { key: 'running', label: 'Not yet due',     blurb: 'The list goes out the morning after the event.' },
  { key: 'settled', label: 'Settled',         blurb: 'Warned guests left unmarked are now no-shows. Still waivable for a month.' },
]

function timeLeft(iso: string): string {
  const ms = Date.parse(iso) - Date.now()
  if (ms <= 0) return 'passed'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`
}

export default function AttendanceReviewList({ heading, blurb }: { heading: string; blurb: string }) {
  const [rows,  setRows]  = useState<Row[] | null>(null)
  const [scope, setScope] = useState<'all' | 'mine'>('mine')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/attendance-review')
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
        return r.json()
      })
      .then(d => { if (live) { setRows(d.rows); setScope(d.scope) } })
      .catch(e => { if (live) setError(String(e.message ?? e)) })
    return () => { live = false }
  }, [])

  if (error)       return <div className="p-4 sm:p-6"><p className="text-sm text-red-400">Could not load the review queue: {error}</p></div>
  if (rows === null) return <div className="p-4 sm:p-6"><p className="text-sm text-zinc-500">Loading…</p></div>

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-white">{heading}</h1>
        <p className="text-xs text-zinc-500 mt-0.5">{blurb}{scope === 'all' ? ' Showing every city.' : ' Showing the events you run.'}</p>
      </div>

      {rows.length === 0 && (
        <p className="text-sm text-zinc-500">No events in the standing window. Rooms appear here from the day they run until the day after.</p>
      )}

      {STAGES.map(stage => {
        const group = rows.filter(r => r.stage === stage.key)
        if (group.length === 0) return null
        return (
          <section key={stage.key} className="mb-7">
            <h2 className="text-sm font-semibold text-white">{stage.label} <span className="text-zinc-600">({group.length})</span></h2>
            <p className="text-xs text-zinc-500 mt-0.5 mb-2.5">{stage.blurb}</p>
            <div className="space-y-2.5">
              {group.map(r => <EventCard key={r.eventId} row={r} />)}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function EventCard({ row: r }: { row: Row }) {
  const pct      = Math.round(r.ratio * 100)
  const barPct   = Math.round(r.bar * 100)
  const unwarned = r.unmarked.filter(g => !g.warned)

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">{r.emoji} {r.title}</p>
          <p className="text-xs text-zinc-400 mt-0.5">
            {r.date}{r.hostName ? <> · hosted by {r.hostName}</> : null}
          </p>
        </div>
        <Link href={`/host/checkin?event=${r.eventId}`}
          className="shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors">
          Open check-in
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-xs">
        <Stat label="Room"        value={String(r.room)} />
        <Stat label="Checked in"  value={`${r.scanned} · ${pct}%`} />
        <Stat label={`Door ran (${barPct}%)`}
              value={r.checkInRan ? 'yes' : 'no'}
              tone={r.checkInRan ? 'good' : 'warn'} />
        <Stat label={r.stage === 'settled' ? 'Settled' : 'Settles'}
              value={r.stage === 'settled' ? 'closed' : timeLeft(r.settlesAt)}
              tone={r.stage === 'review' ? 'warn' : undefined} />
      </div>

      {!r.checkInRan && r.unmarked.length > 0 && (
        <p className="text-xs text-amber-400/90 mt-2.5">
          Only {pct}% of the room was scanned, so plenty of these people may simply have been missed at the door. They still settle as no-shows if nobody acts — worth a careful look.
        </p>
      )}
      {unwarned.length > 0 && (
        <p className="text-xs text-red-400 mt-2.5">
          {unwarned.length} of these {unwarned.length === 1 ? 'guests was' : 'guests were'} never told they weren’t checked in — {unwarned.length === 1 ? 'that one settles' : 'those settle'} as attended, never as a no-show.
        </p>
      )}

      {r.unmarked.length > 0 && (
        <div className="mt-2.5 border-t border-zinc-800 pt-2.5">
          <p className="text-xs text-zinc-500 mb-1.5">
            Not checked in ({r.unmarked.length}){r.listSent ? ' · host list sent' : ' · no host list sent'}
          </p>
          <ul className="space-y-1">
            {r.unmarked.map(g => (
              <li key={g.attendeeId} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-zinc-300 truncate">{g.name}</span>
                <span className="shrink-0 flex items-center gap-1.5">
                  {g.saysCame && <Tag tone="good">said “I was there”</Tag>}
                  {g.warned ? <Tag>warned</Tag> : <Tag tone="bad">never warned</Tag>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  const colour = tone === 'good' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : 'text-white'
  return (
    <div className="bg-zinc-800/60 rounded-lg px-2.5 py-2">
      <p className={`text-base font-bold ${colour}`}>{value}</p>
      <p className="text-[11px] text-zinc-500 mt-0.5">{label}</p>
    </div>
  )
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: 'good' | 'bad' }) {
  const cls = tone === 'bad'  ? 'bg-red-500/15 text-red-400'
            : tone === 'good' ? 'bg-emerald-500/15 text-emerald-400'
            : 'bg-zinc-800 text-zinc-400'
  return <span className={`px-1.5 py-0.5 rounded ${cls}`}>{children}</span>
}
