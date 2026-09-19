import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan 5, item 94: the finished World Cup still invited people to play and
// to switch on match reminders; admin cup/campaign buttons stuck on a network
// error; the admin topbar's moderation counts never refreshed after acting.
const read = (p: string) => readFileSync(p, 'utf8')

const p = vi.hoisted(() => ({
  campaign:      { findUnique: vi.fn() },
  cupFixture:    { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(async () => [] as unknown[]), updateMany: vi.fn() },
  cupPrediction: { findMany: vi.fn(async () => []) },
  user:          { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
}))
const h = vi.hoisted(() => ({ session: { current: null as Record<string, unknown> | null } }))

vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => h.session.current) }))
vi.mock('@/lib/push', () => ({ sendPushToUser: vi.fn(async () => {}) }))
vi.mock('@/lib/cronHealth', () => ({ recordCronRun: vi.fn(async () => {}) }))
vi.mock('@/lib/cronAuth', () => ({ checkCronAuth: vi.fn(() => null) }))

import { POST as remindersPOST } from '@/app/api/cup/reminders/route'
import { POST as sweepPOST } from '@/app/api/cron/sweep-cup-reminders/route'
import { GET as fixturesGET } from '@/app/api/cup/fixtures/route'
import {
  isCupFinished, cupReminderRefusal, isLiveCampaign, LIVE_CUP_SLUG,
  CUP_MATCH_WINDOW_MS, CUP_REMINDERS_CLOSED, CUP_MATCH_KICKED_OFF,
} from '@/lib/cup-data'
import {
  shouldRefreshModCounts, parseModCounts, notifyModerationChanged,
  MODERATION_CHANGED_EVENT, MOD_COUNTS_POLL_MS, MOD_COUNTS_MIN_GAP_MS,
} from '@/lib/modCounts'

const HOUR = 60 * 60 * 1000
const member = { id: 'u1', name: 'Member', role: 'member' }

// The three reads isCupFinishedNow makes: campaign status, the Final's
// winner, the latest kickoff. Plus the fixture a reminder may name.
function world(o: {
  status?: string | null
  finalWinner?: string | null
  lastKickoff?: Date | null
  fixture?: { kickoffAt: Date } | null
}) {
  p.campaign.findUnique.mockResolvedValue(o.status === null ? null : { status: o.status ?? 'active' })
  p.cupFixture.findFirst.mockImplementation(async (args: any) =>
    args?.where?.round === 'final'
      ? { winnerTeam: o.finalWinner ?? null }
      : (o.lastKickoff ? { kickoffAt: o.lastKickoff } : null))
  p.cupFixture.findUnique.mockResolvedValue(o.fixture ?? null)
}

const postReq = (body?: unknown) =>
  new Request('https://x/app/api/cup/reminders', body === undefined
    ? { method: 'POST' }
    : { method: 'POST', body: JSON.stringify(body) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  h.session.current = member
  p.user.findUnique.mockResolvedValue({ status: 'approved' })
  p.cupFixture.findMany.mockResolvedValue([])
  world({ lastKickoff: new Date(Date.now() + 48 * HOUR) })
})

describe('94a isCupFinished', () => {
  const now = new Date('2026-09-14T12:00:00Z')

  it('a wrapped or archived campaign is finished; active, draft and unknown are not on their own', () => {
    expect(isCupFinished({ status: 'wrapped', now })).toBe(true)
    expect(isCupFinished({ status: 'archived', now })).toBe(true)
    expect(isCupFinished({ status: 'active', now })).toBe(false)
    expect(isCupFinished({ status: 'draft', now })).toBe(false)
    expect(isCupFinished({ status: null, now })).toBe(false)
  })

  it('a decided Final ends it whatever the status says', () => {
    expect(isCupFinished({ status: 'active', finalDecided: true, now })).toBe(true)
  })

  it('an unrecorded Final still ends it once the last match window closes', () => {
    const last = now.getTime() - CUP_MATCH_WINDOW_MS
    expect(isCupFinished({ status: 'active', lastKickoffAt: new Date(last), now })).toBe(true)
    expect(isCupFinished({ status: 'active', lastKickoffAt: new Date(last + 1), now })).toBe(false)
    expect(isCupFinished({ lastKickoffAt: new Date(last).toISOString(), now })).toBe(true)
    expect(isCupFinished({ lastKickoffAt: 'not a date', now })).toBe(false)
    expect(isCupFinished({ lastKickoffAt: null, now })).toBe(false)
  })

  it('leaves the delete guard alone: the cup row stays "live" for isLiveCampaign', () => {
    expect(isLiveCampaign({ slug: LIVE_CUP_SLUG, status: 'wrapped' })).toBe(true)
  })

  it('cupReminderRefusal: finished first, then a kicked-off match, else null', () => {
    expect(cupReminderRefusal({ finished: true, now })).toBe(CUP_REMINDERS_CLOSED)
    expect(cupReminderRefusal({ finished: false, kickoffAt: new Date(now.getTime() - 1), now })).toBe(CUP_MATCH_KICKED_OFF)
    expect(cupReminderRefusal({ finished: false, kickoffAt: new Date(now.getTime() + HOUR), now })).toBeNull()
    expect(cupReminderRefusal({ finished: false, now })).toBeNull()
  })
})

