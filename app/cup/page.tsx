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

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CUP_TEAMS as TEAMS, TEAM_BY_CODE, teamLabel, ROUND_LABEL, isFixtureLocked } from '@/lib/cup-data'

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

// TEAMS, TEAM_BY_CODE, teamLabel, ROUND_LABEL all imported from
// @/lib/cup-data — single source so a roster correction lives in
// one file across server + member page + admin page.

export default function CupPredictionsPage() {
  const router = useRouter()

  const [fixtures, setFixtures] = useState<Fixture[] | null>(null)
  const [bracket,  setBracket]  = useState<BracketResponse | null>(null)
  const [loading,  setLoading]  = useState(true)
  // Bracket draft — separate from the saved bracket so the user can
  // edit + cancel without losing the current state. Initialised
  // from server on first load and on save.
  // Bracket draft persisted to localStorage. A page refresh mid-
  // bracket used to drop the picks; now it survives. Cleared on
  // successful save (the saved bracket itself is the source of
  // truth after that).
  const [draftChampion, setDraftChampion] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem('cup-bracket-draft-champion')
  })
  const [draftSF,       setDraftSF]       = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = window.localStorage.getItem('cup-bracket-draft-sf')
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.filter((s: unknown): s is string => typeof s === 'string') : []
    } catch { return [] }
  })
  const [editingBracket, setEditingBracket] = useState(false)
  const [savingBracket,  setSavingBracket]  = useState(false)
  const [savingFixtureId, setSavingFixtureId] = useState<string | null>(null)
  // Membership state from the bracket endpoint's error handling.
  // We set this to 'unauthenticated' or 'not-member' so the UI can
  // render the right empty state.
  const [accessState, setAccessState] = useState<'loading' | 'member' | 'not-member' | 'unauthenticated'>('loading')

  // Group-stage view: collapsible by group letter (the structural
  // mental model — useful pre-tournament for filling out 6 picks
  // in one sit) OR chronological by day (the watching-along
  // mental model — useful from MD1 onward when "what's today?" is
  // the question). Smart default flips at first kickoff. User's
  // explicit choice persists in localStorage so the toggle sticks.
  const [groupStageView, setGroupStageView] = useState<'group' | 'date'>(() => {
    if (typeof window === 'undefined') return 'group'
    const stored = window.localStorage.getItem('cup-stage-view')
    if (stored === 'group' || stored === 'date') return stored
    const cupStart = new Date('2026-06-11T21:00:00+03:00')
    return new Date() < cupStart ? 'group' : 'date'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('cup-stage-view', groupStageView)
  }, [groupStageView])

  useEffect(() => {
    // Keep the raw Response objects so we can read .status directly
    // instead of smuggling a sentinel through the JSON body. The
    // previous shape {__status: 401} mixed transport state with
    // payload — fine for one consumer, fragile if anyone else (a
    // test, an unwrap helper) tried to use the payload.
    Promise.all([
      fetch('/app/api/cup/fixtures', { credentials: 'include' }),
      fetch('/app/api/cup/bracket',  { credentials: 'include' }),
    ])
      .then(async ([fxRes, brRes]) => {
        if (fxRes.ok) {
          const fxData = await fxRes.json()
          if (fxData.fixtures) setFixtures(fxData.fixtures)
        }
        if (brRes.status === 401) {
          setAccessState('unauthenticated')
        } else if (brRes.ok) {
          setBracket(await brRes.json())
          // Any 2xx on /bracket means we have a session. Membership
          // gating is enforced at write time (403 from /predict +
          // /bracket POST) — not here, so the page can still render
          // for pending applicants.
          setAccessState('member')
        }
      })
      .finally(() => setLoading(false))
  }, [])

  // Prime the draft once when the saved bracket first arrives. A
  // ref gates this so any later background bracket update (poll, a
  // future re-fetch) can't overwrite a draft the user is mid-typing.
  // The cancel flow explicitly resets the draft via onCancelEdit
  // when the user backs out, so the one-shot init is enough.
  // When the saved bracket primes, it overwrites any localStorage
  // draft — saved truth wins over in-progress edit.
  const draftPrimedRef = useRef(false)
  useEffect(() => {
    if (bracket?.bracket && !draftPrimedRef.current) {
      setDraftChampion(bracket.bracket.championPick)
      setDraftSF(bracket.bracket.semifinalists)
      draftPrimedRef.current = true
    }
  }, [bracket])

  // Persist the draft to localStorage on every change so a refresh
  // mid-bracket doesn't drop the picks. Both keys cleared on
  // successful save (see saveBracket below).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (draftChampion) window.localStorage.setItem('cup-bracket-draft-champion', draftChampion)
    else window.localStorage.removeItem('cup-bracket-draft-champion')
  }, [draftChampion])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('cup-bracket-draft-sf', JSON.stringify(draftSF))
  }, [draftSF])

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
        // Drop the localStorage draft now that the saved bracket
        // is the source of truth.
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('cup-bracket-draft-champion')
          window.localStorage.removeItem('cup-bracket-draft-sf')
        }
        toast.success('Bracket locked in ⚽')
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
        // Tiny haptic on mobile — makes the pick feel more tactile.
        // navigator.vibrate is a no-op on desktop and on iOS Safari,
        // so guarded but harmless.
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(15)
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
    // Skeleton sized to match the final layout (banner aspect ~2.5:1,
    // rules card, bracket card, leaderboard rows) so the page
    // doesn't jolt when content arrives — a fixed-shape skeleton
    // gives the eye an anchor.
    return <Shell>
      <div className="space-y-4">
        <div className="rounded-2xl bg-gray-100 animate-pulse" style={{ aspectRatio: '2.5 / 1' }} />
        <div className="h-16 rounded-2xl bg-gray-100 animate-pulse" />
        <div className="h-44 rounded-2xl bg-gray-100 animate-pulse" />
        <div className="bg-gray-100 rounded-2xl p-3 animate-pulse">
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-white/40 rounded" />)}
          </div>
        </div>
      </div>
    </Shell>
  }

  const bracketLocked = bracket?.locked ?? false
  // Score + pick-progress used to live in a standalone header
  // here; both are now carried by the Leaderboard's pinned "you"
  // row (see component below) so we don't duplicate the number.

  return (
    <LeaderboardProvider>
    <Shell>
      {/* Hero banner — SVG illustration carries the title, dates,
          and tagline. Pure vector so it crisps at any density
          without shipping a raster. The SVG's natural aspect is
          2.5:1; we crop progressively wider as the viewport grows
          (16:5 on mobile, 3:1 on sm, 4:1 on lg+) so the banner
          spans the full shell width on desktop without becoming a
          billboard — at lg+ the box is 1024×256, same height as
          the old narrower lg:max-w-3xl crop but page-wide. The
          SVG's own `xMidYMid slice` rule keeps the trophy + text
          centered in the kept band; only some decorative confetti
          at the very top/bottom edges gets trimmed. The h1 stays
          in the DOM as sr-only so screen readers and search
          engines still get a proper heading. Lives OUTSIDE the
          narrow above-the-fold wrapper below so the banner can
          match the page width while Countdown + visitor hero
          stay at a comfortable reading width. */}
      <div className="rounded-2xl overflow-hidden shadow-card mb-4 aspect-[16/5] sm:aspect-[3/1] lg:aspect-[4/1]">
        <img src="/app/images/cup-banner.svg" alt="Smileys World Cup 2026 — Jun 11 to Jul 19, predict every match"
          className="w-full h-full object-cover block" loading="eager" decoding="async" />
      </div>
      <h1 className="sr-only">Smileys World Cup 2026 prediction game</h1>

      {/* Above-the-fold reading area — countdown + visitor hero.
          Capped at max-w-3xl on lg+ so the long-form content
          doesn't span the full wide column (banner above does);
          keeps line lengths comfortable. Centered. */}
      <div className="lg:max-w-3xl lg:mx-auto">
      {/* Countdown strip — drives urgency. Pre-kickoff shows the
          time until brackets lock. Post-kickoff shows time to the
          next upcoming match. Hidden when the tournament is over
          or fixtures haven't loaded yet. */}
      <Countdown fixtures={fixtures} />

      {/* Visitor hero — 3-step path to play. Replaces the old
          two-line "Want to play?" tile because a visitor needs to
          see the *shape* of joining (it's curated, not instant)
          before they tap Apply. Mobile-first: stacked steps with
          generous tap targets and a big primary CTA. Pending
          members get their own state below — same shell, different
          status to set expectations on timing. */}
      {accessState === 'unauthenticated' && (
        <div className="bg-white rounded-2xl shadow-card mb-4 overflow-hidden">
          <div className="bg-gradient-to-br from-amber-400 to-amber-600 px-5 py-5 text-white">
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-90 mb-1">Free to play · members only</p>
            <p className="text-lg sm:text-xl font-extrabold leading-snug">Predict every match. Climb the board. Win prizes.</p>
          </div>
          <div className="p-5">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3">How to join</p>
            <ol className="space-y-3">
              <li className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 font-bold text-sm flex items-center justify-center shrink-0">1</span>
                <div className="flex-1 min-w-0 pt-0.5">
                  <p className="text-sm font-bold text-gray-900 leading-tight">Apply to Smileys</p>
                  <p className="text-xs text-gray-500 mt-0.5">Quick form. We&apos;re curated — tell us about you.</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 font-bold text-sm flex items-center justify-center shrink-0">2</span>
                <div className="flex-1 min-w-0 pt-0.5">
                  <p className="text-sm font-bold text-gray-900 leading-tight">Get accepted</p>
                  <p className="text-xs text-gray-500 mt-0.5">Usually 1–3 days. Watch your inbox.</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 font-bold text-sm flex items-center justify-center shrink-0">3</span>
                <div className="flex-1 min-w-0 pt-0.5">
                  <p className="text-sm font-bold text-gray-900 leading-tight">Come back &amp; play</p>
                  <p className="text-xs text-gray-500 mt-0.5">Lock in your bracket, pick each match, climb the board.</p>
                </div>
              </li>
            </ol>
            <button onClick={() => router.push('/apply')}
              className="w-full py-3.5 mt-5 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-base font-bold rounded-xl transition-colors shadow-sm">
              Apply to play →
            </button>
            <p className="text-[11px] text-gray-400 text-center mt-2">Free · no payment · ~5 min to apply</p>
            {/* Visitor share — small secondary CTA. A friend who'd
                also fit Smileys is the cleanest convert. */}
            <ShareButton variant="visitor" />
          </div>
        </div>
      )}
      {accessState === 'not-member' && (
        <div className="bg-white rounded-2xl shadow-card mb-4 overflow-hidden">
          <div className="bg-gradient-to-br from-amber-100 to-amber-200 px-5 py-4">
            <p className="text-[10px] font-bold text-amber-800 uppercase tracking-widest mb-1">Step 2 of 3</p>
            <p className="text-base font-extrabold text-amber-900 leading-snug">You&apos;re in the queue 🙌</p>
          </div>
          <div className="p-5">
            <p className="text-sm text-gray-700 leading-relaxed">Your application is being reviewed. Most decisions land within 1–3 days. As soon as you&apos;re in, this page unlocks and you can pick your bracket and matches.</p>
            <p className="text-xs text-gray-400 mt-3">Want to nudge it? Check your email — we may have written.</p>
          </div>
        </div>
      )}
      </div> {/* end above-the-fold compact area */}

      {/* Two-column layout from lg+. On mobile + small tablet the
          grid collapses to a single stack — `lg:grid` is the only
          breakpoint switch. Right column (rules / FAQ / watch
          parties / prizes) is the "context" sidebar; left column
          is the active game (bracket / trending / leaderboard /
          fixtures). On desktop the sidebar is sticky so it stays
          visible while the long fixtures list scrolls.
          On mobile, HTML order = visual order: gameplay first
          (you came to play, not to read), then context below. */}
      {/* Three grid children on lg+:
            (1) main = bracket / leaderboard / etc.  (col 1, row 1)
            (2) aside = context cards              (col 2, rows 1–2, sticky)
            (3) fixtures section                    (col 1, row 2)
          On mobile the wrapper is a plain block stack so the DOM
          order — main → aside → fixtures — IS the visual order.
          That lifts the sidebar above the 100+ row fixtures list so
          new visitors don't have to scroll past every match to find
          the Rules / FAQ / Watch parties / Prizes cards. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6 lg:items-start">
        {/* ── Main column ───────────────────────────────────── */}
        <main className="space-y-4 min-w-0 lg:col-start-1 lg:row-start-1">
          {!bracketLocked && accessState === 'member' && (
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
          )}

          {/* Push opt-in — only renders for members on devices that
              support web push, haven't already subscribed, and
              haven't dismissed the strip. Single-tap enable; dismiss
              persists in localStorage so we don't nag. */}
          {accessState === 'member' && <PushOptInStrip />}

          {/* Trending vs Leaderboard ordering flips at first kickoff
              (bracketLocked === true → tournament is running).
              Pre-tournament: Trending first — "what are people
              picking?" is the most interesting thing while everyone
              is still locking in brackets and the leaderboard is all
              zeros. Post-kickoff: Leaderboard first — the live
              competitive signal ("who's ahead, where am I?") is
              what people are checking, and Trending becomes context
              for upcoming matches. Same components either way; only
              the order swaps. */}
          {bracketLocked ? (
            <>
              <Leaderboard />
              <TrendingPicks />
            </>
          ) : (
            <>
              <TrendingPicks />
              <Leaderboard />
            </>
          )}

          {/* Compact bracket summary — only after lock. */}
          {bracketLocked && (
            <BracketSummary
              bracket={bracket?.bracket ?? null}
              accessState={accessState}
            />
          )}
        </main>

        {/* ── Right sidebar — context cards ──────────────────────
            Sticky on lg+ (sits within col 2, spans both rows so
            sticky tracks the full main+fixtures scroll). On mobile
            this aside is the SECOND child of the wrapper, so it
            renders between the main column and the fixtures section
            — Rules / FAQ / Prizes are no longer buried under 100+
            fixture rows. Ordering inside is the reading priority:
            rules first (orientation), FAQ (common questions), then
            community (watch parties + prizes), share at the end. */}
        <aside className="space-y-4 mt-4 lg:mt-0 lg:sticky lg:top-4 min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-2">
          <RulesCard defaultOpen={accessState !== 'member'} />
          {/* Your rank — desktop-only compact card showing your row
              ±2. Pairs with the full Leaderboard in the main column:
              that one stays high in the reading order on mobile, this
              one is the always-visible "where am I" glance for
              desktop users scrolling through 103 fixtures. */}
          {accessState === 'member' && <MiniRankCard />}
          <FAQCard />
          <WatchParties />
          <PrizesSection />
          {/* Share — lives at the bottom of the sidebar as a final
              "spread the word" beat. Members only; visitors get the
              embedded share row inside their apply hero instead. */}
          {accessState === 'member' && <ShareButton variant="member" />}
        </aside>

        {/* ── Fixtures ─────────────────────────────────────────
            Separate grid child so the sidebar can slot between the
            main column and this list on mobile. On desktop it
            lives in row 2 of column 1, directly under the main
            content; the sticky aside in column 2 tracks both rows. */}
        <section className="space-y-5 mt-4 lg:mt-0 min-w-0 lg:col-start-1 lg:row-start-2">
        {/* Group stage — view toggle: by group (structural) vs by
            date (chronological). Smart default flips at first
            kickoff; user's explicit choice persists in
            localStorage. */}
        {(byRound.group?.length ?? 0) > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2 px-1 gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-gray-800">{ROUND_LABEL.group}</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">
                  1 pt each · 72 matches
                </span>
                {/* ARIA radiogroup so assistive tech reads this as
                    a mutually-exclusive choice, not two unrelated
                    buttons. Each option carries aria-checked so the
                    current selection is announced when focused. */}
                <div role="radiogroup" aria-label="Group stage view"
                  className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
                  {(['group', 'date'] as const).map(v => (
                    <button key={v} onClick={() => setGroupStageView(v)}
                      role="radio" aria-checked={groupStageView === v}
                      aria-label={`Sort group stage by ${v}`}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors ${
                        groupStageView === v
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}>
                      By {v}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {groupStageView === 'group' ? (
              <GroupStageSections
                rows={byRound.group ?? []}
                savingFixtureId={savingFixtureId}
                canPick={accessState === 'member'}
                onPick={pickFixture}
              />
            ) : (
              <DateStageSections
                rows={byRound.group ?? []}
                savingFixtureId={savingFixtureId}
                canPick={accessState === 'member'}
                onPick={pickFixture}
              />
            )}
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
        </section>
      </div>
    </Shell>
    </LeaderboardProvider>
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
      init[letter] = byGroup[letter].some(f => !isFixtureLocked(f.kickoffAt))
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
        const lockedInGroup    = list.filter(f => isFixtureLocked(f.kickoffAt)).length
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

// Group-stage rendered chronologically. Sections by Istanbul-day
// boundary, days sorted ASC, matches within a day sorted by
// kickoff. Headers read "Thu · Jun 11 · 4 matches" so the day is
// the obvious unit. Today's section gets an amber highlight so
// the "what's now" question is one glance.
function DateStageSections({
  rows, savingFixtureId, canPick, onPick,
}: {
  rows: Fixture[]
  savingFixtureId: string | null
  canPick: boolean
  onPick: (fixtureId: string, team: string) => void
}) {
  // Bucket by Istanbul-day key so a 23:00 Istanbul kickoff doesn't
  // bleed into the next day.
  const byDay = useMemo(() => {
    const map = new Map<string, Fixture[]>()
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
    })
    for (const r of rows) {
      const key = fmt.format(new Date(r.kickoffAt))
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    return Array.from(map.entries())
      .map(([key, list]) => ({
        dayKey: key,
        date:   new Date(`${key}T00:00:00+03:00`),
        list:   list.sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt)),
      }))
      .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
  }, [rows])

  const todayKey = useMemo(() => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()), [])

  // Show the "Today" shortcut only when today's date matches one
  // of the seeded match days. Outside the tournament window
  // (pre-Jun 11, post-Jun 27) the button would just scroll into
  // empty space, so we hide it.
  const todayInWindow = byDay.some(d => d.dayKey === todayKey)
  function scrollToToday() {
    const el = document.getElementById(`cup-day-${todayKey}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="space-y-3">
      {todayInWindow && (
        <div className="flex justify-end -mt-1 mb-1">
          <button onClick={scrollToToday}
            className="text-[10px] font-bold uppercase tracking-wider text-amber-600 hover:text-amber-700 px-2 py-1 rounded-lg hover:bg-amber-50 transition-colors">
            ↓ Today
          </button>
        </div>
      )}
      {byDay.map(d => {
        const isToday = d.dayKey === todayKey
        const isPast  = d.dayKey < todayKey
        const dayLabel = d.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
        return (
          <div key={d.dayKey} id={`cup-day-${d.dayKey}`} className={`bg-white rounded-2xl border shadow-sm overflow-hidden scroll-mt-4 ${
            isToday ? 'border-amber-300 ring-1 ring-amber-200' : 'border-gray-100'
          }`}>
            <div className={`px-4 py-2.5 border-b flex items-center justify-between ${
              isToday ? 'bg-amber-50 border-amber-100' : isPast ? 'bg-gray-50/40 border-gray-100' : 'border-gray-100'
            }`}>
              <div className="flex items-center gap-2 flex-wrap">
                {isToday && <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Today</span>}
                <p className={`text-sm font-bold ${isToday ? 'text-amber-900' : 'text-gray-900'}`}>{dayLabel}</p>
              </div>
              <p className="text-[10px] text-gray-500">
                {d.list.length} match{d.list.length === 1 ? '' : 'es'}
              </p>
            </div>
            <div className="px-3 py-3 space-y-2">
              {d.list.map(f => (
                <FixtureRow
                  key={f.id}
                  fixture={f}
                  saving={savingFixtureId === f.id}
                  canPick={canPick}
                  onPick={(team) => onPick(f.id, team)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Post-lock bracket summary — one row. Surfaces the champion +
// 4 semifinalists you submitted without the full picker visual.
// Lives below the leaderboard since once results are landing the
// leaderboard is what you want to read; bracket is reference.
function BracketSummary({ bracket, accessState }: { bracket: BracketPick | null; accessState: 'loading' | 'member' | 'not-member' | 'unauthenticated' }) {
  // Members who didn't submit a bracket: surface that explicitly
  // so they know what they missed (or so it nudges them to
  // remember next time).
  if (accessState === 'member' && !bracket) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-3.5 mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Your bracket</p>
          <p className="text-sm text-gray-700 mt-0.5">Didn&apos;t submit · bracket points locked at 0</p>
        </div>
        <span className="text-xs text-gray-400">0 / 200 pts</span>
      </div>
    )
  }
  if (!bracket) return null
  return (
    <div className="bg-white rounded-2xl shadow-card p-3.5 mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">Your bracket</p>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-base shrink-0">👑</span>
            <span className="font-bold text-gray-900">{teamLabel(bracket.championPick)}</span>
          </div>
          <div className="flex items-center gap-1 text-xs">
            {bracket.semifinalists.map(code => {
              const t = TEAM_BY_CODE.get(code)
              return <span key={code} title={t?.name ?? code} className="text-base">{t?.flag ?? code}</span>
            })}
          </div>
        </div>
        <span className="text-xs font-bold text-amber-600 tabular-nums whitespace-nowrap">
          {bracket.pointsAwarded} / 200 pts
        </span>
      </div>
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
  // Hoist the row to a non-null local so the JSX doesn't repeat
  // `bracket?.x` / `bracket!.x` six times. Cleaner read, and the
  // non-null assertions go away.
  const row     = bracket
  const hasRow  = row !== null
  const lockMsg = tournamentStartAt
    ? `Locks at first kickoff · ${new Date(tournamentStartAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    : 'Locks at first kickoff'

  return (
    <div className="bg-white rounded-2xl shadow-card p-5 mb-4">
      <div className="flex items-start justify-between mb-3 gap-2">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Your bracket</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {locked ? 'Locked — tournament has started' : lockMsg}
          </p>
        </div>
        <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider shrink-0">
          {(row?.pointsAwarded ?? 0)} / 200 pts
        </span>
      </div>

      {/* Read-only state */}
      {!editing && hasRow && row && (
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Champion · 100 pts</p>
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
              <span className="text-lg">👑</span>
              <span className="text-sm font-bold text-gray-900">{teamLabel(row.championPick)}</span>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Semifinalists · 25 pts each</p>
            <div className="grid grid-cols-2 gap-2">
              {row.semifinalists.map(code => (
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

      {/* Empty state. The page gates the entire BracketCard behind
          `accessState === 'member' && !bracketLocked`, so `canEdit`
          is always true when this branch renders. The previous
          `!canEdit` fallback ("Join the cup club to play") was a
          dead code path left over from the standalone-page
          migration. */}
      {!editing && !hasRow && (
        <div className="text-center py-4">
          <p className="text-sm text-gray-500 mb-3">No bracket yet. Pick your champion + 4 semifinalists before first kickoff.</p>
          <button onClick={onStartEdit}
            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
            Lock in your bracket
          </button>
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
                    👑 {teamLabel(code)}
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
  // Recompute locked at render time via the shared helper rather
  // than trusting the server's `fixture.locked` flag (which goes
  // stale as the page sits open). Same predicate as the server
  // validator in /api/cup/predict.
  const locked = isFixtureLocked(fixture.kickoffAt)

  // Live window — kickoff has happened, the 90-minute match plus
  // ~15-min half-time / stoppage hasn't ended yet, and the admin
  // hasn't recorded a result. Ticks every 30s so a fixture flips
  // to LIVE without a page reload. We skip the tick entirely for
  // fixtures clearly outside the window (avoids 100+ timers on a
  // mostly-static list of past + far-future matches).
  const kickoffMs   = Date.parse(fixture.kickoffAt)
  const liveEndsMs  = kickoffMs + 105 * 60 * 1000
  const [nowMs, setNowMs] = useState(() => Date.now())
  const couldTransition = !fixture.winnerTeam && nowMs >= kickoffMs - 60 * 60_000 && nowMs < liveEndsMs
  useEffect(() => {
    if (!couldTransition) return
    const t = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [couldTransition])
  const isLive = !fixture.winnerTeam && nowMs >= kickoffMs && nowMs < liveEndsMs

  return (
    <div className={`bg-white rounded-2xl border p-3.5 shadow-sm ${
      isLive ? 'border-red-300 ring-2 ring-red-100'
        : correct ? 'border-green-200 bg-green-50/40'
        : wrong ? 'border-red-200 bg-red-50/40'
        : 'border-gray-100'
    }`}>
      {/* Header: kickoff + group letter on the left, lock/result
          on the right. Group letter helps the by-date view stay
          structural ("oh, this is a Group A match") and adds
          context to the by-group view for free. */}
      <div className="flex items-center justify-between mb-2 text-[10px] text-gray-500 font-semibold uppercase tracking-wider gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          {isLive && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-red-500 text-white rounded-full text-[9px] font-extrabold uppercase tracking-wider">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inset-0 rounded-full bg-white opacity-75 animate-ping" />
                <span className="relative w-1.5 h-1.5 rounded-full bg-white" />
              </span>
              LIVE
            </span>
          )}
          <span>{kickoff}</span>
          {fixture.group && <span className="text-amber-600">· Group {fixture.group}</span>}
        </div>
        {locked && fixture.winnerTeam && (
          <span className="text-amber-600 text-right">
            {fixture.homeScore}–{fixture.awayScore} · Winner: {teamLabel(fixture.winnerTeam)}
          </span>
        )}
        {locked && !fixture.winnerTeam && !isLive && <span className="text-gray-400">Locked</span>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <FixturePickButton
          label={homeLabel}
          team={fixture.homeTeam}
          isPicked={yourPick === fixture.homeTeam}
          isWinner={fixture.winnerTeam === fixture.homeTeam}
          disabled={!canPick || locked || saving || tbd}
          onClick={() => fixture.homeTeam && onPick(fixture.homeTeam)}
        />
        <FixturePickButton
          label={awayLabel}
          team={fixture.awayTeam}
          isPicked={yourPick === fixture.awayTeam}
          isWinner={fixture.winnerTeam === fixture.awayTeam}
          disabled={!canPick || locked || saving || tbd}
          onClick={() => fixture.awayTeam && onPick(fixture.awayTeam)}
        />
      </div>

      {tbd && !locked && (
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
  // min-w-0 + truncate so long names ("Bosnia-Herzegovina",
  // "United States") don't push the 2-column grid wider than the
  // viewport on small phones.
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-2.5 rounded-xl text-xs sm:text-sm font-bold border transition-colors min-w-0 ${cls}`}>
      <span className="truncate">{label}</span>
      {isPicked && !isWinner && <span className="text-xs opacity-80 shrink-0">✓</span>}
    </button>
  )
}

// Share affordance — explicit per-platform buttons (WhatsApp, X,
// Telegram, Copy link) so the share path is obvious and one tap
// each. On mobile, the platform deep-links open the app directly;
// on desktop the same URLs open the platform web composer.
//
// Variants tune the surrounding copy + chrome:
//   • visitor: minimal row beneath the apply CTA
//   • member:  full tile after the leaderboard with "show off" tone
//   • compact: bare row of icons, no surrounding card (used inside
//              the Prizes section)
function ShareButton({ variant }: { variant: 'visitor' | 'member' | 'compact' }) {
  const url  = typeof window !== 'undefined' ? window.location.href : 'https://smileyscommunity.com/app/cup'
  const text = 'Smileys World Cup 2026 — predict every match. Prizes for the winner. Worth a look?'

  const u = encodeURIComponent(url)
  const t = encodeURIComponent(text)
  const links = {
    // wa.me on mobile opens WhatsApp directly, on desktop opens web.
    whatsapp: `https://wa.me/?text=${t}%20${u}`,
    x:        `https://twitter.com/intent/tweet?text=${t}&url=${u}`,
    telegram: `https://t.me/share/url?url=${u}&text=${t}`,
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied — paste into your story or DM')
    } catch {
      toast.error('Could not copy — long-press the URL bar')
    }
  }

  const iconBtn = 'w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center transition-colors shrink-0'
  const buttons = (
    <div className="flex items-center justify-center gap-2">
      <a href={links.whatsapp} target="_blank" rel="noopener noreferrer"
        aria-label="Share on WhatsApp"
        className={`${iconBtn} bg-[#25D366] hover:bg-[#1ebd58] text-white`}>
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2.1-.4 0-.5 0-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.7.4-.2.3-1 .9-1 2.2 0 1.3 1 2.6 1.1 2.7.1.2 1.9 3.1 4.7 4.2.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.1-1.3-.1-.1-.2-.2-.5-.3zM12 2C6.5 2 2 6.5 2 12c0 1.9.5 3.6 1.4 5.1L2 22l5-1.4c1.4.8 3.1 1.3 5 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18.2c-1.6 0-3.2-.4-4.5-1.2l-.3-.2-3.3.9.9-3.2-.2-.3C3.7 14.9 3.3 13.5 3.3 12c0-4.8 3.9-8.7 8.7-8.7 4.8 0 8.7 3.9 8.7 8.7 0 4.8-3.9 8.7-8.7 8.7z"/></svg>
      </a>
      <a href={links.x} target="_blank" rel="noopener noreferrer"
        aria-label="Share on X"
        className={`${iconBtn} bg-black hover:bg-zinc-800 text-white`}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      </a>
      <a href={links.telegram} target="_blank" rel="noopener noreferrer"
        aria-label="Share on Telegram"
        className={`${iconBtn} bg-[#229ED9] hover:bg-[#1c8bbf] text-white`}>
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>
      </a>
      <button onClick={copyLink}
        aria-label="Copy link"
        className={`${iconBtn} bg-amber-500 hover:bg-amber-600 text-white`}>
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      </button>
    </div>
  )

  if (variant === 'compact') {
    return <div className="mt-3">{buttons}</div>
  }
  if (variant === 'visitor') {
    return (
      <div className="mt-4 pt-4 border-t border-amber-100">
        <p className="text-[10px] text-gray-500 text-center mb-2 uppercase tracking-widest font-bold">Know someone who&apos;d fit? Share →</p>
        {buttons}
      </div>
    )
  }
  return (
    <div className="bg-white rounded-2xl shadow-card mb-4 px-5 py-4">
      <p className="text-sm font-bold text-gray-900 text-center mb-1">Share the cup</p>
      <p className="text-[11px] text-gray-500 text-center mb-3">Drop it in your group chat. Friends who&apos;d fit Smileys apply through this page.</p>
      {buttons}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Countdown strip — small banner directly under the hero. Two
// modes:
//   • Pre-kickoff: time until the first fixture (= bracket lock).
//   • Tournament running: time until the next upcoming match.
// Hidden when fixtures haven't loaded or every match has kicked
// off. Source of truth is the fixtures payload (public), so the
// countdown works for visitors too.
// ─────────────────────────────────────────────────────────────────
function Countdown({ fixtures }: { fixtures: Fixture[] | null }) {
  // Tick once a second so the readout stays current. Mounted only
  // when fixtures are available — otherwise the interval doesn't
  // fire and the component renders null.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  if (!fixtures || fixtures.length === 0) return null

  // First kickoff = tournament start = bracket lock.
  const firstMs = Math.min(...fixtures.map(f => new Date(f.kickoffAt).getTime()))
  // Next upcoming match — used after tournament starts.
  const nextMatch = fixtures
    .filter(f => new Date(f.kickoffAt).getTime() > now)
    .sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime())[0]

  const preKickoff = now < firstMs
  if (!preKickoff && !nextMatch) return null  // Tournament complete

  const target = preKickoff ? firstMs : new Date(nextMatch!.kickoffAt).getTime()
  const label = preKickoff
    ? 'Brackets lock at first whistle'
    : nextMatch!.homeTeam && nextMatch!.awayTeam
      ? `Next: ${teamLabel(nextMatch!.homeTeam)} vs ${teamLabel(nextMatch!.awayTeam)}`
      : 'Next match'

  const tone = preKickoff ? 'amber' : 'sky'
  const icon = preKickoff ? '⏱️' : '⚽'

  return (
    <div className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl mb-4 border ${
      tone === 'amber'
        ? 'bg-amber-50 border-amber-200'
        : 'bg-sky-50 border-sky-200'
    }`}>
      <span className="text-base shrink-0" aria-hidden="true">{icon}</span>
      <p className={`text-xs font-bold ${tone === 'amber' ? 'text-amber-900' : 'text-sky-900'} text-center`}>
        {label} <span className={`tabular-nums ${tone === 'amber' ? 'text-amber-700' : 'text-sky-700'} ml-1`}>{formatRemaining(target - now)}</span>
      </p>
    </div>
  )
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'now'
  const sec   = Math.floor(ms / 1000)
  const days  = Math.floor(sec / 86400)
  const hours = Math.floor((sec % 86400) / 3600)
  const mins  = Math.floor((sec % 3600) / 60)
  const s     = sec % 60
  // Granularity scales down as the deadline approaches: days +
  // hours + minutes when far out, seconds only in the final
  // minute. Reads as "11d 4h 12m" → "4h 12m" → "12m 34s" → "34s".
  if (days  >= 1) return `${days}d ${hours}h ${mins}m`
  if (hours >= 1) return `${hours}h ${mins}m`
  if (mins  >= 1) return `${mins}m ${s}s`
  return `${s}s`
}

// ─────────────────────────────────────────────────────────────────
// Prizes section + Donate modal.
// Renders the active prize board (podium ranks 1/2/3 + spot prizes
// below) and exposes a CTA to submit a prize donation. Public —
// the modal opens for anyone, members or visitors.
// ─────────────────────────────────────────────────────────────────
interface PrizeRow {
  id: string; title: string; description: string | null
  imageUrl: string | null; rank: number | null; status: string
  sponsor: { id: string; slug: string; name: string; blurb: string | null
    logoUrl: string | null; websiteUrl: string | null; instagramUrl: string | null
  } | null
}

const RANK_LABEL: Record<number, string> = { 1: '🥇 1st', 2: '🥈 2nd', 3: '🥉 3rd' }

function PrizesSection() {
  const [prizes, setPrizes] = useState<PrizeRow[] | null>(null)
  const [showDonate, setShowDonate] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/app/api/cup/prizes', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive && d?.prizes) setPrizes(d.prizes) })
    return () => { alive = false }
  }, [])

  if (prizes === null) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-5 mb-4">
        <div className="h-5 w-1/3 bg-gray-100 rounded animate-pulse mb-3" />
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      </div>
    )
  }

  // Empty state — still show the section because the Donate CTA is
  // the whole point. Calls for offers explicitly.
  if (prizes.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-5 mb-4">
        <h2 className="text-sm font-bold text-gray-900 mb-1">🎁 Prizes</h2>
        <p className="text-xs text-gray-500 mb-4">
          No prizes yet — be the first to donate one. Sponsors get a credit on every cup page until the final.
        </p>
        <button onClick={() => setShowDonate(true)}
          className="w-full py-3 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm">
          Donate a prize →
        </button>
        {showDonate && <DonateModal onClose={() => setShowDonate(false)} />}
      </div>
    )
  }

  const podium = prizes.filter(p => p.rank !== null).slice(0, 3)
  const spot   = prizes.filter(p => p.rank === null)

  return (
    <div className="bg-white rounded-2xl shadow-card p-5 mb-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="text-sm font-bold text-gray-900">🎁 Prizes</h2>
        <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">{prizes.length} on the board</span>
      </div>
      <div className="space-y-2 mb-4">
        {podium.map(p => <PrizeRow key={p.id} prize={p} />)}
        {spot.length > 0 && (
          <>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider pt-2 px-1">Spot prizes</p>
            {spot.map(p => <PrizeRow key={p.id} prize={p} />)}
          </>
        )}
      </div>
      <button onClick={() => setShowDonate(true)}
        className="w-full py-2.5 bg-amber-50 hover:bg-amber-100 active:bg-amber-200 text-amber-700 text-sm font-bold rounded-xl border border-amber-200 transition-colors">
        + Donate a prize
      </button>
      <p className="text-[10px] text-gray-400 text-center mt-2">Anyone can offer one. Sponsors get a credit on the cup page.</p>
      <ShareButton variant="compact" />
      {showDonate && <DonateModal onClose={() => setShowDonate(false)} />}
    </div>
  )
}

function PrizeRow({ prize }: { prize: PrizeRow }) {
  const rankLabel = prize.rank ? RANK_LABEL[prize.rank] : null
  return (
    <div className="flex items-start gap-3 px-3 py-3 rounded-xl bg-gray-50/50 border border-gray-100">
      {prize.imageUrl ? (
        <img src={prize.imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
      ) : prize.sponsor?.logoUrl ? (
        <img src={prize.sponsor.logoUrl} alt={prize.sponsor.name} className="w-12 h-12 rounded-lg object-contain bg-white border border-gray-100 shrink-0" />
      ) : (
        <div className="w-12 h-12 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center text-xl shrink-0">🎁</div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {rankLabel && <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">{rankLabel}</span>}
          <p className="text-sm font-bold text-gray-900 truncate">{prize.title}</p>
        </div>
        {prize.description && <p className="text-xs text-gray-600 mt-0.5">{prize.description}</p>}
        {prize.sponsor && (
          <p className="text-[10px] text-gray-500 mt-1">
            sponsored by{' '}
            {prize.sponsor.websiteUrl ? (
              <a href={prize.sponsor.websiteUrl} target="_blank" rel="noopener noreferrer"
                className="text-amber-600 font-semibold hover:underline">
                {prize.sponsor.name}
              </a>
            ) : (
              <span className="text-amber-600 font-semibold">{prize.sponsor.name}</span>
            )}
          </p>
        )}
      </div>
    </div>
  )
}

function DonateModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    donorName: '', donorEmail: '', donorOrganization: '', donorPhone: '',
    prizeTitle: '', prizeDescription: '', estimatedValue: '',
    notes: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const value = form.estimatedValue.trim()
      const res = await fetch('/app/api/cup/donate', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          estimatedValue: value ? Number(value) : null,
        }),
      })
      const d = await res.json()
      if (res.ok) {
        setDone(true)
      } else {
        toast.error(d.error ?? 'Could not submit')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm px-4 pb-4 sm:pb-0"
      onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        {done ? (
          <div className="p-6 text-center">
            <p className="text-3xl mb-3">🙏</p>
            <h2 className="text-lg font-bold text-gray-900 mb-1">Thanks!</h2>
            <p className="text-sm text-gray-600 mb-5">We&apos;ll review your offer within a day or two and get back to you at <strong>{form.donorEmail}</strong>. If accepted, your name (or organisation) shows up under the prize on the cup page.</p>
            <button onClick={onClose}
              className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl">
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Donate a prize</h2>
              <p className="text-xs text-gray-500 mt-1">Offer something — anything — and we&apos;ll add it to the cup board. Sponsors get a credit + a link on every page view.</p>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3">
                <Field label="Your name" required>
                  <input type="text" required value={form.donorName} onChange={e => set('donorName', e.target.value)}
                    className={inputCls} placeholder="Ayşe Kaya" />
                </Field>
                <Field label="Email" required>
                  <input type="email" required value={form.donorEmail} onChange={e => set('donorEmail', e.target.value)}
                    className={inputCls} placeholder="you@example.com" />
                </Field>
                <Field label="Organisation" hint="Optional — leave blank if it&apos;s personal">
                  <input type="text" value={form.donorOrganization} onChange={e => set('donorOrganization', e.target.value)}
                    className={inputCls} placeholder="e.g. Mikla Restaurant" />
                </Field>
                <Field label="Phone" hint="Optional">
                  <input type="tel" value={form.donorPhone} onChange={e => set('donorPhone', e.target.value)}
                    className={inputCls} placeholder="+90 5xx xxx xx xx" />
                </Field>
              </div>

              <div className="border-t border-gray-100 pt-3 space-y-3">
                <Field label="What you&apos;re donating" required>
                  <input type="text" required value={form.prizeTitle} onChange={e => set('prizeTitle', e.target.value)}
                    className={inputCls} placeholder="Dinner for two" />
                </Field>
                <Field label="Description" required hint="One or two sentences">
                  <textarea required rows={3} value={form.prizeDescription} onChange={e => set('prizeDescription', e.target.value)}
                    className={`${inputCls} resize-none`} placeholder="A tasting menu at Mikla, valid through the end of the year." />
                </Field>
                <Field label="Estimated value (TRY)" hint="Optional — helps us rank it">
                  <input type="number" min={0} step={1} value={form.estimatedValue} onChange={e => set('estimatedValue', e.target.value)}
                    className={inputCls} placeholder="e.g. 2500" />
                </Field>
                <Field label="Notes" hint="Optional — anything we should know">
                  <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
                    className={`${inputCls} resize-none`} placeholder="Pickup details, expiry, restrictions…" />
                </Field>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button type="button" onClick={onClose} disabled={submitting}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-bold rounded-xl">
                Cancel
              </button>
              <button type="submit" disabled={submitting}
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl disabled:opacity-60">
                {submitting ? 'Sending…' : 'Submit'}
              </button>
            </div>
            <p className="text-[10px] text-gray-400 text-center">We review every offer. No payment required.</p>
          </form>
        )}
      </div>
    </div>
  )
}

const inputCls = 'w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400'

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold text-gray-700 mb-1">
        {label}{required && <span className="text-amber-600 ml-0.5">*</span>}
        {hint && <span className="text-gray-400 font-normal ml-1.5">· {hint}</span>}
      </label>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// FAQ card — collapsible, hardcoded Q&As. Cuts inbound DMs to
// admins during peak. Same shape as the rules card so it reads
// as a sibling, not a competing section.
// ─────────────────────────────────────────────────────────────────
const FAQS: { q: string; a: string }[] = [
  { q: 'What if I miss a match?',
    a: 'Picks lock at kickoff. If you miss one, you forfeit the points for that match — but your bracket and other match picks keep scoring. There\'s no penalty beyond the lost match points.' },
  { q: 'Can I edit my bracket after submitting?',
    a: 'Yes — any time before first kickoff (Jun 11 22:00 Istanbul). Once the first match starts, your champion + 4 semifinalists lock for the rest of the tournament.' },
  { q: 'How are ties broken?',
    a: 'If two members finish on identical points, the earlier bracket submission wins. Submit early — it rewards commitment.' },
  { q: 'Where are the watch parties?',
    a: 'Smileys events tagged with "World Cup" appear in the Watch parties section above. Hosts open them up to club members and friends. RSVP normally.' },
  { q: 'Do I have to pick every match?',
    a: 'No — group-stage picks are 1 pt each, skip as many as you like. Knockouts (R32 → Final) scale up to 40 pts for the Final winner; that\'s where the real movement happens.' },
  { q: 'How are predictions kept fair?',
    a: 'Picks lock server-side at the second of kickoff. Score-after-the-fact is impossible. Identical-pick collusion between accounts is monitored.' },
  { q: 'What does the winner actually get?',
    a: 'Check the Prizes section above for what\'s currently on the board — donated by sponsors and Smileys members. Top of the leaderboard at the Final takes home the headline prize; spot prizes go to other top finishers. Have something to offer? Tap "Donate a prize" in the same section.' },
]

function FAQCard() {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-white rounded-2xl shadow-card mb-4 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors">
        <div>
          <p className="text-sm font-bold text-gray-900">Common questions</p>
          <p className="text-xs text-gray-500 mt-0.5">{FAQS.length} answers — most of what people ask in DMs.</p>
        </div>
        <svg className={`w-5 h-5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="divide-y divide-gray-100 border-t border-gray-100">
          {FAQS.map((f, i) => <FAQRow key={i} q={f.q} a={f.a} />)}
        </div>
      )}
    </div>
  )
}

function FAQRow({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-3 text-left flex items-start justify-between gap-3 hover:bg-gray-50 transition-colors">
        <span className="text-sm font-semibold text-gray-800 flex-1">{q}</span>
        <span className={`text-gray-400 text-base shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && (
        <p className="px-5 pb-4 text-xs text-gray-600 leading-relaxed">{a}</p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Watch parties — Smileys events tagged "World Cup". Section is
// hidden when there are none; renders compact rows linking to
// the individual event detail pages where RSVPs happen.
// ─────────────────────────────────────────────────────────────────
interface WatchPartyEvent {
  id: string; title: string; emoji: string; date: string; time: string
  neighborhood: string; location: string; coverImage: string | null
  totalSpots: number; spotsLeft: number
  _count: { attendees: number }
}

function WatchParties() {
  const [events, setEvents] = useState<WatchPartyEvent[] | null>(null)
  useEffect(() => {
    fetch('/app/api/cup/watch-parties', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.events) setEvents(d.events) })
  }, [])
  if (!events || events.length === 0) return null

  return (
    <div className="bg-white rounded-2xl shadow-card mb-4 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-sm font-bold text-gray-900">🍻 Watch parties</p>
        <Link href="/events" className="text-[10px] text-amber-600 font-semibold hover:underline">all events →</Link>
      </div>
      <div className="divide-y divide-gray-100">
        {events.map(e => <WatchPartyRow key={e.id} e={e} />)}
      </div>
    </div>
  )
}

function WatchPartyRow({ e }: { e: WatchPartyEvent }) {
  const dateLabel = new Date(`${e.date}T${e.time || '00:00'}:00+03:00`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
  const fill = e.totalSpots > 0 ? Math.round(((e.totalSpots - e.spotsLeft) / e.totalSpots) * 100) : 0
  return (
    <Link href={`/events/${e.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
      <span className="text-lg shrink-0">{e.emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900 truncate">{e.title}</p>
        <p className="text-[10px] text-gray-500">
          {dateLabel}{e.time && ` · ${e.time}`}{e.neighborhood && ` · ${e.neighborhood}`}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[10px] text-gray-500 font-semibold">{e._count.attendees}/{e.totalSpots}</p>
        <div className="w-12 h-1 bg-gray-100 rounded-full overflow-hidden mt-1">
          <div className={`h-full rounded-full ${fill >= 80 ? 'bg-red-400' : 'bg-amber-400'}`} style={{ width: `${fill}%` }} />
        </div>
      </div>
    </Link>
  )
}

// ─────────────────────────────────────────────────────────────────
// Trending picks — top champion + semifinalist aggregates from
// every CupBracketPick. Compact tile that drives FOMO. Public.
// ─────────────────────────────────────────────────────────────────
interface TrendingRow { code: string; count: number; pct: number }
interface TrendingResponse {
  total: number
  champions: TrendingRow[]
  semifinalists: TrendingRow[]
  lastUpdated: string
}

function TrendingPicks() {
  const [data, setData] = useState<TrendingResponse | null>(null)
  useEffect(() => {
    fetch('/app/api/cup/trending', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
  }, [])

  if (!data || data.total === 0) return null

  const topChamps = data.champions.slice(0, 3)
  return (
    <div className="bg-white rounded-2xl shadow-card mb-4 p-5">
      <div className="flex items-center justify-between mb-3 gap-2">
        <p className="text-sm font-bold text-gray-900">📈 Trending picks</p>
        <span className="text-[10px] text-gray-500 font-semibold">{data.total} bracket{data.total === 1 ? '' : 's'} so far</span>
      </div>
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">Champion call</p>
      <div className="space-y-1.5">
        {topChamps.map(row => (
          <div key={row.code} className="flex items-center gap-2.5">
            <span className="text-sm font-bold text-gray-900 shrink-0 w-12 tabular-nums text-right">{row.pct}%</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-semibold text-gray-700 truncate">{teamLabel(row.code)}</p>
                <span className="text-[10px] text-gray-500">{row.count}</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-amber-400" style={{ width: `${row.pct}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
      {data.semifinalists.length > 0 && (
        <>
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mt-4 mb-1.5">Most-picked semifinalists</p>
          <div className="flex flex-wrap gap-1.5">
            {data.semifinalists.slice(0, 6).map(row => {
              const t = TEAM_BY_CODE.get(row.code)
              return (
                <span key={row.code} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 text-amber-800 text-[11px] font-bold">
                  <span>{t?.flag}</span>
                  <span>{t?.code ?? row.code}</span>
                  <span className="text-amber-600 text-[10px] font-semibold ml-0.5">{row.pct}%</span>
                </span>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  // Wider container on lg+ so the 2-column layout has breathing
  // room. The page body still constrains specific sections (banner,
  // visitor hero) to a narrower inner width so they don't read as
  // a billboard on a wide screen. Mobile + small tablet keep the
  // existing single-column max-w-2xl shape.
  return (
    <div className="min-h-screen bg-warm pb-20">
      <div className="max-w-2xl lg:max-w-5xl mx-auto px-4 pt-6">{children}</div>
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
          <p className="text-xs text-gray-500 mt-0.5">Pick a champion, pick every match, win prizes.</p>
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
              Max possible: ~480 pts. Top of the board at the Final takes the headline prize from the Prizes section above; spot prizes go to other top finishers.
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
  total: number; eligible: number; lastUpdated: string
}

// Leaderboard data is consumed by two components: the full
// Leaderboard in the main column and the sticky MiniRankCard in
// the desktop sidebar. Before this provider they each ran their
// own setInterval + fetch — same endpoint, same 30s cadence —
// which doubled requests for no benefit (304 short-circuit made
// the second one cheap, but it was still an unnecessary round-trip
// and an extra setState pulse on every interval).
//
// Provider lifts the polling once into a single timer that mounts
// when CupPage renders; both components consume via
// `useLeaderboard()`. The provider survives Leaderboard /
// MiniRankCard mounts and unmounts because it lives on CupPage.
//
// One non-trivial detail: the `since` watermark needs to track
// across all consumers, so it lives in the provider's ref rather
// than in either component's state.

interface LeaderboardContextValue {
  data:    LeaderResponse | null
  loading: boolean
}

const LeaderboardContext = createContext<LeaderboardContextValue | null>(null)

function LeaderboardProvider({ children }: { children: React.ReactNode }) {
  const [data,    setData]    = useState<LeaderResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const sinceRef = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    async function load() {
      const url = sinceRef.current
        ? `/app/api/cup/leaderboard?take=50&since=${encodeURIComponent(sinceRef.current)}`
        : '/app/api/cup/leaderboard?take=50'
      try {
        const res = await fetch(url, { credentials: 'include' })
        if (res.status === 304) return
        if (!res.ok) return
        const d: LeaderResponse = await res.json()
        if (!alive) return
        setData(d)
        sinceRef.current = d.lastUpdated ?? null
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    // Refresh every 30 seconds while the page is open. Tournament
    // pace gives a natural rhythm — results lag the broadcast, so
    // anything tighter doesn't get fresher data. The ?since= guard
    // means most of these polls are a single Prisma aggregate +
    // a 304 with no body.
    const t = setInterval(load, 30_000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  return (
    <LeaderboardContext.Provider value={{ data, loading }}>
      {children}
    </LeaderboardContext.Provider>
  )
}

function useLeaderboard(): LeaderboardContextValue {
  const ctx = useContext(LeaderboardContext)
  if (!ctx) throw new Error('useLeaderboard must be used inside <LeaderboardProvider>')
  return ctx
}

// VAPID public key for web-push subscription. Mirrors the settings
// page implementation; exposed as NEXT_PUBLIC_ so the client can
// pass it as applicationServerKey when calling pushManager.subscribe.
const CUP_VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

function cupUrlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

// Push opt-in strip — small dismissible card under the Bracket
// asking members to enable match reminders. Highest-ROI re-
// engagement lever for a 5-week prediction game (kickoff times
// fall in the user's evening; without push, weekday matches
// quietly slip past the pick lock and people lose interest).
//
// Rendering rules — strip hides itself when:
//   • the device doesn't support Notification + PushManager + SW
//   • the user already granted + subscribed (state === 'on')
//   • the user previously denied permission (state === 'denied')
//   • the user dismissed this strip (localStorage flag)
//
// On enable we reuse the same /api/push/subscribe contract the
// settings page uses, so opting in here covers all push channels
// — not just match reminders — which is what we want anyway.
function PushOptInStrip() {
  const [state, setState] = useState<'loading' | 'hidden' | 'off'>('loading')
  const [busy,  setBusy]  = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) {
      setState('hidden'); return
    }
    if (localStorage.getItem('cup-push-dismissed') === '1') { setState('hidden'); return }
    if (Notification.permission === 'denied') { setState('hidden'); return }
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => setState(sub ? 'hidden' : 'off'))
      .catch(() => setState('hidden'))
  }, [])

  if (state !== 'off') return null

  async function enable() {
    if (!CUP_VAPID_PUBLIC_KEY) {
      toast.error('Push is not configured. Try again later.')
      return
    }
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        // User declined the OS prompt — hide the strip so we don't
        // re-prompt every page load. They can still opt in via
        // /settings.
        setState('hidden')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: cupUrlBase64ToUint8Array(CUP_VAPID_PUBLIC_KEY) as BufferSource,
      })
      await fetch('/app/api/push/subscribe', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      toast.success('Match reminders on — we\'ll ping you before kickoffs')
      setState('hidden')
    } catch (e) {
      toast.error(`Could not enable: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  function dismiss() {
    localStorage.setItem('cup-push-dismissed', '1')
    setState('hidden')
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4 flex items-start gap-3 shadow-sm">
      <span className="text-2xl shrink-0" aria-hidden>🔔</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-amber-900 leading-snug">Match reminders &amp; cup updates</p>
        <p className="text-[11px] text-amber-800/80 mt-0.5 leading-snug">A heads-up ~30 min before any match you haven&apos;t picked yet.</p>
      </div>
      {/* Side-by-side buttons rather than stacked — keeps both tap
          targets above ~36px and avoids the previous text-[10px]
          dismiss button that was too small for mobile thumbs. */}
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={dismiss}
          className="px-3 py-2 text-amber-700 hover:bg-amber-100 active:bg-amber-200 text-xs font-semibold rounded-lg transition-colors">
          Not now
        </button>
        <button onClick={enable} disabled={busy}
          className="px-3 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-xs font-bold rounded-lg disabled:opacity-50 transition-colors">
          {busy ? 'Enabling…' : 'Enable'}
        </button>
      </div>
    </div>
  )
}

// Compact rank card — desktop-only. Pairs with the full Leaderboard
// in the main column: that one stays high in the reading order
// (right after the Bracket) so mobile users see it without scroll.
// This one is the always-visible "where am I" glance for desktop
// users scrolling 103 fixtures. Slices ±2 around your row when
// you're in the top 50, falls back to top 3 + pinned-you row when
// you're outside that slice. Independent poll from the main board
// — the 304 short-circuit (single Prisma aggregate when the
// fixture watermark hasn't moved) makes the duplicate request
// effectively free.
function MiniRankCard() {
  // Desktop-only via matchMedia, NOT just CSS `hidden lg:block`.
  // Re-evaluates on resize so a viewport crossing 1024 (tablet
  // rotate, window resize) renders the card with a correct
  // lifecycle. Polling now lives in LeaderboardProvider — this
  // card just subscribes; no extra fetches happen for being on
  // desktop vs mobile.
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia('(min-width: 1024px)')
    const update = () => setIsDesktop(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])

  const { data, loading } = useLeaderboard()

  // Mobile → no DOM at all. Full Leaderboard above handles the
  // ranking story; this card is purely a "while you scroll fixtures"
  // glance for sticky desktop sidebars.
  if (!isDesktop) return null

  const wrapper = 'bg-white rounded-2xl shadow-card overflow-hidden'

  if (loading && !data) {
    return (
      <div className={`${wrapper} p-4`}>
        <p className="text-sm font-bold text-gray-900 mb-3">Your rank</p>
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
        </div>
      </div>
    )
  }
  if (!data) return null
  if (data.yourRank === null) {
    // No bracket locked yet — small nudge, mirrors the main-column
    // empty-state copy without competing with it.
    return (
      <div className={`${wrapper} p-4`}>
        <p className="text-sm font-bold text-gray-900 mb-1">Your rank</p>
        <p className="text-xs text-gray-500">Lock in your bracket to enter the leaderboard.</p>
      </div>
    )
  }

  const yourRank = data.yourRank
  const idx = data.rows.findIndex(r => r.rank === yourRank)
  // In-slice: show ±2 around your row (5 rows). Outside: top 3 +
  // pinned-you below — the pinned strip uses the same amber accent
  // as the main board so the visual language matches.
  let visible: LeaderRow[]
  let showPinned = false
  if (idx === -1) {
    visible = data.rows.slice(0, 3)
    showPinned = true
  } else {
    const start = Math.max(0, idx - 2)
    const end   = Math.min(data.rows.length, idx + 3)
    visible = data.rows.slice(start, end)
  }

  return (
    <div className={wrapper}>
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-sm font-bold text-gray-900">Your rank</p>
        <p className="text-[10px] text-gray-400 tabular-nums">#{yourRank} of {data.total}</p>
      </div>
      <div className="divide-y divide-gray-100">
        {visible.map((r, i) => (
          <MiniRankRow key={`${r.rank}-${i}`} row={r} isYou={r.rank === yourRank} />
        ))}
      </div>
      {showPinned && data.yourScore !== null && (
        <div className="border-t-2 border-amber-200 bg-amber-50 px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-amber-700 tabular-nums">#{yourRank}</span>
            <span className="text-sm font-semibold text-amber-900">You</span>
          </div>
          <span className="text-sm font-extrabold text-amber-700 tabular-nums">{data.yourScore}</span>
        </div>
      )}
    </div>
  )
}

function MiniRankRow({ row, isYou }: { row: LeaderRow; isYou: boolean }) {
  const medal = row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : null
  return (
    <div className={`px-4 py-2 flex items-center gap-2.5 ${isYou ? 'bg-amber-50' : ''}`}>
      <span className="text-[11px] font-bold text-gray-500 tabular-nums w-6 text-right">
        {medal ?? `#${row.rank}`}
      </span>
      {row.profilePhoto ? (
        <img src={row.profilePhoto} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
      ) : (
        <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-white text-[9px] font-bold"
          style={{ backgroundColor: row.color }}>
          {row.name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)}
        </div>
      )}
      <span className={`flex-1 min-w-0 text-xs truncate ${isYou ? 'font-bold text-amber-900' : 'font-semibold text-gray-800'}`}>
        {isYou ? 'You' : row.name}
      </span>
      <span className={`text-xs font-extrabold tabular-nums ${isYou ? 'text-amber-700' : 'text-gray-700'}`}>{row.score}</span>
    </div>
  )
}

function Leaderboard() {
  // Data + polling lifecycle now live in LeaderboardProvider above
  // on CupPage; this component just renders. Same useLeaderboard()
  // hook backs the desktop sidebar MiniRankCard so the two views
  // share a single fetch / setInterval, halving the request rate.
  const { data, loading } = useLeaderboard()

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
    // Eligible count (when present) puts the empty state in
    // context: "0 of 47 members playing" reads as a community
    // moment, not a broken page. Falls back to a generic line if
    // the count isn't there yet (older API).
    const eligible = data?.eligible ?? null
    return (
      <div className="bg-white rounded-2xl shadow-card p-5 mb-4">
        <p className="text-sm font-bold text-gray-900 mb-1">Leaderboard</p>
        <p className="text-xs text-gray-500">
          {eligible !== null
            ? `0 of ${eligible} member${eligible === 1 ? '' : 's'} playing. Be the first to lock in a bracket — you'll lead by default.`
            : 'No picks yet — be the first to lock in a bracket and you’ll lead by default.'}
        </p>
      </div>
    )
  }

  const youInSlice = data.yourRank !== null && data.rows.some(r => r.rank === data.yourRank)
  // Member spotlight — top of the board, with a "top dog" treatment.
  // Hidden when no one has scored yet (top.score === 0); only
  // surfaces once there's actual movement to celebrate.
  const top = data.rows[0]
  const hasScores = !!top && top.score > 0

  return (
    <div className="bg-white rounded-2xl shadow-card mb-4 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-sm font-bold text-gray-900">Leaderboard</p>
        <p className="text-[10px] text-gray-400">{data.total} playing</p>
      </div>
      {/* Spotlight strip — featured top row pulled out above the
          list. Only renders once someone has accumulated points
          (pre-tournament the leaderboard is all zeros — no
          spotlight worth giving). */}
      {hasScores && (
        <div className="px-5 py-3 bg-gradient-to-r from-amber-50 to-amber-100/60 border-b border-amber-100 flex items-center gap-3">
          <span className="text-xl shrink-0">🥇</span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest">Top of the table</p>
            <p className="text-sm font-extrabold text-amber-900 truncate">{top.name}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-lg font-extrabold text-amber-700 tabular-nums leading-none">{top.score}</p>
            <p className="text-[10px] text-amber-700/70 font-semibold">pts</p>
          </div>
        </div>
      )}
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
