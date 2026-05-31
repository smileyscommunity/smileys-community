'use client'

// Smileys Cup predictions UI. Lives under the WC club at
// /clubs/world-cup-2026/cup so the URL stays inside the club
// namespace (Joining the club = playing the cup; this page is the
// game surface).
//
// Three viewer states:
//   • Logged-out          → read-only bracket + fixtures, Apply CTA
//   • Logged-in non-member → "Join the cup club" CTA
//   • Approved cup member  → full pick UI
//
// The page itself doesn't enforce the gate — the underlying APIs
// (/api/cup/predict, /api/cup/bracket POST) all 403 non-members.
// Render disables submit buttons when membership is missing so the
// state is obvious before the user clicks.

import { useEffect, useMemo, useState, use } from 'react'
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

// Mirrors lib/cup.ts — kept duplicated client-side so the picker
// doesn't need a server round-trip just to list teams. Order
// matches the server-side constant so codes line up exactly.
const TEAMS: { code: string; name: string; flag: string; confederation: string }[] = [
  { code: 'ARG', name: 'Argentina',     flag: '🇦🇷', confederation: 'CONMEBOL' },
  { code: 'BRA', name: 'Brazil',        flag: '🇧🇷', confederation: 'CONMEBOL' },
  { code: 'URU', name: 'Uruguay',       flag: '🇺🇾', confederation: 'CONMEBOL' },
  { code: 'COL', name: 'Colombia',      flag: '🇨🇴', confederation: 'CONMEBOL' },
  { code: 'ECU', name: 'Ecuador',       flag: '🇪🇨', confederation: 'CONMEBOL' },
  { code: 'PAR', name: 'Paraguay',      flag: '🇵🇾', confederation: 'CONMEBOL' },
  { code: 'FRA', name: 'France',        flag: '🇫🇷', confederation: 'UEFA' },
  { code: 'ESP', name: 'Spain',         flag: '🇪🇸', confederation: 'UEFA' },
  { code: 'GER', name: 'Germany',       flag: '🇩🇪', confederation: 'UEFA' },
  { code: 'ENG', name: 'England',       flag: '🇬🇧', confederation: 'UEFA' },
  { code: 'POR', name: 'Portugal',      flag: '🇵🇹', confederation: 'UEFA' },
  { code: 'NED', name: 'Netherlands',   flag: '🇳🇱', confederation: 'UEFA' },
  { code: 'ITA', name: 'Italy',         flag: '🇮🇹', confederation: 'UEFA' },
  { code: 'BEL', name: 'Belgium',       flag: '🇧🇪', confederation: 'UEFA' },
  { code: 'CRO', name: 'Croatia',       flag: '🇭🇷', confederation: 'UEFA' },
  { code: 'SUI', name: 'Switzerland',   flag: '🇨🇭', confederation: 'UEFA' },
  { code: 'AUT', name: 'Austria',       flag: '🇦🇹', confederation: 'UEFA' },
  { code: 'DEN', name: 'Denmark',       flag: '🇩🇰', confederation: 'UEFA' },
  { code: 'POL', name: 'Poland',        flag: '🇵🇱', confederation: 'UEFA' },
  { code: 'TUR', name: 'Türkiye',       flag: '🇹🇷', confederation: 'UEFA' },
  { code: 'NOR', name: 'Norway',        flag: '🇳🇴', confederation: 'UEFA' },
  { code: 'SWE', name: 'Sweden',        flag: '🇸🇪', confederation: 'UEFA' },
  { code: 'SRB', name: 'Serbia',        flag: '🇷🇸', confederation: 'UEFA' },
  { code: 'UKR', name: 'Ukraine',       flag: '🇺🇦', confederation: 'UEFA' },
  { code: 'USA', name: 'United States', flag: '🇺🇸', confederation: 'CONCACAF' },
  { code: 'MEX', name: 'Mexico',        flag: '🇲🇽', confederation: 'CONCACAF' },
  { code: 'CAN', name: 'Canada',        flag: '🇨🇦', confederation: 'CONCACAF' },
  { code: 'CRC', name: 'Costa Rica',    flag: '🇨🇷', confederation: 'CONCACAF' },
  { code: 'JAM', name: 'Jamaica',       flag: '🇯🇲', confederation: 'CONCACAF' },
  { code: 'PAN', name: 'Panama',        flag: '🇵🇦', confederation: 'CONCACAF' },
  { code: 'MAR', name: 'Morocco',       flag: '🇲🇦', confederation: 'CAF' },
  { code: 'SEN', name: 'Senegal',       flag: '🇸🇳', confederation: 'CAF' },
  { code: 'NGA', name: 'Nigeria',       flag: '🇳🇬', confederation: 'CAF' },
  { code: 'EGY', name: 'Egypt',         flag: '🇪🇬', confederation: 'CAF' },
  { code: 'ALG', name: 'Algeria',       flag: '🇩🇿', confederation: 'CAF' },
  { code: 'CIV', name: 'Ivory Coast',   flag: '🇨🇮', confederation: 'CAF' },
  { code: 'TUN', name: 'Tunisia',       flag: '🇹🇳', confederation: 'CAF' },
  { code: 'CMR', name: 'Cameroon',      flag: '🇨🇲', confederation: 'CAF' },
  { code: 'GHA', name: 'Ghana',         flag: '🇬🇭', confederation: 'CAF' },
  { code: 'JPN', name: 'Japan',         flag: '🇯🇵', confederation: 'AFC' },
  { code: 'KOR', name: 'South Korea',   flag: '🇰🇷', confederation: 'AFC' },
  { code: 'IRN', name: 'Iran',          flag: '🇮🇷', confederation: 'AFC' },
  { code: 'AUS', name: 'Australia',     flag: '🇦🇺', confederation: 'AFC' },
  { code: 'KSA', name: 'Saudi Arabia',  flag: '🇸🇦', confederation: 'AFC' },
  { code: 'QAT', name: 'Qatar',         flag: '🇶🇦', confederation: 'AFC' },
  { code: 'UZB', name: 'Uzbekistan',    flag: '🇺🇿', confederation: 'AFC' },
  { code: 'JOR', name: 'Jordan',        flag: '🇯🇴', confederation: 'AFC' },
  { code: 'NZL', name: 'New Zealand',   flag: '🇳🇿', confederation: 'OFC' },
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

export default function CupPredictionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
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
      } else if (res.status === 403 && /Join/i.test(d.error)) {
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
      } else if (res.status === 403 && /Join/i.test(d.error)) {
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
      {/* Back to club + title */}
      <div className="flex items-center gap-3 mb-4">
        <Link href={`/clubs/${slug}`} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">🏆 Smileys Cup Predictions</h1>
          <p className="text-xs text-gray-500">{ROUND_LABEL.r32} · {ROUND_LABEL.r16} · {ROUND_LABEL.qf} · {ROUND_LABEL.sf} · {ROUND_LABEL.final}</p>
        </div>
      </div>

      {/* Non-member CTAs */}
      {accessState === 'unauthenticated' && (
        <div className="bg-white border border-amber-200 rounded-2xl p-5 mb-4 shadow-sm">
          <p className="font-bold text-gray-900 mb-1">Want to play?</p>
          <p className="text-sm text-gray-600 mb-3">The Smileys Cup is for members. Apply to join, get accepted, then come back here to lock in your bracket.</p>
          <button onClick={() => router.push('/apply')}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
            Apply to Smileys
          </button>
        </div>
      )}
      {accessState === 'not-member' && (
        <div className="bg-white border border-amber-200 rounded-2xl p-5 mb-4 shadow-sm">
          <p className="font-bold text-gray-900 mb-1">Join the cup club</p>
          <p className="text-sm text-gray-600 mb-3">You're a Smileys member — one more step. Join the Cup club to lock in your bracket and start picking matches.</p>
          <Link href={`/clubs/${slug}`}
            className="block w-full text-center py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
            Join the Cup club →
          </Link>
        </div>
      )}

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
            <p className="text-[10px] text-gray-400 mt-1">Leaderboard arrives tomorrow</p>
          </div>
        </div>
      )}

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

      {/* Fixtures by round */}
      <div className="mt-5 space-y-5">
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
