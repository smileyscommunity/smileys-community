import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Scan 6, batch 10 — the spot-opened throttle claimed per member per EVENT
// for six hours. Seat A opened at 17:00, everyone waiting was alerted, one of
// them took it; seat B opened at 18:30 for a 20:00 event and nobody heard
// until 23:00, so it sat empty. The claim is now per seat (the member who
// gave it back), the daily cap stays the flood guard.
//
//   a. a different seat 90 minutes later alerts the rest of the waitlist again
//   b. the same seat released/reclaimed inside the window alerts once
//   c. a caller that can't name the seat falls back to a 30-minute window
//   d. a multi-seat fan-out alerts if any seat is new to the member
//   e. the daily cap still holds, and a capped alert burns no seat claim
//   f. a throttle store failure still sends

const h = vi.hoisted(() => {
  // A rate_limits table in memory, honouring resetAt against the pinned clock.
  const store = new Map<string, { count: number; resetAt: number }>()
  const hit = async (key: string, limit: number, ms: number) => {
    const now = Date.now()
    const row = store.get(key)
    const next = !row || row.resetAt < now ? { count: 1, resetAt: now + ms } : { ...row, count: row.count + 1 }
    store.set(key, next)
    return next.count <= limit
  }
  return {
    store,
    waitlist: [] as string[],
    rateLimit:    vi.fn(hit),
    claimOnce:    vi.fn((key: string, ms: number) => hit(key, 1, ms)),
    releaseClaim: vi.fn(async (key: string) => { store.delete(key) }),
    prisma: {
      event:         { findUnique: vi.fn() },
      waitlistEntry: { findMany: vi.fn() },
      user:          { findMany: vi.fn() },
    },
  }
})

vi.mock('@/lib/rateLimit',  () => ({ rateLimit: h.rateLimit, claimOnce: h.claimOnce, releaseClaim: h.releaseClaim }))
vi.mock('@/lib/prisma',     () => ({ prisma: h.prisma }))
vi.mock('@/lib/notify',     () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/push',       () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/email',      () => ({ sendSpotOpenedEmail: vi.fn().mockResolvedValue(undefined), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/spotsLeft',  () => ({ recomputeSpotsLeft: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/eventQuota', () => ({ hasQuotaRoomFor: vi.fn().mockResolvedValue({ ok: true }), quotaEventSelect: {} }))

import { createNotification } from '@/lib/notify'
import { sendPushToUser } from '@/lib/push'
import { sendSpotOpenedEmail } from '@/lib/email'
import {
  announceSpotOpened, SPOT_ALERT_DAILY_CAP, SPOT_ALERT_SEAT_WINDOW_MS, SPOT_ALERT_UNKNOWN_SEAT_WINDOW_MS,
} from '@/lib/spotOpened'

const EVENT = { title: 'Rooftop dinner', date: '2026-09-15', totalSpots: 10, soldOut: false, limitedSpots: true }
const at = (hhmm: string) => vi.setSystemTime(new Date(`2026-09-15T${hhmm}:00Z`))
const alertsTo = (userId: string) => (createNotification as any).mock.calls.filter((c: any[]) => c[0] === userId).length

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  h.store.clear()
  h.waitlist = ['w1', 'w2', 'w3']
  // The announce read selects the event; the post-recompute read only spotsLeft.
  h.prisma.event.findUnique.mockImplementation(async ({ select }: any) => (select.spotsLeft ? { spotsLeft: 1 } : EVENT))
  h.prisma.waitlistEntry.findMany.mockImplementation(async () => h.waitlist.map(userId => ({ userId })))
  h.prisma.user.findMany.mockImplementation(async ({ where }: any) =>
    where.id.in.map((id: string) => ({ id, name: id, email: `${id}@x`, gender: null, nationality: null })))
})
afterEach(() => { vi.useRealTimers() })

