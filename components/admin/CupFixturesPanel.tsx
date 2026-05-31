'use client'

// Fixture management + result entry for the Smileys Cup. Extracted
// from the old /admin/cup page so it can mount as a tab inside the
// campaign-detail page (/admin/campaigns/[id]).
//
// Two things admin does here:
//   1. Fill in knockout slots with real teams once a prior round
//      resolves ("R16-3 home = winner of R32-5").
//   2. Record results — winner + scores — which trigger scoring of
//      every CupPrediction on that fixture, and on QF/Final results
//      every CupBracketPick too.
//
// Group fixtures already have teams baked in (the Dec 5 draw was
// settled at seed time), so the group section is read-only for
// teams and only takes result entry. Knockouts get team-set
// affordances.

import { useEffect, useState, useMemo } from 'react'
import { toast } from 'sonner'
import { CUP_TEAMS as TEAMS, teamLabel, ROUND_LABEL } from '@/lib/cup-data'

interface Fixture {
  id:         string
  round:      'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'final'
  group:      string | null
  homeTeam:   string | null
  awayTeam:   string | null
  homeLabel:  string | null
  awayLabel:  string | null
  kickoffAt:  string
  venue:      string | null
  winnerTeam: string | null
  homeScore:  number | null
  awayScore:  number | null
  points:     number
}