describe('94a POST /api/cup/reminders refuses sign-ups for a finished cup or a past match', () => {
  it('401 signed out, 403 for a member who is not approved', async () => {
    h.session.current = null
    expect((await remindersPOST(postReq())).status).toBe(401)
    h.session.current = member
    p.user.findUnique.mockResolvedValue({ status: 'pending' })
    expect((await remindersPOST(postReq())).status).toBe(403)
  })

  it('409 with a message when the campaign is wrapped or archived', async () => {
    for (const status of ['wrapped', 'archived']) {
      world({ status, lastKickoff: new Date(Date.now() + 48 * HOUR) })
      const res = await remindersPOST(postReq())
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: CUP_REMINDERS_CLOSED, finished: true })
    }
  })

  it('409 once the Final has a result', async () => {
    world({ finalWinner: 'ARG', lastKickoff: new Date(Date.now() - HOUR) })
    expect((await remindersPOST(postReq())).status).toBe(409)
  })

  it('409 once the last match is over even with no result or status change', async () => {
    world({ lastKickoff: new Date(Date.now() - 4 * HOUR) })
    const res = await remindersPOST(postReq())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(CUP_REMINDERS_CLOSED)
  })

  it('409 for a named match that has already kicked off', async () => {
    world({ lastKickoff: new Date(Date.now() + 48 * HOUR), fixture: { kickoffAt: new Date(Date.now() - 60_000) } })
    const res = await remindersPOST(postReq({ fixtureId: 'fx-past' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: CUP_MATCH_KICKED_OFF, finished: false })
  })

  it('404 for an unknown match', async () => {
    world({ lastKickoff: new Date(Date.now() + 48 * HOUR), fixture: null })
    expect((await remindersPOST(postReq({ fixtureId: 'nope' }))).status).toBe(404)
  })

  it('200 while the cup is running, with or without an upcoming match', async () => {
    expect((await remindersPOST(postReq())).status).toBe(200)
    world({ lastKickoff: new Date(Date.now() + 48 * HOUR), fixture: { kickoffAt: new Date(Date.now() + HOUR) } })
    const res = await remindersPOST(postReq({ fixtureId: 'fx-next' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('94a the reminder sweeper stops for a finished cup', () => {
  const cronReq = () => new Request('https://x/app/api/cron/sweep-cup-reminders', { method: 'POST' }) as never

  it('sends nothing and scans no fixtures once the campaign is wrapped', async () => {
    world({ status: 'wrapped', lastKickoff: new Date(Date.now() + HOUR) })
    const res = await sweepPOST(cronReq())
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, cupFinished: true, pushesSent: 0, fixturesScanned: 0 })
    expect(p.cupFixture.findMany).not.toHaveBeenCalled()
  })

  it('still sweeps while the cup is running', async () => {
    const res = await sweepPOST(cronReq())
    expect(await res.json()).toMatchObject({ ok: true, cupFinished: false })
    expect(p.cupFixture.findMany).toHaveBeenCalledTimes(1)
  })
})

describe('94a /api/cup/fixtures carries the campaign status', () => {
  it('returns campaignStatus alongside the fixtures', async () => {
    h.session.current = null
    world({ status: 'wrapped' })
    const body = await (await fixturesGET()).json()
    expect(body.campaignStatus).toBe('wrapped')
    expect(Array.isArray(body.fixtures)).toBe(true)
  })

  it('null when the cup campaign row is missing', async () => {
    h.session.current = null
    world({ status: null })
    expect((await (await fixturesGET()).json()).campaignStatus).toBeNull()
  })
})

describe('94a the cup page swaps play CTAs and reminders for a finished state', () => {
  const src = read('app/(member)/cup/page.tsx')

  it('derives cupFinished from the shared helper and gates picking on it', () => {
    expect(src).toMatch(/const cupFinished = isCupFinished\(\{ status: campaignStatus, finalDecided: tournamentOver, lastKickoffAt \}\)/)
    expect(src).toMatch(/const canPick\s+= accessState === 'member' && !cupFinished/)
    expect(src).not.toMatch(/canPick=\{accessState === 'member'\}/)
    // 3 at the page (group view, date view, knockouts) + the 2 pass-throughs
    // inside GroupStageSections / DateStageSections.
    expect(src.match(/canPick=\{canPick\}/g)?.length).toBe(5)
  })

  it('no apply-to-play hero, queue promise, bracket card or reminder strip once finished', () => {
    expect(src).toMatch(/accessState === 'unauthenticated' && !cupFinished && \(/)
    expect(src).toMatch(/accessState === 'not-member' && !cupFinished && \(/)
    expect(src).toMatch(/!bracketLocked && !cupFinished && accessState === 'member' && \(/)
    expect(src).toMatch(/accessState === 'member' && !cupFinished && <PushOptInStrip \/>/)
  })

  it('shows final standings: champion banner, or FinishedBanner when the Final is unrecorded', () => {
    expect(src).toMatch(/: cupFinished\s*\n\s*\? <FinishedBanner \/>\s*\n\s*: <Countdown fixtures=\{fixtures\} \/>/)
    expect(src).toMatch(/function FinishedBanner\(\)/)
    expect(src).toMatch(/<Leaderboard tournamentOver=\{cupFinished\} \/>/)
    expect(src).toMatch(/\{\(bracketLocked \|\| cupFinished\) && \(/)
  })

  it('the reminder strip asks the cup gate before prompting for permission, and checks subscribe', () => {
    const fn = src.slice(src.indexOf('function PushOptInStrip()'), src.indexOf('function MiniRankCard('))
    const gate = fn.indexOf("fetch('/app/api/cup/reminders'")
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(fn.indexOf('Notification.requestPermission()'))
    expect(fn).toMatch(/if \(gate\.status === 409\) setState\('hidden'\)/)
    expect(fn).toMatch(/if \(!subRes\.ok\) throw/)
  })

  it('reads campaignStatus from both the first load and the poll', () => {
    expect(src.match(/setCampaignStatus\(/g)?.length).toBe(2)
  })
})

describe('94b admin cup/campaign buttons reset busy in finally', () => {
  it('CampaignBoardPanel: every setBusy(false) sits in a finally, with a network-error toast', () => {
    const src = read('components/admin/CampaignBoardPanel.tsx')
    const total = src.match(/setBusy\(false\)/g)?.length ?? 0
    const inFinally = src.match(/finally \{\s*setBusy\(false\)/g)?.length ?? 0
    expect(total).toBe(6)  // sponsor delete/save, prize delete/unaward/save, award
    expect(inFinally).toBe(total)
    expect(src.match(/toast\.error\('Network error/g)?.length).toBe(6)
    // 85b pin still holds: refused deletes show the server's reason.
    expect(src.match(/toast\.error\(d\.error \?\? 'Delete failed'\)/g)?.length).toBe(2)
  })

  it('campaign detail: save, delete and donation actions survive a dropped connection', () => {
    const src = read('app/admin/campaigns/[id]/page.tsx')
    expect(src).toMatch(/finally \{\s*setSaving\(false\)/)
    expect(src).toMatch(/finally \{\s*setDeleting\(false\)/)
    expect(src).not.toMatch(/\n\s*setSaving\(false\)\n\s*if \(!res\.ok\)/)
    const act = src.slice(src.indexOf('async function act('), src.indexOf('const effectiveTab'))
    expect(act).toMatch(/try \{\s*res = await fetch\(/)
  })

  it('DonationRow: Publishing… resets in finally', () => {
    expect(read('components/admin/DonationRow.tsx')).toMatch(/finally \{\s*setPublishing\(false\)/)
  })

  it('CupFixturesPanel: refresh/apply/save catch with a toast and parse error bodies safely', () => {
    const src = read('components/admin/CupFixturesPanel.tsx')
    expect(src.match(/\} catch \{\s*(\/\/[^\n]*\n\s*)*toast\.error\('Network error/g)?.length).toBe(4)
    expect(src).not.toMatch(/const d = await res\.json\(\)\n/)
  })

  it('CampaignAuditPanel: a failed load says so instead of "Loading…" forever', () => {
    const src = read('components/admin/CampaignAuditPanel.tsx')
    expect(src).toMatch(/\.catch\(\(\) => setFailed\(true\)\)/)
  })
})

describe('94c moderation counts refresh policy', () => {
  const base = { now: 100_000, lastFetchAt: 100_000 - MOD_COUNTS_MIN_GAP_MS, inFlight: false, hidden: false }

  it('never while hidden or in flight', () => {
    expect(shouldRefreshModCounts({ ...base, reason: 'poll', hidden: true })).toBe(false)
    expect(shouldRefreshModCounts({ ...base, reason: 'changed', hidden: true })).toBe(false)
    expect(shouldRefreshModCounts({ ...base, reason: 'changed', inFlight: true })).toBe(false)
  })

  it('focus/route/poll are throttled to the 15s floor; an action and the first load always go', () => {
    expect(MOD_COUNTS_MIN_GAP_MS).toBeGreaterThanOrEqual(15_000)
    expect(MOD_COUNTS_POLL_MS).toBeGreaterThanOrEqual(60_000)
    expect(shouldRefreshModCounts({ ...base, reason: 'focus' })).toBe(true)
    expect(shouldRefreshModCounts({ ...base, reason: 'focus', lastFetchAt: base.now - 1000 })).toBe(false)
    expect(shouldRefreshModCounts({ ...base, reason: 'route', lastFetchAt: base.now - 1000 })).toBe(false)
    expect(shouldRefreshModCounts({ ...base, reason: 'changed', lastFetchAt: base.now - 1000 })).toBe(true)
    expect(shouldRefreshModCounts({ ...base, reason: 'mount', lastFetchAt: null })).toBe(true)
  })

  it('parseModCounts accepts the mod-stats shape and nothing else', () => {
    expect(parseModCounts({ pendingApplications: 2, pendingReports: 0, approvalQueueEvents: 1, visitorsThisWeek: 4 }))
      // standingDisputes is newer than the other three and defaults to 0: a
      // response from a not-yet-updated deployment is still usable, and a
      // badge showing 0 beats a sidebar that renders none.
      .toEqual({ pendingApplications: 2, pendingReports: 0, approvalQueueEvents: 1, standingDisputes: 0 })
    expect(parseModCounts({ pendingApplications: 2, pendingReports: 0, approvalQueueEvents: 1, standingDisputes: 3 })?.standingDisputes).toBe(3)
    expect(parseModCounts({ error: 'Forbidden' })).toBeNull()
    expect(parseModCounts({ pendingApplications: -1, pendingReports: 0, approvalQueueEvents: 0 })).toBeNull()
    expect(parseModCounts(null)).toBeNull()
  })

  it('notifyModerationChanged fires the shared window event (and is a no-op server-side)', () => {
    expect(() => notifyModerationChanged()).not.toThrow()
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    try {
      notifyModerationChanged()
      expect(dispatchEvent).toHaveBeenCalledTimes(1)
      expect((dispatchEvent.mock.calls[0][0] as Event).type).toBe(MODERATION_CHANGED_EVENT)
      expect(MODERATION_CHANGED_EVENT).toBe('smileys:moderation-changed')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('94c the topbar refetches on route, focus, visibility and moderation actions', () => {
  it('Topbar reads counts through useModCounts, not a mount-once fetch', () => {
    const src = read('components/admin/Topbar.tsx')
    expect(src).toMatch(/const modCounts = useModCounts\(isMod\)/)
    expect(src).toMatch(/<ModPanel counts=\{modCounts\} \/>/)
    expect(src).not.toMatch(/api\/admin\/mod-stats/)
  })

  it('the hook listens for focus, visibility, the event, the route, and polls at the slow cadence', () => {
    const src = read('hooks/useModCounts.ts')
    expect(src).toMatch(/window\.addEventListener\('focus', onFocus\)/)
    expect(src).toMatch(/document\.addEventListener\('visibilitychange', onVisible\)/)
    expect(src).toMatch(/window\.addEventListener\(MODERATION_CHANGED_EVENT, onChanged\)/)
    expect(src).toMatch(/setInterval\(\(\) => refresh\('poll'\), MOD_COUNTS_POLL_MS\)/)
    expect(src).toMatch(/if \(enabled\) refresh\('route'\)\s*\n\s*\}, \[pathname, enabled\]\)/)
    expect(src).toMatch(/shouldRefreshModCounts\(\{ reason, now: Date\.now\(\), lastFetchAt, inFlight, hidden \}\)/)
  })

  it('the queue pages fire the event after a successful action', () => {
    const count = (f: string) => read(f).match(/notifyModerationChanged\(\)/g)?.length ?? 0
    expect(count('app/admin/moderation/page.tsx')).toBe(3)    // report resolved, report already handled (409), queued event status
    expect(count('app/admin/applications/page.tsx')).toBe(4)  // hold, decide, quick decide, bulk
    expect(count('app/admin/events/page.tsx')).toBe(3)        // approve, status change, bulk approve
  })
})
