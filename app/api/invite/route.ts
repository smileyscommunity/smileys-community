import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(randomBytes(8), b => chars[b % chars.length]).join('')
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { referralCode: true, referralCount: true, name: true },
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
        select: { referralCode: true, referralCount: true, name: true },
      })
    } catch {
      // Another concurrent request already saved a code — fetch it
      user = await prisma.user.findUnique({
        where: { id: session.id },
        select: { referralCode: true, referralCount: true, name: true },
      })
      if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

  const [pending, approvedApps, referredApps] = await Promise.all([
    prisma.memberApplication.count({ where: { referredBy: user.referralCode!, status: 'pending' } }),
    prisma.memberApplication.count({ where: { referredBy: user.referralCode!, status: { in: ['approved', 'active'] } } }),
    prisma.memberApplication.findMany({
      where: { referredBy: user.referralCode!, status: { in: ['approved', 'active'] } },
      select: { email: true },
      take: 20,
    }),
  ])

  const joinedUsers = referredApps.length > 0
    ? await prisma.user.findMany({
        where: { email: { in: referredApps.map(a => a.email) } },
        select: { id: true, name: true, color: true, profilePhoto: true, neighborhood: true, joinedAt: true },
        orderBy: { joinedAt: 'desc' },
      })
    : []

  return NextResponse.json({
    code:          user.referralCode,
    referralCount: user.referralCount,
    pending,
    approved: approvedApps,
    joined:   joinedUsers,
  })
}
