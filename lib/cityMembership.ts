// ── One account, many cities ────────────────────────────────────────────────
//
// The promise the multi-city product rests on: you live in Istanbul, you spend
// a month in Athens, and your profile, interests and history come with you
// rather than being re-registered.
//
// The model deliberately keeps two different things apart:
//
//   HOME city  — User.cityId. Exactly one, required, and what scopes a
//                member's default feeds. Dozens of call sites read it; it is
//                the answer to "where does this person live".
//   JOINED /   — rows in CityRelationship: type 'member' for additional
//   INTERESTED   cities they belong to, 'interested' for pre-launch waiting
//                lists. One row per (user, city) — interest transitions to
//                membership on launch, never coexists with it.
//
// Keeping home OUT of the relationship table means there is no way for the
// two to disagree — the failure mode where a member's home city says Istanbul
// and their relationship rows say otherwise simply can't be represented.

import { prisma } from './prisma'
import { CITY_STATUS } from './cityStatus'
import { resolveCityId } from './city'

export interface MemberCity {
  id:     string
  slug:   string
  name:   string
  status: string
  home:   boolean
}

/**
 * Every city a member belongs to, home first.
 *
 * Home is read from the user row rather than the join table, so this is
 * correct even for a member who has never joined a second city.
 */
export async function getMemberCities(userId: string): Promise<MemberCity[]> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: {
      city:              { select: { id: true, slug: true, name: true, status: true } },
      cityRelationships: {
        where:   { type: 'member' },
        select:  { city: { select: { id: true, slug: true, name: true, status: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!user) return []

  return [
    { ...user.city, home: true },
    ...user.cityRelationships.map(m => ({ ...m.city, home: false })),
  ]
}

/** Just the ids — for scoping a query to everywhere this member belongs. */
export async function getMemberCityIds(userId: string): Promise<string[]> {
  return (await getMemberCities(userId)).map(c => c.id)
}

/**
 * Which city a member may FILE new content into.
 *
 * `resolveCityId` answers "which city am I looking at", and the view-city
 * cookie wins there — deliberately, and it lasts a year (see the trap
 * documented in lib/city.ts). That is the right answer for a feed and the
 * wrong one for a write: one click into another city's shopfront otherwise
 * files your next room listing there, and because alert fan-out matches
 * subscribers on their HOME city, the listing then reaches nobody at all —
 * not the city it was filed to (no subscribers there yet) and not your own.
 *
 * So the viewed city counts only when the poster actually belongs to it —
 * their home city, or one they've joined. Otherwise content lands at home,
 * where their audience is.
 */
export async function resolvePostingCityId(session: { id: string; cityId?: string }): Promise<string> {
  const viewed = await resolveCityId(session)
  const home   = session.cityId ?? viewed
  if (viewed === home) return home
  return (await getMemberCityIds(session.id)).includes(viewed) ? viewed : home
}

export type JoinResult =
  | { ok: true;  alreadyMember: boolean; city: { id: string; slug: string; name: string } }
  | { ok: false; error: string }

/**
 * Join a city by slug.
 *
 * Only `live` cities can be joined: a member who joins a city with no clubs,
 * events or people has been given an empty room, which is the same mistake the
 * city cards and the go-live guard exist to prevent. Joining your own home city
 * is a no-op success rather than an error — the caller usually can't tell, and
 * the outcome they wanted ("I'm in this city") is already true.
 */
export async function joinCity(userId: string, slug: string): Promise<JoinResult> {
  const [user, city] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { cityId: true, status: true } }),
    prisma.city.findUnique({ where: { slug }, select: { id: true, slug: true, name: true, status: true } }),
  ])
  if (!user) return { ok: false, error: 'Member not found' }
  if (!city) return { ok: false, error: 'City not found' }
  // Checked here rather than at the route: a pending member still holds a
  // valid session (they can sign in while awaiting approval), and joining a
  // second community would route them into feeds their status doesn't allow.
  // Keeping the rule with the operation means any future caller inherits it.
  if (user.status !== 'approved') {
    return { ok: false, error: 'Your membership needs to be approved first' }
  }
  if (city.status !== CITY_STATUS.Live) {
    return { ok: false, error: `${city.name} isn't open to join yet — we'll let you know when it launches.` }
  }

  if (city.id === user.cityId) {
    return { ok: true, alreadyMember: true, city }
  }

  // Idempotent: a double-tap or a retried request must not 500 on the unique
  // constraint, and must not read as a different outcome. A pre-launch
  // 'interested' row transitions to 'member' here — that's the launch-day
  // promise ("we'll let you know") being kept, not a new relationship.
  const existing = await prisma.cityRelationship.findUnique({
    where:  { userId_cityId: { userId, cityId: city.id } },
    select: { id: true, type: true },
  })
  if (existing?.type === 'member') return { ok: true, alreadyMember: true, city }

  if (existing) {
    await prisma.cityRelationship.update({ where: { id: existing.id }, data: { type: 'member' } })
  } else {
    await prisma.cityRelationship.create({ data: { userId, cityId: city.id, type: 'member' } })
  }
  return { ok: true, alreadyMember: false, city }
}

