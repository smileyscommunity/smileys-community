'use client'

// Smileys Cup predictions UI. Standalone page at /cup — the cup
// is a campaign, not a community, so it doesn't live under a Club
// route. Any approved Smileys member can play (no separate opt-in);
// the only gate is "is your account approved?" enforced by the
// /api/cup/* POST routes. Read endpoints stay public so logged-out
// viewers see the leaderboard + fixtures and get an Apply CTA.
//
// Two viewer states:
//   • Logged-out / pending  → read-only fixtures, Apply CTA
//   • Approved member       → full pick UI
//
// The page itself doesn't enforce the gate — the underlying APIs
// (/api/cup/predict, /api/cup/bracket POST) all 403 non-members.
// Render disables submit buttons when membership is missing so the
// state is obvious before the user clicks.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface Fixture {
  id:        string
  round:     'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'final'
  group:     string | null
  homeTeam:  string | null
  awayTeam:  string | null
  homeLabel: string | null
  awayLabel: string | null
  kickoffAt: string
  venue:     string | null
  winnerTeam: string | null
  homeScore: number | null
  awayScore: number | null
  points:    number
  locked:    boolean
  yourPick:  { pickedTeam: string; submittedAt: string; pointsAwarded: number } | null
}

interface BracketPick {
  championPick:  string
  semifinalists: string[]
  submittedAt:   string
  updatedAt:     string
  pointsAwarded: number
}

interface BracketResponse {
  bracket:           BracketPick | null
  tournamentStartAt: string | null
  locked:            boolean
}

