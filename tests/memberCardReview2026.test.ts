import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The member card review (2026-09-20). The card's QR was the member's bare
// id: anyone could draw someone else's, and a screenshot of a real card
// worked for ever, at any event — which since standing v2 is a way to clear
// your own no-show card from the sofa. Check-in was also the one attendance
// write with no audit row, a claimed "scan" could reopen a settled room for
// two days, and the door's cached roster outlived the session on a shared
// phone. These pin the fixes.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

const OLD_SECRET = process.env.JWT_SECRET
beforeEach(() => { process.env.JWT_SECRET = 'test-secret-for-card-tokens' })
afterEach(() => { process.env.JWT_SECRET = OLD_SECRET; vi.useRealTimers() })

describe('the code on the card', () => {
  it('round-trips, and carries the member it was minted for', async () => {
    const { mintCardToken, verifyCardToken, readCardTokenUserId } = await import('@/lib/cardToken')
    const { value } = mintCardToken('u-ada')
    expect(value.startsWith('smileys:card:u-ada.')).toBe(true)
    expect(verifyCardToken(value)).toEqual({ ok: true, userId: 'u-ada' })
    // The scanner reads the id without the secret, for its own roster lookup.
    expect(readCardTokenUserId(value)).toBe('u-ada')
  })

  it('refuses a code drawn for someone else', async () => {
    const { mintCardToken, verifyCardToken } = await import('@/lib/cardToken')
    const mine = mintCardToken('u-ada').value
    // Swap the member id, keep the signature: this is the whole old attack.
    const forged = mine.replace('u-ada', 'u-bora')
    expect(verifyCardToken(forged)).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyCardToken('smileys:member:u-bora')).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyCardToken('smileys:card:u-bora.99999999.aaaaaaaaaaaaaaaaaaaaaa')).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('stops working a day later, so a passed-around screenshot expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-20T18:00:00Z'))
    const { mintCardToken, verifyCardToken } = await import('@/lib/cardToken')
    const { value, expiresAt } = mintCardToken('u-ada')
    expect(expiresAt.toISOString()).toBe('2026-09-21T18:00:00.000Z')
    vi.setSystemTime(new Date('2026-09-21T17:59:00Z'))
    expect(verifyCardToken(value).ok).toBe(true)
    vi.setSystemTime(new Date('2026-09-21T18:01:00Z'))
    // Expired, not forged — the door tells them to reopen the app.
    expect(verifyCardToken(value)).toEqual({ ok: false, reason: 'expired' })
  })

  it('is signed with a key of its own, not the session secret', () => {
    expect(src('lib/cardToken.ts')).toContain("createHmac('sha256', s).update('member-card-v1')")
  })
})

describe('the door', () => {
  const route = src('app/api/events/[id]/checkin/route.ts')

  it('a tap time is bounded by how long a queued tap lives', () => {
    expect(route).toContain('const oldestReplay = Date.now() - CHECKIN_QUEUE_MAX_AGE_MS')
  })

  it("people with no seat aren't 'the rest' to mark as no-show", () => {
    expect(src('lib/attendanceCloseOut.ts')).toContain('const seated = (r: R) => r.listed ?? (r.status === undefined || r.status === AttendeeStatus.Approved)')
  })

  it('door taps stay out of the dashboard activity strip', () => {
    expect(src('app/admin/page.tsx')).toContain('audit?take=8&exclude=checkin.')
    expect(src('app/api/admin/audit/route.ts')).toContain('if (excludePrefixes.length) where.NOT = excludePrefixes.map(p => ({ action: { startsWith: p } }))')
  })

  it('verifies a scanned card before it writes anything', () => {
    // Judged at the tap time so an offline scan replayed later isn't lost.
    expect(route).toContain('const card = verifyCardToken(cardToken, tapped)')
    expect(route).toContain("code: 'card_expired'")
    expect(route).toContain("code: 'card_invalid'")
    // The retired formats are told apart from a forgery: they sit in cached
    // pages and screenshots, and "reopen the app" is the useful answer.
    expect(route).toContain("code: 'card_outdated'")
    // A code for someone else, presented against another member's row.
    expect(route).toContain('if (card.userId !== userId) {')
    // A host's own tap on the list carries no token and still works.
    expect(route).toContain('if (cardToken !== undefined && cardToken !== null) {')
  })

  it('records who marked whom', () => {
    expect(route).toContain("checkedIn ? 'checkin.set' : 'checkin.cleared'")
    expect(route).toContain('viaScan: cardToken !== undefined && cardToken !== null')
  })

  it('names the waitlisted and the pending instead of calling them strangers', () => {
    expect(route).toContain("where: { eventId, status: { in: ['approved', 'waitlisted', 'pending'] } },")
    expect(route).toContain("listed: a.status === 'approved',")
  })

  it('tells the room the doors are open only when they are', () => {
    expect(route).toContain('const nearStart = Date.now() >= eventStartsAt(eventClock, tz).getTime() - 60 * 60_000')
    // …and the count is only the two-hosts-at-once race guard: gating on it
    // as well meant a host who scanned five early arrivals silenced it.
    expect(route).toContain('if (nearStart && await claimOnce(`checkin-started:${eventId}`')
  })
})

describe('a tap that arrives after the room settled', () => {
  it('has to have happened while the door was open, and within hours not days', async () => {
    const { lateReplayAllowed, LATE_REPLAY_GRACE_HOURS } = await import('@/lib/standingPolicy')
    expect(LATE_REPLAY_GRACE_HOURS).toBe(6)

    const settlesAt = new Date('2026-09-21T21:00:00Z')
    const door = { opensAt: new Date('2026-09-20T08:00:00Z').getTime(), closesAt: settlesAt.getTime() }
    const duringTheEvent = new Date('2026-09-20T19:30:00Z').getTime()
    const justAfterSettle = new Date('2026-09-21T23:00:00Z')

    expect(lateReplayAllowed(duringTheEvent, settlesAt, justAfterSettle, door)).toBe(true)
    // Claimed from three days before the door opened.
    expect(lateReplayAllowed(new Date('2026-09-17T12:00:00Z').getTime(), settlesAt, justAfterSettle, door)).toBe(false)
    // A day later is a dispute, not a replay.
    expect(lateReplayAllowed(duringTheEvent, settlesAt, new Date('2026-09-22T21:00:00Z'), door)).toBe(false)
    expect(lateReplayAllowed('not a number', settlesAt, justAfterSettle, door)).toBe(false)
  })
})

describe('what the device keeps', () => {
  it('signing out clears the door roster and any queued tap', () => {
    expect(src('lib/hostPanel.ts')).toContain('export function clearCachedRosters(): void {')
    const auth = src('contexts/AuthContext.tsx')
    expect(auth).toContain('clearCachedRosters()')
    // Queued taps are sent, not deleted: the door promised they would go,
    // and a host signing out of the shared iPad is where that promise is
    // kept or broken.
    expect(auth).toContain('await drainQueue().catch(() => 0)')
    expect(src('lib/checkinQueue.ts')).toContain('export async function drainQueue(): Promise<number> {')
  })
})

describe('the card itself', () => {
  it('asks the server for its code', () => {
    expect(src('app/api/auth/card/route.ts')).toContain('mintCardToken(session.id)')
    // …and a suspended member doesn't get one.
    expect(src('app/api/auth/card/route.ts')).toContain("user.status !== 'approved'")
  })

  it("the dashboard star means a paid tier, not a value that never existed", () => {
    expect(src('app/(member)/dashboard/page.tsx')).toContain('isPremium(userProfile?.membershipType)')
  })
})
