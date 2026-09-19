import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { parseConnectionFilters } from '@/lib/connectionFilters'
import { applyOptimisticVote, type PollState } from '@/lib/pollOptimistic'
import { parseDismissedIds, isSnoozed, snoozeUntil, SNOOZE_MS } from '@/lib/reviewReminder'
import { armPull, pullDistance, PULL_THRESHOLD } from '@/lib/pullToRefresh'

// Member dashboard widget review (2026-09):
//    1 — ReviewReminder: "Maybe later" dismissed an event forever; now a
//        week-long snooze, with ✕ as the permanent per-event "don't ask".
//    2 — AnnouncementBanner rendered, then vanished on mount for dismissers.
//    3 — QuickLinks offered "Install App" inside the installed app.
//    4 — CityWeather / PartnersBanner fetched on phones where CSS hides them.
//    5 — PendingConnectionsWidget downloaded the member's whole network.
//    6 — poll vote and connection accept/decline failed silently.
//    7 — dismissing a venue prompt didn't move on to the next candidate.
//    8 — pull-to-refresh kept a stale start position between touches.
//    9 — FirstEventBlock said "Your first event" to members who'd had one.
//   10 — TestimonialPrompt named the viewed city, not the quote's (home) city.
//   11 — OnboardingCard called a months-old list "this week".

const read = (p: string) => readFileSync(p, 'utf8')

