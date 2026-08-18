import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {
  eventAttendee:  { count: vi.fn() },
  waitlistEntry:  { findMany: vi.fn() },
  user:           { findMany: vi.fn() },
} }))

import { prisma } from '@/lib/prisma'
import { hasQuotaRoomFor, findPromotableFromWaitlist } from '@/lib/eventQuota'

// "Let's Get Social 🎧" ended up with 26 approved men against a quota of 25.
// The approval route enforced the cap; waitlist promotion didn't, and took the
// head of the queue whoever they were. So a woman cancelled, the next person in
// line was a man, and the male side stepped over its cap — the queue rule and
// the balance rule each correct alone, never reconciled.

const EVENT = {
  genderBalance:    true,
  maleQuota:        null,   // the real event: inferred from totalSpots
  femaleQuota:      null,
  turkishMaleQuota: null,
  totalSpots:       50,
}

const MAN   = { gender: 'Male',   nationality: 'Germany' }
const WOMAN = { gender: 'female', nationality: 'Italy'   }
const TURKISH_MAN = { gender: 'male', nationality: 'Türkiye' }

// Counts are driven by what the query asks for, so one mock serves every case.
function counts({ males = 0, females = 0, turkishMales = 0 }) {
  ;(prisma.eventAttendee.count as any).mockImplementation(async ({ where }: any) => {
    const g = where?.user?.gender?.in as string[] | undefined
    const nat = where?.user?.nationality?.in as string[] | undefined
    if (g?.includes('male') && nat) return turkishMales
    if (g?.includes('male'))        return males
    if (g?.includes('female'))      return females
    return 0
  })
}

beforeEach(() => vi.clearAllMocks())

describe('hasQuotaRoomFor', () => {
  it('lets anyone in when the event is not gender-balanced', async () => {
    counts({ males: 999 })
    expect(await hasQuotaRoomFor('e1', { ...EVENT, genderBalance: false }, MAN)).toEqual({ ok: true })
  })

  it('infers the male quota as half the spots when none is set — this is the 25', async () => {
    counts({ males: 24 })
    expect(await hasQuotaRoomFor('e1', EVENT, MAN)).toEqual({ ok: true })
    counts({ males: 25 })
    expect(await hasQuotaRoomFor('e1', EVENT, MAN)).toEqual({ ok: false, reason: 'male_quota' })
  })

  it('honours an explicit male quota over the inferred one', async () => {
    counts({ males: 12 })
    expect(await hasQuotaRoomFor('e1', { ...EVENT, maleQuota: 12 }, MAN)).toEqual({ ok: false, reason: 'male_quota' })
  })

  it('caps the female side at half the spots too — gender balance means half and half', async () => {
    // It used to mean "cap the men at half, leave the women uncapped", because
    // a null femaleQuota was read as no limit while maleQuota quietly fell back
    // to totalSpots/2. Ticking the box is understood to mean 25/25 on a 50-spot
    // event, and now does.
    counts({ females: 24 })
    expect(await hasQuotaRoomFor('e1', EVENT, WOMAN)).toEqual({ ok: true })
    counts({ females: 25 })
    expect(await hasQuotaRoomFor('e1', EVENT, WOMAN)).toEqual({ ok: false, reason: 'female_quota' })
  })

  it('honours an explicit female quota over the inferred one', async () => {
    counts({ females: 20 })
    expect(await hasQuotaRoomFor('e1', { ...EVENT, femaleQuota: 20 }, WOMAN)).toEqual({ ok: false, reason: 'female_quota' })
    expect(await hasQuotaRoomFor('e1', { ...EVENT, femaleQuota: 30 }, WOMAN)).toEqual({ ok: true })
  })

  it('applies the Turkish-male sub-quota before the general one, so the reason is specific', async () => {
    // Room on the male side overall, but the sub-quota is full.
    counts({ males: 10, turkishMales: 5 })
    expect(await hasQuotaRoomFor('e1', { ...EVENT, turkishMaleQuota: 5 }, TURKISH_MAN))
      .toEqual({ ok: false, reason: 'turkish_male_quota' })
    // A non-Turkish man is unaffected by it.
    expect(await hasQuotaRoomFor('e1', { ...EVENT, turkishMaleQuota: 5 }, MAN)).toEqual({ ok: true })
  })

  it('counts approved holders only — a pending request holds nothing', async () => {
    counts({ males: 24 })
    await hasQuotaRoomFor('e1', EVENT, MAN)
    for (const call of (prisma.eventAttendee.count as any).mock.calls) {
      expect(call[0].where.status).toBe('approved')
    }
  })

  it('treats an unset gender as unconstrained rather than guessing', async () => {
    counts({ males: 99 })
    expect(await hasQuotaRoomFor('e1', EVENT, { gender: null, nationality: null })).toEqual({ ok: true })
  })

  it('counts a gender outside male/female toward neither side — a decision, not a gap', async () => {
    // 14 approved members are one of these, four of them on gender-balanced
    // events. Eleven chose not to say, so assigning them a side to satisfy a
    // cap would override that choice. Pinned so a future change is deliberate.
    counts({ males: 99, females: 99 })
    for (const gender of ['prefer_not_to_say', 'non_binary', 'other']) {
      expect(await hasQuotaRoomFor('e1', { ...EVENT, femaleQuota: 1 }, { gender, nationality: 'Turkey' }))
        .toEqual({ ok: true })
    }
  })
})

describe('findPromotableFromWaitlist', () => {
  function queue(entries: { id: string; userId: string; user: { gender: string; nationality: string } }[]) {
    ;(prisma.waitlistEntry.findMany as any).mockResolvedValue(entries.map(e => ({ id: e.id, userId: e.userId })))
    ;(prisma.user.findMany as any).mockResolvedValue(entries.map(e => ({ id: e.userId, ...e.user })))
  }

  it('skips the man at the cap and promotes the woman behind him — the actual bug', async () => {
    counts({ males: 25 })
    queue([
      { id: 'w1', userId: 'u-man',   user: MAN as any },
      { id: 'w2', userId: 'u-woman', user: WOMAN as any },
    ])
    expect(await findPromotableFromWaitlist('e1', EVENT)).toEqual({ id: 'w2', userId: 'u-woman' })
  })

  it('still respects queue order when the first in line is eligible', async () => {
    counts({ males: 10 })
    queue([
      { id: 'w1', userId: 'u-man',   user: MAN as any },
      { id: 'w2', userId: 'u-woman', user: WOMAN as any },
    ])
    expect(await findPromotableFromWaitlist('e1', EVENT)).toEqual({ id: 'w1', userId: 'u-man' })
  })

  it('leaves the spot open rather than promoting someone who would unbalance it', async () => {
    counts({ males: 25 })
    queue([{ id: 'w1', userId: 'u-man', user: MAN as any }])
    expect(await findPromotableFromWaitlist('e1', EVENT)).toBeNull()
  })

  it('returns null on an empty waitlist without looking up users', async () => {
    queue([])
    expect(await findPromotableFromWaitlist('e1', EVENT)).toBeNull()
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('skips a waitlist row whose user no longer exists', async () => {
    counts({ males: 0 })
    ;(prisma.waitlistEntry.findMany as any).mockResolvedValue([
      { id: 'w1', userId: 'u-ghost' },
      { id: 'w2', userId: 'u-woman' },
    ])
    ;(prisma.user.findMany as any).mockResolvedValue([{ id: 'u-woman', ...WOMAN }])
    expect(await findPromotableFromWaitlist('e1', EVENT)).toEqual({ id: 'w2', userId: 'u-woman' })
  })
})
