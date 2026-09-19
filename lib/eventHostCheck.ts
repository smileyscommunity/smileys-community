import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/session'
import { isAdmin } from '@/lib/access'

/**
 * Whether `hostId` may host an event in `cityId`, as chosen by `session`.
 *
 * The host of an event sees its guest list with contact details, so who the
 * host is was a privilege nobody checked: staff could name a pending, banned
 * or suspended account, or someone in another city, and that account then
 * read every attendee's email and phone. A host is an approved, unsuspended
 * member; for anyone but an admin, one of the event's city, a host of its
 * club or city (or the caller themselves, who already passed those checks).
 */
export async function hostIdError(hostId: unknown, cityId: string, session: SessionUser, clubId?: string | null): Promise<string | null> {
  if (typeof hostId !== 'string' || !hostId) return 'Pick a host'
  const user = await prisma.user.findUnique({
    where:  { id: hostId },
    select: { status: true, suspendedUntil: true, cityId: true },
  })
  if (!user || user.status !== 'approved') return 'That member can\'t host — their account isn\'t active'
  if (user.suspendedUntil && user.suspendedUntil > new Date()) return 'That member is suspended'
  if (!isAdmin(session) && hostId !== session.id && user.cityId !== cityId) {
    // Someone appointed to host here counts wherever they live: a host of the
    // event's club, or a city host of its city (one person hosts in several).
    const [clubHost, cityHost] = await Promise.all([
      clubId ? prisma.clubMembership.findFirst({ where: { userId: hostId, clubId, role: 'host', status: 'approved', club: { isActive: true } }, select: { userId: true } }) : null,
      prisma.cityHost.findFirst({ where: { userId: hostId, cityId, status: 'approved', revokedAt: null }, select: { id: true } }),
    ])
    if (!clubHost && !cityHost) return 'The host has to be a member of the event\'s city, or one of its hosts'
  }
  return null
}