describe('GET /api/connections filters', () => {
  const parse = (qs: string) => parseConnectionFilters(new URLSearchParams(qs))

  it('no params = the unfiltered response every other caller relies on', () => {
    expect(parse('')).toEqual({ ok: true, direction: null, status: null })
  })
  it('accepts the widget\'s slice', () => {
    expect(parse('direction=received&status=pending')).toEqual({ ok: true, direction: 'received', status: 'pending' })
    expect(parse('direction=sent&status=accepted')).toEqual({ ok: true, direction: 'sent', status: 'accepted' })
  })
  it('refuses unknown values rather than silently returning everything', () => {
    expect(parse('direction=both').ok).toBe(false)
    expect(parse('status=declined').ok).toBe(false)   // decline-memory never leaves the server
    expect(parse('status=').ok).toBe(false)
  })
  it('the route narrows by the parsed filters and keeps declined rows out by default', () => {
    const src = read('app/api/connections/route.ts')
    expect(src).toMatch(/export async function GET\(req: NextRequest\)/)
    expect(src).toMatch(/parseConnectionFilters\(req\.nextUrl\.searchParams\)/)
    expect(src).toMatch(/const status = filters\.status \?\? \{ not: 'declined' \}/)
  })
  it('the widget asks for pending received only', () => {
    expect(read('components/PendingConnectionsWidget.tsx'))
      .toMatch(/fetch\('\/app\/api\/connections\?direction=received&status=pending'/)
  })
})

describe('optimistic poll vote', () => {
  const poll: PollState = {
    id: 'p', question: 'q', totalVotes: 3, votedOptionId: null,
    options: [
      { id: 'a', text: 'A', votes: 2, percent: 67 },
      { id: 'b', text: 'B', votes: 1, percent: 33 },
    ],
  }
  it('counts the vote and recomputes percentages the way the API rounds them', () => {
    const next = applyOptimisticVote(poll, 'b')
    expect(next.votedOptionId).toBe('b')
    expect(next.totalVotes).toBe(4)
    expect(next.options.map(o => [o.votes, o.percent])).toEqual([[2, 50], [2, 50]])
    expect(poll.votedOptionId).toBeNull()   // the original is the rollback copy
  })
  it('is a no-op for an unknown option or a second vote', () => {
    expect(applyOptimisticVote(poll, 'zzz')).toBe(poll)
    const voted = applyOptimisticVote(poll, 'a')
    expect(applyOptimisticVote(voted, 'b')).toBe(voted)
  })
  it('the widget toasts and rolls back on failure', () => {
    const src = read('components/CommunityPollWidget.tsx')
    expect(src).toMatch(/toast\.error\(data\.error \?\? "Couldn't record your vote"\)\s*setPoll\(before\)/)
    expect(src).toMatch(/catch \{\s*toast\.error\([^)]*\)\s*setPoll\(before\)/)
  })
  it('connection accept/decline toast and put the row back', () => {
    const src = read('components/PendingConnectionsWidget.tsx')
    expect(src).toMatch(/toast\.error\(data\.error \?\? `Couldn't \$\{verb\} the request`\)\s*restore\(row, index\)/)
    expect(src).toMatch(/catch \{\s*toast\.error\([^)]*\)\s*restore\(row, index\)/)
  })
})

describe('review reminder snooze', () => {
  const now = 1_700_000_000_000
  it('"Maybe later" lasts a week, then the reminder returns', () => {
    const raw = snoozeUntil(now)
    expect(isSnoozed(raw, now)).toBe(true)
    expect(isSnoozed(raw, now + SNOOZE_MS - 1)).toBe(true)
    expect(isSnoozed(raw, now + SNOOZE_MS)).toBe(false)
  })
  it('junk storage reads as not snoozed / nothing dismissed', () => {
    expect(isSnoozed(null, now)).toBe(false)
    expect(isSnoozed('soon', now)).toBe(false)
    expect(parseDismissedIds('{bad')).toEqual([])
    expect(parseDismissedIds('{"a":1}')).toEqual([])
    expect(parseDismissedIds('["e1",2,"e2"]')).toEqual(['e1', 'e2'])
  })
  it('"Maybe later" snoozes; ✕ dismisses the event and is labelled', () => {
    const src = read('components/ReviewReminder.tsx')
    expect(src).toMatch(/onClick=\{handleSnooze\}[\s\S]{0,200}Maybe later/)
    expect(src).toMatch(/onClick=\{handleDismiss\}[\s\S]{0,80}aria-label=\{`Don't ask again about \$\{next\.title\}`\}/)
  })
})

describe('pull-to-refresh arming', () => {
  it('a touch that starts below the top never arms', () => {
    expect(armPull({ busy: false, scrollY: 300, clientY: 100 })).toBeNull()
    expect(armPull({ busy: true,  scrollY: 0,   clientY: 100 })).toBeNull()
    expect(armPull({ busy: false, scrollY: 0,   clientY: 100 })).toBe(100)
  })
  it('an unarmed gesture draws nothing even once the page reaches the top', () => {
    // The old bug: scroll back to the top in one swipe, stale start → refresh.
    expect(pullDistance({ startY: null, clientY: 900, scrollY: 0 })).toBe(0)
  })
  it('an armed pull grows with resistance and caps just past the threshold', () => {
    expect(pullDistance({ startY: 100, clientY: 80,  scrollY: 0 })).toBe(0)
    expect(pullDistance({ startY: 100, clientY: 200, scrollY: 0 })).toBeCloseTo(45)
    expect(pullDistance({ startY: 100, clientY: 900, scrollY: 0 })).toBe(PULL_THRESHOLD + 16)
    expect(pullDistance({ startY: 100, clientY: 900, scrollY: 5 })).toBe(0)
  })
  it('the hook disarms on touchend and touchcancel', () => {
    const src = read('hooks/usePullToRefresh.ts')
    expect(src).toMatch(/window\.addEventListener\('touchcancel', onTouchCancel\)/)
    expect(src).toMatch(/function reset\(\) \{\s*startY\.current = null/)
    expect(src).toMatch(/if \(busy\.current \|\| startY\.current === null\) return/)
  })
})

describe('dashboard widget source guards', () => {
  it('announcement banner waits for the dismissed check before rendering', () => {
    const src = read('components/AnnouncementBanner.tsx')
    expect(src).toMatch(/useState<boolean \| null>\(null\)/)
    expect(src).toMatch(/if \(dismissed !== false \|\| !text\) return null/)
  })
  it('quick links hide "Install App" in the installed app', () => {
    const src = read('components/QuickLinks.tsx')
    expect(src).toMatch(/matchMedia\('\(display-mode: standalone\)'\)/)
    expect(src).toMatch(/showInstall \? BASE_LINKS : BASE_LINKS\.filter\(l => !l\.isAction\)/)
  })
  it('desktop-only widgets fetch only when the lg breakpoint matches', () => {
    expect(read('hooks/useMediaQuery.ts')).toMatch(/export const LG_UP = '\(min-width: 1024px\)'/)
    const weather = read('components/CityWeather.tsx')
    expect(weather).toMatch(/const visible = useMediaQuery\(LG_UP\)/)
    expect(weather).toMatch(/useEffect\(\(\) => \{\s*if \(!visible\) return/)
    const partners = read('components/PartnersBanner.tsx')
    expect(partners).toMatch(/const visible = useMediaQuery\(LG_UP\)/)
    expect(partners).toMatch(/if \(!visible \|\| fetched\.current\) return/)
  })
  it('venue prompts advance to the next candidate after a dismissal', () => {
    const src = read('components/VenueReviewPrompt.tsx')
    expect(src).toMatch(/function handleDismiss\(\) \{\s*persistDismiss\(\)\s*finish\(\)/)
    expect(src).toMatch(/onDone\?\.\(businessId\)/)
    expect(src).toMatch(/const pick = candidates\.find\(c => !done\.includes\(c\.businessId\)\)/)
    expect(src).toMatch(/key=\{pick\.businessId\}/)
  })
  it('first-event block says "next" to members who already have an RSVP', () => {
    expect(read('app/api/first-event/route.ts')).toMatch(/returning: !!rsvp/)
    expect(read('components/FirstEventBlock.tsx')).toMatch(/state\.returning \? '👋 Your next event' : '👋 Your first event'/)
  })
  it('testimonial prompt names the home city, not the viewed one', () => {
    const src = read('components/TestimonialPrompt.tsx')
    expect(src).toMatch(/current\.viewing \? current\.homeName : current\.name/)
    expect(src).not.toMatch(/\{ cityName \}: \{ cityName\?: string \}/)
  })
  it('onboarding card heading makes no freshness claim', () => {
    const src = read('components/OnboardingCard.tsx')
    expect(src).not.toMatch(/this week/)
    expect(src).toMatch(/Good places to start/)
  })
})