export default function CupFixturesPanel() {
  const [fixtures,    setFixtures]    = useState<Fixture[] | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [roundFilter, setRoundFilter] = useState<string>('all')

  function load() {
    fetch('/app/api/cup/fixtures', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.fixtures)) setFixtures(d.fixtures) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  // At-a-glance "how much of the tournament has resolved."
  const stats = useMemo(() => {
    if (!fixtures) return null
    const total      = fixtures.length
    const withResult = fixtures.filter(f => f.winnerTeam).length
    const tbd        = fixtures.filter(f => !f.homeTeam || !f.awayTeam).length
    return { total, withResult, tbd }
  }, [fixtures])

  const byRound = useMemo(() => {
    if (!fixtures) return {} as Record<string, Fixture[]>
    return fixtures.reduce((acc: Record<string, Fixture[]>, f) => {
      (acc[f.round] ||= []).push(f)
      return acc
    }, {})
  }, [fixtures])

  return (
    <div className="space-y-5">
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="text-xs text-zinc-500 mb-1">Total fixtures</div>
            <div className="text-2xl font-extrabold text-white">{stats.total}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="text-xs text-zinc-500 mb-1">With result</div>
            <div className="text-2xl font-extrabold text-emerald-400">{stats.withResult}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="text-xs text-zinc-500 mb-1">Slots TBD</div>
            <div className="text-2xl font-extrabold text-amber-400">{stats.tbd}</div>
          </div>
        </div>
      )}

      <div className="flex gap-1 bg-zinc-800 rounded-xl p-1 border border-zinc-700 w-fit">
        {(['all', 'group', 'r32', 'r16', 'qf', 'sf', 'final'] as const).map(r => (
          <button key={r} onClick={() => setRoundFilter(r)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              roundFilter === r ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'
            }`}>
            {r === 'all' ? 'All' : ROUND_LABEL[r]}
          </button>
        ))}
      </div>

      {loading && <div className="text-center text-zinc-500 py-12 text-sm">Loading…</div>}

      {!loading && fixtures && (
        <div className="space-y-6">
          {(['group', 'r32', 'r16', 'qf', 'sf', 'final'] as const).map(round => {
            if (roundFilter !== 'all' && roundFilter !== round) return null
            const rows = byRound[round] ?? []
            if (rows.length === 0) return null
            return (
              <section key={round}>
                <div className="flex items-center justify-between mb-2 px-1">
                  <h3 className="text-sm font-bold text-white">{ROUND_LABEL[round]}</h3>
                  <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">
                    {rows[0].points} pt{rows[0].points === 1 ? '' : 's'} each · {rows.length} match{rows.length === 1 ? '' : 'es'}
                  </span>
                </div>
                <div className="space-y-2">
                  {rows.map(f => <FixtureRow key={f.id} fixture={f} onSaved={load} />)}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FixtureRow({ fixture, onSaved }: { fixture: Fixture; onSaved: () => void }) {
  const [home,       setHome]       = useState(fixture.homeTeam   ?? '')
  const [away,       setAway]       = useState(fixture.awayTeam   ?? '')
  const [winner,     setWinner]     = useState(fixture.winnerTeam ?? '')
  const [homeScore,  setHomeScore]  = useState(fixture.homeScore != null ? String(fixture.homeScore) : '')
  const [awayScore,  setAwayScore]  = useState(fixture.awayScore != null ? String(fixture.awayScore) : '')
  const [saving,     setSaving]     = useState(false)
  const [editing,    setEditing]    = useState(false)

  const isGroup       = fixture.round === 'group'
  // Group fixtures came pre-populated with real teams from the
  // draw; knockouts started as TBD labels. We only let admins
  // edit teams on knockouts since editing a group team would
  // contradict the draw itself.
  const teamsEditable = !isGroup
  const hasResult     = !!fixture.winnerTeam

  const kickoff = new Date(fixture.kickoffAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  async function save() {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {}
      if (teamsEditable) {
        if (home !== (fixture.homeTeam ?? '')) body.homeTeam = home || null
        if (away !== (fixture.awayTeam ?? '')) body.awayTeam = away || null
      }
      if (winner !== (fixture.winnerTeam ?? '')) body.winnerTeam = winner || null
      const hs = homeScore === '' ? null : Number(homeScore)
      const as = awayScore === '' ? null : Number(awayScore)
      if (hs !== fixture.homeScore) body.homeScore = hs
      if (as !== fixture.awayScore) body.awayScore = as

      if (Object.keys(body).length === 0) {
        toast('No changes')
        setEditing(false)
        return
      }

      const res = await fetch(`/app/api/admin/cup/fixtures/${fixture.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error ?? 'Save failed'); return }

      const scored   = d.predScored ?? 0
      const brackets = d.bracketsRescored ?? 0
      toast.success(
        `Saved${scored ? ` · ${scored} prediction${scored === 1 ? '' : 's'} scored` : ''}${brackets ? ` · ${brackets} bracket${brackets === 1 ? '' : 's'} rescored` : ''}`,
      )
      setEditing(false)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`bg-zinc-900 border rounded-2xl p-3.5 ${
      hasResult ? 'border-emerald-500/30' : 'border-zinc-800'
    }`}>
      <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-2">
        <span className="font-mono">{fixture.id}{fixture.group ? ` · Group ${fixture.group}` : ''}</span>
        <span>{kickoff}</span>
      </div>

      {!editing ? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white truncate">
              {fixture.homeTeam ? teamLabel(fixture.homeTeam) : (fixture.homeLabel ?? '—')}
              <span className="text-zinc-600 mx-1.5">vs</span>
              {fixture.awayTeam ? teamLabel(fixture.awayTeam) : (fixture.awayLabel ?? '—')}
            </div>
            {hasResult && (
              <p className="text-xs text-emerald-400 mt-1 font-semibold">
                {fixture.homeScore}–{fixture.awayScore} · Winner: {teamLabel(fixture.winnerTeam)}
              </p>
            )}
          </div>
          <button onClick={() => setEditing(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700">
            {hasResult ? 'Edit' : 'Enter result'}
          </button>
        </div>
      ) : (
        <div className="space-y-3 pt-1">
          {teamsEditable && (
            <div className="grid grid-cols-2 gap-2">
              <TeamSelect label="Home team" value={home} onChange={setHome} />
              <TeamSelect label="Away team" value={away} onChange={setAway} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Home score</label>
              <input type="number" min={0} value={homeScore} onChange={e => setHomeScore(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Away score</label>
              <input type="number" min={0} value={awayScore} onChange={e => setAwayScore(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
          </div>

          {/* Winner restricted to the two teams set on the fixture
              (server validates the same), unless both are still TBD
              in which case we let the admin pick any team — useful
              when filling in a knockout where the prior round
              determines the winner that lands here. */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Winner</label>
            <select value={winner} onChange={e => setWinner(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500">
              <option value="">— no winner yet —</option>
              {home && <option value={home}>{teamLabel(home)}</option>}
              {away && <option value={away}>{teamLabel(away)}</option>}
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={() => setEditing(false)} disabled={saving}
              className="flex-1 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold disabled:opacity-60">
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              className="flex-1 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold disabled:opacity-60">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function TeamSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500">
        <option value="">— TBD —</option>
        {TEAMS.map(t => <option key={t.code} value={t.code}>{t.flag} {t.name}</option>)}
      </select>
    </div>
  )
}