describe('a. a genuinely new seat alerts again', () => {
  it('seat A at 17:00 is claimed; seat B at 18:30 reaches the rest of the waitlist', async () => {
    at('17:00')
    expect(await announceSpotOpened('e1', ['holderA'])).toBe(3)
    h.waitlist = ['w2', 'w3']                      // w1 claimed seat A
    at('18:30')
    expect(await announceSpotOpened('e1', ['holderB'])).toBe(2)
    expect(alertsTo('w2')).toBe(2)
    expect(alertsTo('w3')).toBe(2)
    expect(alertsTo('w1')).toBe(1)
    expect(h.claimOnce).toHaveBeenCalledWith('spot-opened:w2:e1:holderB', SPOT_ALERT_SEAT_WINDOW_MS)
    expect(sendSpotOpenedEmail).toHaveBeenCalledTimes(5)
    expect(sendPushToUser).not.toHaveBeenCalled()  // the notification pushes itself
  })
})

describe('b. the same seat flapping does not re-alert', () => {
  it('one member cancelling, rejoining and cancelling again inside the window is one alert', async () => {
    for (const t of ['17:00', '17:10', '17:25', '18:00', '21:30', '22:59']) {
      at(t)
      await announceSpotOpened('e1', ['flapper'])
    }
    expect(alertsTo('w1')).toBe(1)
    expect(createNotification).toHaveBeenCalledTimes(3)
    // Once the window is over the seat is news again.
    at('23:01')
    expect(await announceSpotOpened('e1', ['flapper'])).toBe(3)
  })
})

describe('c. a caller that cannot name the seat', () => {
  it('waits out a short per-event window, not six hours', async () => {
    expect(SPOT_ALERT_UNKNOWN_SEAT_WINDOW_MS).toBe(30 * 60_000)
    at('17:00')
    expect(await announceSpotOpened('e1')).toBe(3)
    expect(h.claimOnce).toHaveBeenCalledWith('spot-opened:w1:e1', SPOT_ALERT_UNKNOWN_SEAT_WINDOW_MS)
    at('17:20')
    expect(await announceSpotOpened('e1')).toBe(0)
    at('17:31')
    expect(await announceSpotOpened('e1')).toBe(3)
  })
})

describe('d. a multi-seat fan-out (the reconfirm release)', () => {
  it('alerts when any of its seats is new to the member, once per fan-out', async () => {
    at('17:00')
    expect(await announceSpotOpened('e1', ['s1', 's2'])).toBe(3)
    expect(alertsTo('w1')).toBe(1)
    at('17:30')
    expect(await announceSpotOpened('e1', ['s2'])).toBe(0)
    at('18:00')
    expect(await announceSpotOpened('e1', ['s2', 's3'])).toBe(3)
    expect(alertsTo('w1')).toBe(2)
  })
})

describe('e. the daily cap is still the flood guard', () => {
  it('stops at the cap across distinct seats and hands back the capped seat claims', async () => {
    expect(SPOT_ALERT_DAILY_CAP).toBe(5)
    h.waitlist = ['w1']
    for (let i = 1; i <= SPOT_ALERT_DAILY_CAP + 2; i++) {
      at(`${String(10 + i).padStart(2, '0')}:00`)
      await announceSpotOpened('e1', [`seat${i}`])
    }
    expect(alertsTo('w1')).toBe(SPOT_ALERT_DAILY_CAP)
    expect(h.releaseClaim).toHaveBeenCalledWith('spot-opened:w1:e1:seat6')
    expect(h.store.has('spot-opened:w1:e1:seat7')).toBe(false)
    // Next day the capped seat can still reach the member.
    vi.setSystemTime(new Date('2026-09-16T12:00:00Z'))
    expect(await announceSpotOpened('e1', ['seat7'])).toBe(1)
  })
})

describe('f. fail open', () => {
  it('sends when the claim store errors', async () => {
    h.waitlist = ['w1']
    h.claimOnce.mockRejectedValueOnce(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    at('17:00')
    expect(await announceSpotOpened('e1', ['holderA'])).toBe(1)
    expect(sendSpotOpenedEmail).toHaveBeenCalledTimes(1)
    err.mockRestore()
  })

  it('sends when the daily counter errors after the seat claim', async () => {
    h.waitlist = ['w1']
    h.rateLimit.mockRejectedValueOnce(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    at('17:00')
    expect(await announceSpotOpened('e1', ['holderA'])).toBe(1)
    err.mockRestore()
  })
})
