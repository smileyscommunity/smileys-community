// Newsletter audiences: the one list the admin page, the send route and the
// scheduled-send sweeper all read. They used to keep three copies, and the
// sweeper's fell back to "everyone opted in" for any segment it didn't know,
// so a new segment added to the page and route but not the sweeper would have
// mailed the whole list on its scheduled run. Unknown segments now match no
// one (see recipientWhere) and are refused at the route.
//
// Pure data and Prisma where-objects, no prisma client import, so the client
// page can import the labels.

import { MEMBER_ROLE_FILTER } from '@/lib/memberCount'

export const SEGMENTS = [
  'all', 'new', 'active', 'inactive', 'never_attended_new', 'never_attended_old',
] as const
export type Segment = (typeof SEGMENTS)[number]

export function isSegment(s: unknown): s is Segment {
  return typeof s === 'string' && (SEGMENTS as readonly string[]).includes(s)
}

export const SEGMENT_INFO: Record<Segment, { label: string; desc: string }> = {
  all:                { label: 'All opted-in',               desc: 'Everyone who opted in' },
  new:                { label: 'New members (60d)',          desc: 'Joined in the last 60 days' },
  active:             { label: 'Active members (90d)',       desc: 'Attended an event in the last 90 days' },
  inactive:           { label: 'Inactive members (180d+)',   desc: 'No event attendance in 180+ days' },
  // The "never attended" pair splits one cohort by age so it can be mailed in
  // two batches, the warmer one first. Activated members only: one who never
  // set a password has never seen the site (Retention > Not activated).
  never_attended_new: { label: 'Never attended · joined 7–60d', desc: 'Set up their account, never been to an event, joined 1–8 weeks ago' },
  never_attended_old: { label: 'Never attended · joined 60d+',  desc: 'Set up their account, never been to an event, joined over 60 days ago' },
}

// Activated members only (password set). An approved member who never set a
// password can't sign in, so every newsletter's "Browse upcoming events"
// button landed them on a login they couldn't pass; on 2026-10-13 that was
// 346 people in every send, the weekly digest included. They are reached
// with their own activation link instead (Retention > Not activated).
const BASE_WHERE = { emailMarketing: true, emailVerified: true, status: 'approved', password: { not: null } } as const

// A where that matches no user: the safe answer for a segment we don't know.
const NOBODY = { id: { in: [] as string[] } }

export function recipientWhere(segment: string, cityId?: string, now: Date = new Date()) {
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000)
  // A city id narrows any segment to that city's members.
  const city = cityId ? { cityId } : {}
  const neverAttended = {
    ...BASE_WHERE, ...city,
    password: { not: null },
    role: MEMBER_ROLE_FILTER,
    joinedEvents: { none: { status: 'approved' } },
  }
  switch (segment) {
    case 'all':      return { ...BASE_WHERE, ...city }
    case 'new':      return { ...BASE_WHERE, ...city, joinedAt: { gte: days(60) } }
    case 'active':   return { ...BASE_WHERE, ...city, joinedEvents: { some: { status: 'approved', joinedAt: { gte: days(90) } } } }
    case 'inactive': return { ...BASE_WHERE, ...city, joinedEvents: { none: { status: 'approved', joinedAt: { gte: days(180) } } } }
    // A week's grace, as on Retention: a member approved yesterday hasn't "never attended" yet.
    case 'never_attended_new': return { ...neverAttended, joinedAt: { gte: days(60), lt: days(7) } }
    case 'never_attended_old': return { ...neverAttended, joinedAt: { lt: days(60) } }
    default:         return NOBODY
  }
}
