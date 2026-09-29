import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { restrictedSetFor } from '@/lib/memberPrivacy'
import { countedReferralsWhere } from '@/lib/referrals'

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(randomBytes(8), b => chars[b % chars.length]).join('')
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // User.referralCount is not selected: nothing ever incremented it, so it
  // disagreed with the approved tally below (lib/referrals).
  let user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { referralCode: true, name: true },
  })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Generate code on first use
  if (!user.referralCode) {
    let code = generateCode()
    // Retry on collision (extremely rare)
    while (await prisma.user.count({ where: { referralCode: code } })) {
      code = generateCode()
    }
    try {
      user = await prisma.user.update({
        where: { id: session.id },
        data: { referralCode: code },
        select: { referralCode: true, name: true },
      })
    } catch {
      // Another concurrent request already saved a code — fetch it
      user = await prisma.user.findUnique({
        where: { id: session.id },
        select: { referralCode: true, name: true },
      })
      if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

  const [pending, approvedApps, referredApps] = await Promise.all([
    // Pending means waiting on the team — an application whose email link was
    // never clicked isn't in review yet (double opt-in, 2026-09-29).
    prisma.memberApplication.count({ where: { referredBy: user.referralCode!, status: 'pending', emailConfirmedAt: { not: null } } }),
    prisma.memberApplication.count({ where: countedReferralsWhere(user.referralCode!) }),
    // Every counted referral, not the first 20: the list stopped there while
    // the tally said 53. Applications move with a member's email change
    // (api/auth/verify-email), so matching by email keeps finding them.
    prisma.memberApplication.findMany({
      where: countedReferralsWhere(user.referralCode!),
      select: { email: true },
      take: 500,
    }),
  ])

  // Only members who can be listed anywhere else: a banned, suspended or
  // admin-hidden account isn't shown as someone you "brought in". They still
  // count in the tally above (the referral happened), and the page says how
  // many aren't listed.
  const joinedUsers = referredApps.length > 0
    ? await prisma.user.findMany({
        where: {
          email: { in: referredApps.map(a => a.email) },
          status: 'approved', hiddenFromMembers: false,
          OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }],
        },
        select: { id: true, name: true, color: true, profilePhoto: true, joinedAt: true, profileVisibility: true },
        orderBy: { joinedAt: 'desc' },
      })
    : []

  // Inviting someone doesn't make you their connection. A 'connections
  // only' member (restrictedSetFor) or one hidden from members gets no
  // photo here, same as anywhere else a non-connection sees them; the name
  // stays, since the referrer is the one who sent it. Neighbourhood is not
  // sent at all — where someone lives is not part of "your invite worked".
  const restricted = await restrictedSetFor(session, joinedUsers)
  // `open`: whether their profile opens for this viewer. A connections-only
  // member's profile is locked to a non-connection, so the page doesn't link it.
  const joined = joinedUsers.map(u => {
    const locked = restricted.has(u.id)
    return { id: u.id, name: u.name, color: u.color, profilePhoto: locked ? null : u.profilePhoto, joinedAt: u.joinedAt, open: !locked }
  })

  return NextResponse.json({
    code:          user.referralCode,
    // Kept in the payload for older clients; same number as `approved`.
    referralCount: approvedApps,
    pending,
    approved: approvedApps,
    joined,
  })
}
