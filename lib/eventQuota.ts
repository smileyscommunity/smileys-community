// ── Gender-balance quotas, in one place ─────────────────────────────────────
//
// A gender-balanced event caps how many men can hold a spot. The approval
// route enforced that; the two routes that promote someone off the WAITLIST
// did not, and a promotion is just as much a way to hold a spot.
//
// So on "Let's Get Social 🎧" — quota 25, inferred from totalSpots/2 — 26 men
// ended up approved. The mechanism is mundane: a woman cancels, and the
// promotion takes `findFirst(orderBy: createdAt asc)`, the first person in the
// queue whoever they are. Her spot goes to a man, and the male side steps past
// its cap. The queue rule and the balance rule were each correct alone and
// nobody had reconciled them.
//
// The reconciliation here: the queue still decides the ORDER, and the quota
// decides who is ELIGIBLE. The first eligible person in line is promoted, and
// anyone skipped keeps their place for a spot their side can take.

import { prisma } from './prisma'
import { getRsvpGate } from './noShow'

// Gender and nationality are free text on the user record, so compare against
// the spellings actually seen rather than assuming a canonical case.
export const MALE_VARIANTS   = ['male', 'Male', 'MALE']
export const FEMALE_VARIANTS = ['female', 'Female', 'FEMALE']
export const TURKEY_VARIANTS = ['Turkey', 'turkey', 'Türkiye', 'türkiye', 'Turkiye', 'TR']

export interface QuotaEvent {
  genderBalance:    boolean
  maleQuota:        number | null
  femaleQuota:      number | null
  turkishMaleQuota: number | null
  totalSpots:       number
}

/** The columns hasQuotaRoomFor needs — for callers building their own select. */
export const quotaEventSelect = {
  genderBalance:    true,
  maleQuota:        true,
  femaleQuota:      true,
  turkishMaleQuota: true,
  totalSpots:       true,
} as const

export type QuotaBlock = 'male_quota' | 'female_quota' | 'turkish_male_quota'

/**
 * Can this person take an approved spot without breaking the event's balance?
 *
 * Counts APPROVED holders only — pending requests aren't holding anything, and
 * counting them here would double-block. (The RSVP request path deliberately
 * allows a 2× pool of candidates for a host to choose between; that's a
 * different question from who may hold a spot.)
 *
 * A null quota on either side falls back to half the spots. That is what
 * "gender balance" is understood to mean when it's ticked, and only the male
 * side used to honour it.
 *
 * A gender outside male/female counts toward NEITHER side, and that is a
 * decision, not an oversight. 14 approved members are prefer_not_to_say (11),
 * non_binary (2) or other (1), and four of them are on gender-balanced events.
 * Eleven have explicitly declined to say, so assigning them a side to satisfy a
 * cap would override the thing they chose. The cost is real and small: a
 * 25/25 event can seat those few beyond the gender split, though totalSpots
 * still caps the room. Reviewed 2026-08-18 and deliberately left as is.
 */
export async function hasQuotaRoomFor(
  eventId: string,
  event: QuotaEvent,
  user: { gender: string | null; nationality: string | null },
): Promise<{ ok: true } | { ok: false; reason: QuotaBlock }> {
  if (!event.genderBalance) return { ok: true }

  const gender    = (user.gender ?? '').trim().toLowerCase()
  const isMale    = gender === 'male'
  const isFemale  = gender === 'female'
  const isTurkish = TURKEY_VARIANTS.some(v => v.toLowerCase() === (user.nationality ?? '').trim().toLowerCase())

  if (isMale) {
    if (event.turkishMaleQuota != null && isTurkish) {
      const turkishMales = await prisma.eventAttendee.count({
        where: { eventId, status: 'approved', user: { gender: { in: MALE_VARIANTS }, nationality: { in: TURKEY_VARIANTS } } },
      })
      if (turkishMales >= event.turkishMaleQuota) return { ok: false, reason: 'turkish_male_quota' }
    }
    const maleQuota = event.maleQuota ?? Math.floor(event.totalSpots / 2)
    const males = await prisma.eventAttendee.count({
      where: { eventId, status: 'approved', user: { gender: { in: MALE_VARIANTS } } },
    })
    if (males >= maleQuota) return { ok: false, reason: 'male_quota' }
  }

  if (isFemale) {
    // Mirrors the male side, including the fallback. Ticking "gender balance"
    // is meant to mean half and half; it used to mean "cap the men at half,
    // leave the women uncapped", because null was read as no limit here while
    // the male side quietly fell back to totalSpots/2.
    const femaleQuota = event.femaleQuota ?? Math.floor(event.totalSpots / 2)
    const females = await prisma.eventAttendee.count({
      where: { eventId, status: 'approved', user: { gender: { in: FEMALE_VARIANTS } } },
    })
    if (females >= femaleQuota) return { ok: false, reason: 'female_quota' }
  }

  return { ok: true }
}

/**
 * The first person in the waitlist queue who may actually take the open spot.
 *
 * Order is still first-come — being skipped costs nobody their place, it just
 * means this particular spot wasn't one their side could take. Returns null
 * when nobody in the queue is eligible, which is a real outcome: the spot stays
 * open rather than going to someone who would unbalance the event.
 *
 * Deliberately sequential. A waitlist is a handful of people, and each check is
 * an indexed count; doing them in order is what makes "first eligible" mean
 * what it says.
 */
export async function findPromotableFromWaitlist(
  eventId: string,
  event: QuotaEvent,
): Promise<{ id: string; userId: string } | null> {
  const queue = await prisma.waitlistEntry.findMany({
    where:   { eventId },
    orderBy: { createdAt: 'asc' },
    select:  { id: true, userId: true },
  })
  if (queue.length === 0) return null

  // WaitlistEntry carries a userId but no Prisma relation, so the genders come
  // from one keyed lookup rather than a join.
  const users = await prisma.user.findMany({
    where:  { id: { in: queue.map(q => q.userId) } },
    select: { id: true, gender: true, nationality: true },
  })
  const byId = new Map(users.map(u => [u.id, u]))

  for (const entry of queue) {
    const user = byId.get(entry.userId)
    // A waitlist row whose user has vanished is not promotable; skip rather
    // than treating unknown as eligible.
    if (!user) continue
    const room = await hasQuotaRoomFor(eventId, event, user)
    if (!room.ok) continue
    // A member whose RSVPs are paused keeps their place in line only until
    // the block starts (activation clears their waitlists); between the two
    // sweeps this is what keeps them from being promoted into a spot.
    const gate = await getRsvpGate(entry.userId)
    if (!gate.ok && gate.code === 'red_card_blocked') continue
    return { id: entry.id, userId: entry.userId }
  }
  return null
}
