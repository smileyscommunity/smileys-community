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
  // Auto-result suggestion from the cup-results sweeper. Admin
  // sees this as a pre-filled "Apply" badge on the row; clicking
  // Apply commits the values into the real result fields via the
  // same PUT endpoint manual entry uses, so prediction scoring
  // runs in the same transaction.
  suggestedHomeScore?:  number | null
  suggestedAwayScore?:  number | null
  suggestedWinnerTeam?: string | null
  suggestedStatus?:     string | null
  suggestedAt?:         string | null
  // Suggested team assignments for TBD knockout slots. Written by
  // the sweeper after a prior round resolves and football-data
  // has filled in the matchup. Surfaces an "Apply teams" affordance
  // on the row; committing them then lets the score-suggestion
  // path take over for that fixture.
  suggestedHomeTeam?:   string | null
  suggestedAwayTeam?:   string | null
}

export default function CupFixturesPanel() {
  const [fixtures,    setFixtures]    = useState<Fixture[] | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [roundFilter, setRoundFilter] = useState<string>('all')
  const [refreshing,  setRefreshing]  = useState(false)

  function load() {
    // Admin-only endpoint — same shape as /api/cup/fixtures plus
    // the suggested* columns the public endpoint intentionally
    // omits. Without the admin endpoint the Apply / Apply teams
    // affordances have nothing to render off of.
    fetch('/app/api/admin/cup/fixtures', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.fixtures)) setFixtures(d.fixtures) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  // Admin-triggered refresh — same sweeper body the system crontab
  // runs every 5 min. Useful when a result lands mid-cycle and
  // admin wants to commit without waiting up to 5 minutes.
  async function refreshSuggestions() {
    setRefreshing(true)
    try {
      const res = await fetch('/app/api/admin/cup/results/refresh', {
        method: 'POST', credentials: 'include',
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error ?? 'Refresh failed'); return }
      // Differentiate team-only suggestions (TBD knockout slots
      // resolving) from result suggestions (scores landing) so
      // admin knows what's actually new on this refresh.
      const teamsBit = d.suggestedTeams ? ` · ${d.suggestedTeams} team set${d.suggestedTeams === 1 ? '' : 's'}` : ''
      toast.success(
        d.suggested
          ? `Suggested ${d.suggested} new result${d.suggested === 1 ? '' : 's'}${teamsBit} · scanned ${d.matchesScanned}`
          : `No new suggestions · scanned ${d.matchesScanned} match${d.matchesScanned === 1 ? '' : 'es'}`,
      )
      load()
    } finally {
      setRefreshing(false)
    }
  }

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

      <div className="flex items-center gap-3 flex-wrap">
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
        {/* Refresh suggestions — forces the same sweeper the
            crontab fires every 5 minutes. Disabled while in
            flight so a click doesn't queue a second call before
            the first finishes (the API call typically takes <2s
            but football-data slow nights it can stretch). */}
        <button onClick={refreshSuggestions} disabled={refreshing}
          title="Pull fresh results from football-data.org now (the crontab does this every 5 minutes; this button skips the wait)."
          className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
          <span className={refreshing ? 'animate-spin inline-block' : 'inline-block'}>⟳</span>
          {refreshing ? 'Refreshing…' : 'Refresh suggestions'}
        </button>
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

  // Auto-suggestion shown in the row when:
  //   - no admin-committed result yet (winnerTeam null)
  //   - the sweeper saw FINISHED on the upstream feed
  //   - both teams are set on the fixture (so the API result has
  //     something to match against)
  const hasAppliableSuggestion =
    !fixture.winnerTeam &&
    fixture.suggestedStatus === 'FINISHED' &&
    fixture.suggestedHomeScore !== null && fixture.suggestedHomeScore !== undefined &&
    fixture.suggestedAwayScore !== null && fixture.suggestedAwayScore !== undefined

  // Knockout team suggestion. Shown when the fixture is a TBD
  // knockout slot (BOTH home and away null — half-set fixtures are
  // partial admin work and we shouldn't overwrite them) and the
  // sweeper has matched it to a resolved fdMatch. Applying writes
  // the teams; the next sweep cycle then picks up the score
  // suggestion via the (home, away, date) path.
  const hasAppliableTeamSuggestion =
    !fixture.homeTeam && !fixture.awayTeam &&
    !!fixture.suggestedHomeTeam &&
    !!fixture.suggestedAwayTeam

  async function applyTeams() {
    if (!hasAppliableTeamSuggestion) return
    setSaving(true)
    try {
      const res = await fetch(`/app/api/admin/cup/fixtures/${fixture.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          homeTeam: fixture.suggestedHomeTeam,
          awayTeam: fixture.suggestedAwayTeam,
        }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error ?? 'Apply teams failed'); return }
      toast.success(`Teams set · ${teamLabel(fixture.suggestedHomeTeam)} vs ${teamLabel(fixture.suggestedAwayTeam)}`)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  async function applySuggestion() {
    if (!hasAppliableSuggestion) return
    setSaving(true)
    try {
      // Commits via the same PUT endpoint manual entry uses, so
      // the prediction-scoring transaction runs identically. We
      // pass the suggested values straight through; if any of the
      // numbers got mangled the admin already had the chance to
      // bail by clicking Edit instead.
      const res = await fetch(`/app/api/admin/cup/fixtures/${fixture.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          homeScore:  fixture.suggestedHomeScore,
          awayScore:  fixture.suggestedAwayScore,
          winnerTeam: fixture.suggestedWinnerTeam ?? null,
        }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error ?? 'Apply failed'); return }
      const scored   = d.predScored ?? 0
      const brackets = d.bracketsRescored ?? 0
      toast.success(
        `Applied${scored ? ` · ${scored} prediction${scored === 1 ? '' : 's'} scored` : ''}${brackets ? ` · ${brackets} bracket${brackets === 1 ? '' : 's'} rescored` : ''}`,
      )
      onSaved()
    } finally {
      setSaving(false)
    }
  }

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
        <div className="flex items-center justify-between gap-3 flex-wrap">
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
            {/* Auto-suggestion line. Only renders when the sweeper
                has something appliable AND no admin result yet —
                once admin commits, the suggestion stops mattering
                and would just add visual noise. */}
            {hasAppliableSuggestion && (
              <p className="text-xs text-amber-400 mt-1 font-semibold inline-flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider bg-amber-500/10 px-1.5 py-0.5 rounded">⚡ Auto</span>
                <span>
                  {fixture.suggestedHomeScore}–{fixture.suggestedAwayScore}
                  {fixture.suggestedWinnerTeam
                    ? <> · Winner: {teamLabel(fixture.suggestedWinnerTeam)}</>
                    : <> · Draw</>}
                </span>
                {/* Age stamped at render — refreshes whenever the
                    parent reloads (Apply / Refresh / re-mount).
                    Computed inline rather than via a 30s tick so
                    we don't re-render 103 rows constantly. */}
                {fixture.suggestedAt && (
                  <span className="text-[10px] text-amber-500/70 font-normal">
                    · {formatAge(fixture.suggestedAt, Date.now())}
                  </span>
                )}
              </p>
            )}
            {hasAppliableTeamSuggestion && !hasAppliableSuggestion && (
              <p className="text-xs text-sky-400 mt-1 font-semibold inline-flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider bg-sky-500/10 px-1.5 py-0.5 rounded">⚡ Auto teams</span>
                <span>{teamLabel(fixture.suggestedHomeTeam)} vs {teamLabel(fixture.suggestedAwayTeam)}</span>
                {fixture.suggestedAt && (
                  <span className="text-[10px] text-sky-500/70 font-normal">
                    · {formatAge(fixture.suggestedAt, Date.now())}
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {hasAppliableSuggestion && (
              <button onClick={applySuggestion} disabled={saving}
                className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-bold disabled:opacity-60">
                {saving ? 'Applying…' : 'Apply →'}
              </button>
            )}
            {hasAppliableTeamSuggestion && !hasAppliableSuggestion && (
              <button onClick={applyTeams} disabled={saving}
                className="text-xs px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white font-bold disabled:opacity-60">
                {saving ? 'Setting…' : 'Apply teams →'}
              </button>
            )}
            <button onClick={() => setEditing(true)}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700">
              {hasResult
                ? 'Edit'
                : hasAppliableSuggestion
                  ? 'Override'
                  : hasAppliableTeamSuggestion
                    ? 'Override'
                    : 'Enter result'}
            </button>
          </div>
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

// Human-friendly age. The sweeper writes suggestedAt on every
// update so admin can tell stale-from-network-outage suggestions
// apart from fresh ones. Anything beyond a day is overkill for
// this surface; the rolling 7-week tournament means a suggestion
// hanging around for >1d means something is wrong upstream.
function formatAge(iso: string | null | undefined, now: number): string {
  if (!iso) return ''
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const sec = Math.floor(ms / 1000)
  if (sec < 30)    return 'just now'
  if (sec < 60)    return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60)    return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24)     return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
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
