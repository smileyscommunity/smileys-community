import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!await rateLimit(`report:${session.id}`, 5, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many reports. Try again later.' }, { status: 429 })
    }

    const { reportedId, reason, details, screenshot, eventId } = await req.json()
    if (!reportedId || !reason) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }
    if (details && details.length > 2000) {
      return NextResponse.json({ error: 'Details too long' }, { status: 400 })
    }
    // Only accept relative upload paths produced by /api/upload (same regex as profilePhoto).
    // The previous check looked for /uploads/ which never matched the real format,
    // so every screenshot was silently dropped.
    const safeScreenshot = (typeof screenshot === 'string' &&
      /^\/app\/api\/files\/[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/.test(screenshot))
      ? screenshot : null
    const VALID_REASONS = ['harassment', 'spam', 'inappropriate', 'fake', 'other']
    if (!VALID_REASONS.includes(reason)) {
      return NextResponse.json({ error: 'Invalid report reason' }, { status: 400 })
    }
    if (reportedId === session.id) {
      return NextResponse.json({ error: 'Cannot report yourself' }, { status: 400 })
    }

    const reportedUser = await prisma.user.findUnique({
      where: { id: reportedId },
      select: { id: true, name: true, status: true },
    })
    if (!reportedUser || reportedUser.status === 'banned') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Prevent duplicate reports
    const existing = await prisma.report.findFirst({
      where: { reporterId: session.id, reportedId, status: 'pending' },
    })
    if (existing) {
      return NextResponse.json({ error: 'You already have a pending report against this user' }, { status: 400 })
    }

    const report = await prisma.report.create({
      data: { reporterId: session.id, reportedId, reason, details: details || null, screenshot: safeScreenshot, eventId: eventId || null },
    })

    const reasonLabel = reason.replace(/_/g, ' ')
    const staff = await prisma.user.findMany({ where: { role: { in: ['admin', 'moderator'] } }, select: { id: true } })
    staff.forEach(s => createNotification(
      s.id,
      'report',
      '🚨 New report',
      `${session.name} reported ${reportedUser.name} for ${reasonLabel}.`,
      '/admin/moderation'
    ))

    // Pattern alert — count distinct reports against this user in the last
    // 30 days. ≥3 means people are organically flagging the same person, not
    // a one-off interpersonal beef. Send a louder staff notification at the
    // threshold so it doesn't get lost in the per-report stream.
    ;(async () => {
      try {
        const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        const recentCount = await prisma.report.count({
          where: { reportedId, createdAt: { gte: monthAgo } },
        })
        if (recentCount >= 3) {
          staff.forEach(s => createNotification(
            s.id,
            'report',
            `⚠️ ${reportedUser.name} has ${recentCount} reports in 30 days`,
            `Pattern alert — ≥3 different reports about the same member. Worth reviewing the account directly.`,
            `/admin/users/${reportedId}`,
          ))
        }
      } catch (e) { console.error('[report aggregation alert]', e) }
    })()

    return NextResponse.json(report)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