// Mirrors lib/cup.ts CUP_TEAMS — duplicated client-side so the
// picker doesn't need a server round-trip just to list teams.
// Order matches the server-side constant so codes line up exactly.
// The 48 confirmed qualifiers from the Dec 5 2025 draw.
const TEAMS: { code: string; name: string; flag: string; confederation: string }[] = [
  { code: 'ARG', name: 'Argentina',          flag: '🇦🇷', confederation: 'CONMEBOL' },
  { code: 'BRA', name: 'Brazil',             flag: '🇧🇷', confederation: 'CONMEBOL' },
  { code: 'URU', name: 'Uruguay',            flag: '🇺🇾', confederation: 'CONMEBOL' },
  { code: 'COL', name: 'Colombia',           flag: '🇨🇴', confederation: 'CONMEBOL' },
  { code: 'ECU', name: 'Ecuador',            flag: '🇪🇨', confederation: 'CONMEBOL' },
  { code: 'PAR', name: 'Paraguay',           flag: '🇵🇾', confederation: 'CONMEBOL' },
  { code: 'FRA', name: 'France',             flag: '🇫🇷', confederation: 'UEFA' },
  { code: 'ESP', name: 'Spain',              flag: '🇪🇸', confederation: 'UEFA' },
  { code: 'GER', name: 'Germany',            flag: '🇩🇪', confederation: 'UEFA' },
  { code: 'ENG', name: 'England',            flag: '🇬🇧', confederation: 'UEFA' },
  { code: 'POR', name: 'Portugal',           flag: '🇵🇹', confederation: 'UEFA' },
  { code: 'NED', name: 'Netherlands',        flag: '🇳🇱', confederation: 'UEFA' },
  { code: 'BEL', name: 'Belgium',            flag: '🇧🇪', confederation: 'UEFA' },
  { code: 'CRO', name: 'Croatia',            flag: '🇭🇷', confederation: 'UEFA' },
  { code: 'SUI', name: 'Switzerland',        flag: '🇨🇭', confederation: 'UEFA' },
  { code: 'AUT', name: 'Austria',            flag: '🇦🇹', confederation: 'UEFA' },
  { code: 'TUR', name: 'Türkiye',            flag: '🇹🇷', confederation: 'UEFA' },
  { code: 'NOR', name: 'Norway',             flag: '🇳🇴', confederation: 'UEFA' },
  { code: 'SWE', name: 'Sweden',             flag: '🇸🇪', confederation: 'UEFA' },
  { code: 'SCO', name: 'Scotland',           flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', confederation: 'UEFA' },
  { code: 'CZE', name: 'Czechia',            flag: '🇨🇿', confederation: 'UEFA' },
  { code: 'BIH', name: 'Bosnia-Herzegovina', flag: '🇧🇦', confederation: 'UEFA' },
  { code: 'USA', name: 'United States',      flag: '🇺🇸', confederation: 'CONCACAF' },
  { code: 'MEX', name: 'Mexico',             flag: '🇲🇽', confederation: 'CONCACAF' },
  { code: 'CAN', name: 'Canada',             flag: '🇨🇦', confederation: 'CONCACAF' },
  { code: 'PAN', name: 'Panama',             flag: '🇵🇦', confederation: 'CONCACAF' },
  { code: 'HAI', name: 'Haiti',              flag: '🇭🇹', confederation: 'CONCACAF' },
  { code: 'CUW', name: 'Curaçao',            flag: '🇨🇼', confederation: 'CONCACAF' },
  { code: 'MAR', name: 'Morocco',            flag: '🇲🇦', confederation: 'CAF' },
  { code: 'SEN', name: 'Senegal',            flag: '🇸🇳', confederation: 'CAF' },
  { code: 'EGY', name: 'Egypt',              flag: '🇪🇬', confederation: 'CAF' },
  { code: 'ALG', name: 'Algeria',            flag: '🇩🇿', confederation: 'CAF' },
  { code: 'CIV', name: 'Ivory Coast',        flag: '🇨🇮', confederation: 'CAF' },
  { code: 'TUN', name: 'Tunisia',            flag: '🇹🇳', confederation: 'CAF' },
  { code: 'GHA', name: 'Ghana',              flag: '🇬🇭', confederation: 'CAF' },
  { code: 'ZAF', name: 'South Africa',       flag: '🇿🇦', confederation: 'CAF' },
  { code: 'CPV', name: 'Cape Verde',         flag: '🇨🇻', confederation: 'CAF' },
  { code: 'COD', name: 'DR Congo',           flag: '🇨🇩', confederation: 'CAF' },
  { code: 'JPN', name: 'Japan',              flag: '🇯🇵', confederation: 'AFC' },
  { code: 'KOR', name: 'South Korea',        flag: '🇰🇷', confederation: 'AFC' },
  { code: 'IRN', name: 'Iran',               flag: '🇮🇷', confederation: 'AFC' },
  { code: 'AUS', name: 'Australia',          flag: '🇦🇺', confederation: 'AFC' },
  { code: 'KSA', name: 'Saudi Arabia',       flag: '🇸🇦', confederation: 'AFC' },
  { code: 'QAT', name: 'Qatar',              flag: '🇶🇦', confederation: 'AFC' },
  { code: 'UZB', name: 'Uzbekistan',         flag: '🇺🇿', confederation: 'AFC' },
  { code: 'JOR', name: 'Jordan',             flag: '🇯🇴', confederation: 'AFC' },
  { code: 'IRQ', name: 'Iraq',               flag: '🇮🇶', confederation: 'AFC' },
  { code: 'NZL', name: 'New Zealand',        flag: '🇳🇿', confederation: 'OFC' },
]
const TEAM_BY_CODE = new Map(TEAMS.map(t => [t.code, t]))
const teamLabel = (code: string | null | undefined): string => {
  if (!code) return '—'
  const t = TEAM_BY_CODE.get(code)
  return t ? `${t.flag} ${t.name}` : code
}

const ROUND_LABEL: Record<string, string> = {
  group: 'Group stage', r32: 'Round of 32', r16: 'Round of 16',
  qf: 'Quarterfinals', sf: 'Semifinals', final: 'Final',
}

export default function CupPredictionsPage() {
  const router = useRouter()

  const [fixtures, setFixtures] = useState<Fixture[] | null>(null)
  const [bracket,  setBracket]  = useState<BracketResponse | null>(null)
  const [loading,  setLoading]  = useState(true)
  // Bracket draft — separate from the saved bracket so the user can
  // edit + cancel without losing the current state. Initialised
  // from server on first load and on save.
  const [draftChampion, setDraftChampion] = useState<string | null>(null)
  const [draftSF,       setDraftSF]       = useState<string[]>([])
  const [editingBracket, setEditingBracket] = useState(false)
  const [savingBracket,  setSavingBracket]  = useState(false)
  const [savingFixtureId, setSavingFixtureId] = useState<string | null>(null)
  // Membership state from the bracket endpoint's error handling.
  // We set this to 'unauthenticated' or 'not-member' so the UI can
  // render the right empty state.
  const [accessState, setAccessState] = useState<'loading' | 'member' | 'not-member' | 'unauthenticated'>('loading')

  useEffect(() => {
    Promise.all([
      fetch('/app/api/cup/fixtures', { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/cup/bracket', { credentials: 'include' }).then(async r => {
        if (r.status === 401) return { __status: 401 as const }
        return r.json()
      }),
    ])
      .then(([fxData, brData]) => {
        if (fxData.fixtures) setFixtures(fxData.fixtures)
        if ('__status' in brData && brData.__status === 401) {
          setAccessState('unauthenticated')
        } else {
          setBracket(brData)
          // We treat any non-401 as "logged in"; the membership gate
          // gets reflected on each write (403 from /predict and
          // /bracket POST) rather than blocking the page render.
          setAccessState('member')
        }
      })
      .finally(() => setLoading(false))
  }, [])

  // When bracket arrives, prime the draft so "edit" reflects what's saved.
  useEffect(() => {
    if (bracket?.bracket) {
      setDraftChampion(bracket.bracket.championPick)
      setDraftSF(bracket.bracket.semifinalists)
    }
  }, [bracket])

  async function saveBracket() {
    if (!draftChampion || draftSF.length !== 4) {
      toast.error('Pick a champion and 4 semifinalists')
      return
    }
    if (!draftSF.includes(draftChampion)) {
      toast.error('Your champion must be one of your semifinalists')
      return
    }
    setSavingBracket(true)
    try {
      const res = await fetch('/app/api/cup/bracket', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ championPick: draftChampion, semifinalists: draftSF }),
      })
      const d = await res.json()
      if (res.ok) {
        setBracket(prev => prev ? { ...prev, bracket: d.bracket } : prev)
        setEditingBracket(false)
        toast.success('Bracket locked in 🏆')
      } else if (res.status === 403 && /approved/i.test(d.error)) {
        setAccessState('not-member')
        toast.error(d.error)
      } else {
        toast.error(d.error || 'Could not save bracket')
      }
    } finally {
      setSavingBracket(false)
    }
  }

  async function pickFixture(fixtureId: string, team: string) {
    setSavingFixtureId(fixtureId)
    try {
      const res = await fetch('/app/api/cup/predict', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixtureId, pickedTeam: team }),
      })
      const d = await res.json()
      if (res.ok) {
        setFixtures(prev => prev?.map(f => f.id === fixtureId
          ? { ...f, yourPick: { pickedTeam: team, submittedAt: new Date().toISOString(), pointsAwarded: 0 } }
          : f) ?? null)
        toast.success(`Picked ${teamLabel(team)}`)
      } else if (res.status === 403 && /approved/i.test(d.error)) {
        setAccessState('not-member')
        toast.error(d.error)
      } else {
        toast.error(d.error || 'Could not save pick')
      }
    } finally {
      setSavingFixtureId(null)
    }
  }

  // Group fixtures by round for clean section rendering. group rows
  // (if any seeded in future) collapse into a single read-only block.
  const byRound = useMemo(() => {
    if (!fixtures) return {} as Record<string, Fixture[]>
    return fixtures.reduce((acc: Record<string, Fixture[]>, f) => {
      (acc[f.round] ||= []).push(f)
      return acc
    }, {})
  }, [fixtures])

  if (loading) {
    return <Shell>
      <div className="space-y-3">
        <div className="h-8 w-2/3 rounded bg-gray-100 animate-pulse" />
        <div className="h-32 rounded-2xl bg-gray-100 animate-pulse" />
        <div className="h-24 rounded-2xl bg-gray-100 animate-pulse" />
      </div>
    </Shell>
  }

  const bracketLocked = bracket?.locked ?? false
  const totalScore =
    (bracket?.bracket?.pointsAwarded ?? 0) +
    (fixtures?.reduce((s, f) => s + (f.yourPick?.pointsAwarded ?? 0), 0) ?? 0)
  const picksLocked = fixtures?.filter(f => f.locked).length ?? 0
  const picksTotal  = fixtures?.length ?? 0

  return (
    <Shell>
      {/* Title — standalone page, no parent breadcrumb. The cup IS
          the destination; nothing to navigate back to except the
          rest of the app, which the global nav handles. */}
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">🏆 FIFA World Cup 2026</h1>
        <p className="text-xs text-gray-500 mt-0.5">Pick a champion. Pick every knockout. Win the trophy.</p>
      </div>

      {/* Logged-out / pending — Apply CTA. The cup is the only
          page on the platform a non-member can land on and see
          real members playing in real time, so the Apply pitch
          rides the highest-intent surface we have. */}
      {accessState === 'unauthenticated' && (
        <div className="bg-white border border-amber-200 rounded-2xl p-5 mb-4 shadow-sm">
          <p className="font-bold text-gray-900 mb-1">Want to play?</p>
          <p className="text-sm text-gray-600 mb-3">The Smileys Cup is for members. Apply to join — once you&apos;re accepted you can lock in your bracket and start picking matches.</p>
          <button onClick={() => router.push('/apply')}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
            Apply to Smileys
          </button>
        </div>
      )}
      {accessState === 'not-member' && (
        <div className="bg-white border border-amber-200 rounded-2xl p-5 mb-4 shadow-sm">
          <p className="font-bold text-gray-900 mb-1">Your application is still under review</p>
          <p className="text-sm text-gray-600">You&apos;ll be able to play once your membership is approved. Check back soon.</p>
        </div>
      )}

      {/* How it works — collapsible rules card. Always visible
          (members + non-members) so the game's mental model is
          one tap away. Defaults expanded for non-members (they
          need it to understand what's on offer) and collapsed
          for members (they've seen it before). */}
      <RulesCard defaultOpen={accessState !== 'member'} />

      {/* Your score header — only meaningful when something exists. */}
      {accessState === 'member' && (bracket?.bracket || (fixtures?.some(f => f.yourPick))) && (
        <div className="bg-white rounded-2xl shadow-card p-4 mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Your score</p>
            <p className="text-3xl font-extrabold text-amber-600 mt-0.5">{totalScore}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Picks locked</p>
            <p className="text-sm font-bold text-gray-700">{picksLocked} / {picksTotal}</p>
          </div>
        </div>
      )}

      {/* Leaderboard — public read so logged-out viewers see real
          members playing, which drives the Apply CTA above. */}
      <Leaderboard />


      {/* Bracket pick — champion + 4 semifinalists */}
      <BracketCard
        bracket={bracket?.bracket ?? null}
        locked={bracketLocked}
        editing={editingBracket}
        draftChampion={draftChampion}
        draftSF={draftSF}
        savingBracket={savingBracket}
        canEdit={accessState === 'member' && !bracketLocked}
        onStartEdit={() => setEditingBracket(true)}
        onCancelEdit={() => {
          setEditingBracket(false)
          if (bracket?.bracket) {
            setDraftChampion(bracket.bracket.championPick)
            setDraftSF(bracket.bracket.semifinalists)
          } else {
            setDraftChampion(null); setDraftSF([])
          }
        }}
        onSetChampion={setDraftChampion}
        onToggleSF={(code) => {
          setDraftSF(prev => prev.includes(code)
            ? prev.filter(c => c !== code)
            : prev.length >= 4 ? prev : [...prev, code])
        }}
        onSave={saveBracket}
        tournamentStartAt={bracket?.tournamentStartAt ?? null}
      />

      {/* Fixtures by round. Group stage is rendered first since
          it's chronologically earliest; within it we sub-section
          by group letter (A–L) so 72 matches don't read as one
          flat scroll. Knockouts (R32–Final) stay flat. */}
      <div className="mt-5 space-y-5">
        {/* Group stage — sub-sectioned by group letter */}
        {(byRound.group?.length ?? 0) > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2 px-1">
              <h2 className="text-sm font-bold text-gray-800">{ROUND_LABEL.group}</h2>
              <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">
                1 pt each · 72 matches
              </span>
            </div>
            <GroupStageSections
              rows={byRound.group ?? []}
              savingFixtureId={savingFixtureId}
              canPick={accessState === 'member'}
              onPick={pickFixture}
            />
          </section>
        )}

        {/* Knockouts — flat lists per round */}
        {(['r32', 'r16', 'qf', 'sf', 'final'] as const).map(round => {
          const rows = byRound[round] ?? []
          if (rows.length === 0) return null
          return (
            <section key={round}>
              <div className="flex items-center justify-between mb-2 px-1">
                <h2 className="text-sm font-bold text-gray-800">{ROUND_LABEL[round]}</h2>
                <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">
                  {rows[0].points} pt{rows[0].points === 1 ? '' : 's'} each
                </span>
              </div>
              <div className="space-y-2">
                {rows.map(f => (
                  <FixtureRow
                    key={f.id}
                    fixture={f}
                    saving={savingFixtureId === f.id}
                    canPick={accessState === 'member'}
                    onPick={(team) => pickFixture(f.id, team)}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </Shell>
  )
}

// Group stage — collapsible sections per group letter. Defaults to
// collapsed-when-all-played, expanded-when-next-match-in-group-is-
// upcoming. Keeps the 72-match scroll manageable without hiding
// the actively-playable groups behind a tap.
function GroupStageSections({
  rows, savingFixtureId, canPick, onPick,
}: {
  rows: Fixture[]
  savingFixtureId: string | null
  canPick: boolean
  onPick: (fixtureId: string, team: string) => void
}) {
  const byGroup = useMemo(() => {
    const out: Record<string, Fixture[]> = {}
    for (const r of rows) {
      const g = r.group ?? '?'
      ;(out[g] ||= []).push(r)
    }
    for (const key of Object.keys(out)) {
      out[key].sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt))
    }
    return out
  }, [rows])
  const letters = Object.keys(byGroup).sort()
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    // Initially expand groups that have at least one still-pickable
    // match — that's where the user's attention should go.
    const init: Record<string, boolean> = {}
    for (const letter of Object.keys(byGroup)) {
      init[letter] = byGroup[letter].some(f => !f.locked)
    }
    return init
  })

  return (
    <div className="space-y-2">
      {letters.map(letter => {
        const list = byGroup[letter]
        const teamsInGroup = Array.from(new Set(list.flatMap(f => [f.homeTeam, f.awayTeam]).filter((c): c is string => !!c)))
        const isOpen = expanded[letter]
        const yourPicksInGroup = list.filter(f => f.yourPick).length
        const lockedInGroup    = list.filter(f => f.locked).length
        return (
          <div key={letter} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <button onClick={() => setExpanded(p => ({ ...p, [letter]: !p[letter] }))}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm font-bold text-amber-600 shrink-0">Group {letter}</span>
                <span className="text-xs text-gray-500 truncate">
                  {teamsInGroup.map(c => TEAM_BY_CODE.get(c)?.flag ?? '').join(' ')}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-gray-500 font-semibold">
                  {yourPicksInGroup}/{list.length} picked · {lockedInGroup} locked
                </span>
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            {isOpen && (
              <div className="px-3 pb-3 space-y-2 border-t border-gray-100 pt-3">
                {list.map(f => (
                  <FixtureRow
                    key={f.id}
                    fixture={f}
                    saving={savingFixtureId === f.id}
                    canPick={canPick}
                    onPick={(team) => onPick(f.id, team)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function BracketCard({
  bracket, locked, editing, draftChampion, draftSF, savingBracket, canEdit,
  onStartEdit, onCancelEdit, onSetChampion, onToggleSF, onSave, tournamentStartAt,
}: {
  bracket: BracketPick | null; locked: boolean; editing: boolean
  draftChampion: string | null; draftSF: string[]
  savingBracket: boolean; canEdit: boolean
  onStartEdit: () => void; onCancelEdit: () => void
  onSetChampion: (code: string) => void
  onToggleSF: (code: string) => void
  onSave: () => void
  tournamentStartAt: string | null
}) {
  const hasBracket = bracket !== null
  const lockMsg = tournamentStartAt
    ? `Locks at first kickoff · ${new Date(tournamentStartAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    : 'Locks at first kickoff'

  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <div className="flex items-start justify-between mb-3 gap-2">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Your bracket</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {locked ? 'Locked — tournament has started' : lockMsg}
          </p>
        </div>
        <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider shrink-0">
          {(bracket?.pointsAwarded ?? 0)} / 200 pts
        </span>
      </div>

      {/* Read-only state */}
      {!editing && hasBracket && (
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Champion · 100 pts</p>
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
              <span className="text-lg">🏆</span>
              <span className="text-sm font-bold text-gray-900">{teamLabel(bracket!.championPick)}</span>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Semifinalists · 25 pts each</p>
            <div className="grid grid-cols-2 gap-2">
              {bracket!.semifinalists.map(code => (
                <div key={code} className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl">
                  <span className="text-sm font-semibold text-gray-700">{teamLabel(code)}</span>
                </div>
              ))}
            </div>
          </div>
          {canEdit && (
            <button onClick={onStartEdit}
              className="w-full mt-2 py-2 text-xs font-semibold text-amber-600 hover:bg-amber-50 rounded-lg transition-colors">
              Edit bracket
            </button>
          )}
        </div>
      )}

      {/* Empty state */}
      {!editing && !hasBracket && (
        <div className="text-center py-4">
          <p className="text-sm text-gray-500 mb-3">No bracket yet. Pick your champion + 4 semifinalists before first kickoff.</p>
          {canEdit ? (
            <button onClick={onStartEdit}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
              Lock in your bracket
            </button>
          ) : (
            <p className="text-xs text-gray-400">Join the cup club to play</p>
          )}
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
              Step 1 · Pick your 4 semifinalists ({draftSF.length}/4)
            </p>
            <TeamPickerGrid
              selected={draftSF}
              onToggle={onToggleSF}
              max={4}
            />
          </div>
          {draftSF.length === 4 && (
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                Step 2 · Pick your champion (from your 4)
              </p>
              <div className="grid grid-cols-2 gap-2">
                {draftSF.map(code => (
                  <button key={code}
                    onClick={() => onSetChampion(code)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold border-2 transition-colors ${
                      draftChampion === code
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-amber-300'
                    }`}>
                    🏆 {teamLabel(code)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button onClick={onCancelEdit} disabled={savingBracket}
              className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-bold rounded-xl transition-colors disabled:opacity-60">
              Cancel
            </button>
            <button onClick={onSave} disabled={savingBracket || draftSF.length !== 4 || !draftChampion}
              className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-40">
              {savingBracket ? 'Saving…' : 'Save bracket'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function TeamPickerGrid({ selected, onToggle, max }: { selected: string[]; onToggle: (code: string) => void; max: number }) {
  const grouped = useMemo(() => {
    const out: Record<string, typeof TEAMS> = {}
    for (const t of TEAMS) (out[t.confederation] ||= []).push(t)
    return out
  }, [])
  const atMax = selected.length >= max
  return (
    <div className="space-y-3 max-h-96 overflow-y-auto px-1">
      {Object.entries(grouped).map(([conf, teams]) => (
        <div key={conf}>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">{conf}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {teams.map(t => {
              const isSelected = selected.includes(t.code)
              const disabled = !isSelected && atMax
              return (
                <button key={t.code}
                  onClick={() => onToggle(t.code)}
                  disabled={disabled}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    isSelected
                      ? 'bg-amber-500 text-white border-amber-500'
                      : disabled
                        ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-amber-300'
                  }`}>
                  <span>{t.flag}</span>
                  <span className="truncate">{t.code}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function FixtureRow({ fixture, saving, canPick, onPick }: { fixture: Fixture; saving: boolean; canPick: boolean; onPick: (team: string) => void }) {
  const tbd = !fixture.homeTeam || !fixture.awayTeam
  const homeLabel = tbd ? (fixture.homeLabel ?? '—') : teamLabel(fixture.homeTeam)
  const awayLabel = tbd ? (fixture.awayLabel ?? '—') : teamLabel(fixture.awayTeam)
  const kickoff = new Date(fixture.kickoffAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const yourPick = fixture.yourPick?.pickedTeam ?? null
  const correct = fixture.winnerTeam && yourPick === fixture.winnerTeam
  const wrong   = fixture.winnerTeam && yourPick && yourPick !== fixture.winnerTeam

  return (
    <div className={`bg-white rounded-2xl border p-3.5 shadow-sm ${
      correct ? 'border-green-200 bg-green-50/40'
        : wrong ? 'border-red-200 bg-red-50/40'
        : 'border-gray-100'
    }`}>
      <div className="flex items-center justify-between mb-2 text-[10px] text-gray-500 font-semibold uppercase tracking-wider">
        <span>{kickoff}</span>
        {fixture.locked && fixture.winnerTeam && (
          <span className="text-amber-600">
            {fixture.homeScore}–{fixture.awayScore} · Winner: {teamLabel(fixture.winnerTeam)}
          </span>
        )}
        {fixture.locked && !fixture.winnerTeam && <span className="text-gray-400">Locked</span>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <FixturePickButton
          label={homeLabel}
          team={fixture.homeTeam}
          isPicked={yourPick === fixture.homeTeam}
          isWinner={fixture.winnerTeam === fixture.homeTeam}
          disabled={!canPick || fixture.locked || saving || tbd}
          onClick={() => fixture.homeTeam && onPick(fixture.homeTeam)}
        />
        <FixturePickButton
          label={awayLabel}
          team={fixture.awayTeam}
          isPicked={yourPick === fixture.awayTeam}
          isWinner={fixture.winnerTeam === fixture.awayTeam}
          disabled={!canPick || fixture.locked || saving || tbd}
          onClick={() => fixture.awayTeam && onPick(fixture.awayTeam)}
        />
      </div>

      {tbd && !fixture.locked && (
        <p className="text-[10px] text-gray-400 mt-2 italic">Teams confirmed once the prior round resolves</p>
      )}
    </div>
  )
}

function FixturePickButton({ label, team, isPicked, isWinner, disabled, onClick }: {
  label: string; team: string | null; isPicked: boolean; isWinner: boolean; disabled: boolean; onClick: () => void
}) {
  const cls = isWinner ? 'bg-green-500 text-white border-green-500'
    : isPicked ? 'bg-amber-500 text-white border-amber-500'
    : disabled  ? 'bg-gray-50 text-gray-400 border-gray-100 cursor-not-allowed'
    : 'bg-white text-gray-700 border-gray-200 hover:border-amber-300'
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold border transition-colors ${cls}`}>
      {label}
      {isPicked && !isWinner && <span className="text-xs opacity-80">✓</span>}
    </button>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-warm pb-20">
      <div className="max-w-2xl mx-auto px-4 pt-6">{children}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Rules card — answers "how do I play?" inline on the page.
// Defaults open for first-time viewers (non-members), collapsed
// for members who've seen it before. Members can re-open anytime.
// ─────────────────────────────────────────────────────────────────
function RulesCard({ defaultOpen }: { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white rounded-2xl shadow-card mb-4 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors">
        <div>
          <p className="text-sm font-bold text-gray-900">How it works</p>
          <p className="text-xs text-gray-500 mt-0.5">Pick a champion, pick every match, win the trophy.</p>
        </div>
        <svg className={`w-5 h-5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-100 pt-4">
          <div>
            <p className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1.5">1 · Lock in your bracket</p>
            <p className="text-sm text-gray-700 leading-relaxed">
              Before the tournament starts (Jun 11), pick your <strong>champion</strong> (100 pts) and the <strong>4 teams</strong> you think will reach the semifinals (25 pts each).
            </p>
          </div>
          <div>
            <p className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1.5">2 · Pick every match</p>
            <p className="text-sm text-gray-700 leading-relaxed">
              From Day 1 onward, pick the winner of each match before kickoff. Group stage is 1 pt per correct pick. Knockouts scale up:
            </p>
            <div className="mt-2 grid grid-cols-5 gap-1.5 text-center">
              {[
                { round: 'R32',   pts: 3  },
                { round: 'R16',   pts: 5  },
                { round: 'QF',    pts: 10 },
                { round: 'SF',    pts: 20 },
                { round: 'Final', pts: 40 },
              ].map(r => (
                <div key={r.round} className="bg-amber-50 rounded-lg py-2">
                  <div className="text-[10px] font-bold text-amber-700 uppercase">{r.round}</div>
                  <div className="text-base font-extrabold text-amber-600">{r.pts}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1.5">3 · Climb the leaderboard</p>
            <p className="text-sm text-gray-700 leading-relaxed">
              Max possible: ~480 pts. Top of the board at the Final wins the <strong>Smileys Cup trophy</strong> + a partner dinner + a year of VIP membership.
            </p>
          </div>
          <div className="text-[11px] text-gray-500 bg-gray-50 rounded-lg p-3 leading-relaxed">
            <strong>Picks lock at kickoff</strong> — no last-minute changes. Bracket locks at the first whistle of the tournament. Tiebreaker on leaderboard ties: earlier bracket submission wins.
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Leaderboard — public, auto-refreshes every 30s (cheap groupBy
// query). Top 50 surfaced; the caller's row pinned at the bottom
// when ranked outside the visible slice. Logged-out viewers see
// the real list — that's the social proof that turns "looks fun"
// into "where do I apply?"
// ─────────────────────────────────────────────────────────────────
interface LeaderRow {
  rank: number; name: string; color: string; profilePhoto: string | null
  score: number; matchScore: number; bracketScore: number
}
interface LeaderResponse {
  rows: LeaderRow[]; yourRank: number | null; yourScore: number | null
  total: number; lastUpdated: string
}

function Leaderboard() {
  const [data, setData] = useState<LeaderResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    function load() {
      fetch('/app/api/cup/leaderboard?take=50', { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (alive && d) setData(d) })
        .finally(() => alive && setLoading(false))
    }
    load()
    // Refresh every 30 seconds while the page is open. Tournament
    // pace gives a natural rhythm — results lag the broadcast, so
    // anything tighter doesn't get fresher data.
    const t = setInterval(load, 30_000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  if (loading && !data) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-5 mb-4">
        <p className="text-sm font-bold text-gray-900 mb-3">Leaderboard</p>
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      </div>
    )
  }
  if (!data || data.total === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-5 mb-4">
        <p className="text-sm font-bold text-gray-900 mb-1">Leaderboard</p>
        <p className="text-xs text-gray-500">No picks yet — be the first to lock in your bracket and you&apos;ll lead by default.</p>
      </div>
    )
  }

  const youInSlice = data.yourRank !== null && data.rows.some(r => r.rank === data.yourRank)

  return (
    <div className="bg-white rounded-2xl shadow-card mb-4 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-sm font-bold text-gray-900">Leaderboard</p>
        <p className="text-[10px] text-gray-400">{data.total} playing</p>
      </div>
      <div className="divide-y divide-gray-100">
        {data.rows.map((r, idx) => (
          <LeaderRow key={`${r.rank}-${idx}`} row={r} isYou={r.rank === data.yourRank} />
        ))}
      </div>
      {/* Pin "you" at the bottom if outside the visible slice. */}
      {data.yourRank !== null && data.yourScore !== null && !youInSlice && (
        <div className="border-t-2 border-amber-200 bg-amber-50">
          <div className="px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-amber-700 tabular-nums">#{data.yourRank}</span>
              <span className="text-sm font-semibold text-amber-900">You</span>
            </div>
            <span className="text-sm font-extrabold text-amber-700 tabular-nums">{data.yourScore}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function LeaderRow({ row, isYou }: { row: LeaderRow; isYou: boolean }) {
  const medal = row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : null
  return (
    <div className={`px-5 py-2.5 flex items-center gap-3 ${isYou ? 'bg-amber-50' : ''}`}>
      <span className="text-xs font-bold text-gray-500 tabular-nums w-6 text-right">
        {medal ?? `#${row.rank}`}
      </span>
      {row.profilePhoto ? (
        <img src={row.profilePhoto} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
      ) : (
        <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-white text-[10px] font-bold"
          style={{ backgroundColor: row.color }}>
          {row.name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)}
        </div>
      )}
      <span className={`flex-1 min-w-0 text-sm truncate ${isYou ? 'font-bold text-amber-900' : 'font-medium text-gray-800'}`}>
        {row.name} {isYou && <span className="text-[10px] text-amber-700 ml-1">(you)</span>}
      </span>
      <div className="text-right shrink-0">
        <div className={`text-sm font-extrabold tabular-nums ${isYou ? 'text-amber-700' : 'text-gray-900'}`}>{row.score}</div>
        <div className="text-[9px] text-gray-400">
          {row.bracketScore > 0 ? `${row.bracketScore} bkt · ` : ''}{row.matchScore} pks
        </div>
      </div>
    </div>
  )
}