export type MoveResult =
  | { ok: true;  alreadyHome: boolean; city: { id: string; slug: string; name: string } }
  | { ok: false; error: string }

/**
 * Change the member's home city — the deliberate "I moved" flow the Leave
 * button points at.
 *
 * Semantics (owner decision, 2026-08-16): history stays reachable. The old
 * home becomes a joined city rather than vanishing from the member's list,
 * so their old-city clubs and RSVPs keep a city they still belong to. Any
 * join row for the NEW home is removed, because home lives on User.cityId
 * only — the two representations must never overlap.
 */
export async function setHomeCity(userId: string, slug: string): Promise<MoveResult> {
  const [user, city] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { cityId: true, status: true } }),
    prisma.city.findUnique({ where: { slug }, select: { id: true, slug: true, name: true, status: true } }),
  ])
  if (!user) return { ok: false, error: 'Member not found' }
  if (!city) return { ok: false, error: 'City not found' }
  if (user.status !== 'approved') {
    return { ok: false, error: 'Your membership needs to be approved first' }
  }
  // Same rule as joining: home must be a live city, or every feed empties.
  if (city.status !== CITY_STATUS.Live) {
    return { ok: false, error: `${city.name} isn't open yet — your home city has to be a live one.` }
  }
  if (city.id === user.cityId) return { ok: true, alreadyHome: true, city }

  const oldCityId = user.cityId
  // One transaction: a crash must not change home without keeping the old
  // city, or keep the old city without changing home. Upsert (not create)
  // for the old home, so a stale 'interested' row from before that city
  // went live becomes the membership it should be.
  await prisma.$transaction([
    prisma.cityRelationship.upsert({
      where:  { userId_cityId: { userId, cityId: oldCityId } },
      create: { userId, cityId: oldCityId, type: 'member' },
      update: { type: 'member' },
    }),
    prisma.cityRelationship.deleteMany({ where: { userId, cityId: city.id } }),
    prisma.user.update({ where: { id: userId }, data: { cityId: city.id } }),
  ])
  return { ok: true, alreadyHome: false, city }
}

export type LeaveResult = { ok: true } | { ok: false; error: string }

/**
 * Leave a joined city. The home city can't be left — that's a "move city"
 * operation, which changes what every feed shows and belongs behind its own
 * deliberate flow rather than a Leave button.
 */
export async function leaveCity(userId: string, slug: string): Promise<LeaveResult> {
  const [user, city] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { cityId: true } }),
    prisma.city.findUnique({ where: { slug }, select: { id: true, name: true } }),
  ])
  if (!user) return { ok: false, error: 'Member not found' }
  if (!city) return { ok: false, error: 'City not found' }
  if (city.id === user.cityId) {
    return { ok: false, error: `${city.name} is your home city — change it in your profile instead.` }
  }

  // deleteMany, not delete: leaving a city you aren't in should succeed
  // quietly rather than throw on a missing row. Scoped to 'member' — a
  // Leave button must not silently drop a waiting-list registration.
  await prisma.cityRelationship.deleteMany({ where: { userId, cityId: city.id, type: 'member' } })
  return { ok: true }
}
