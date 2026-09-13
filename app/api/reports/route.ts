import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit, getIp, claimOnce, releaseClaim } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!await rateLimit(`report:${session.id}`, 5, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many reports. Try again later.' }, { status: 429 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    const { reportedId, reason, details, screenshot, eventId } = body
    if (typeof reportedId !== 'string' || !reportedId || typeof reason !== 'string' || !reason) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }
    if (details != null && typeof details !== 'string') {
      return NextResponse.json({ error: 'Details must be text' }, { status: 400 })
    }
    if (details && details.length > 2000) {
      return NextResponse.json({ error: 'Details too long' }, { status: 400 })
    }
    // eventId is a foreign key: an unknown id used to surface as a 500.
    if (eventId != null && (typeof eventId !== 'string' || !await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } }))) {
      return NextResponse.json({ error: 'Unknown event' }, { status: 400 })
    }
    // Only accept relative upload paths produced by /api/upload (same regex as profilePhoto).
    // The previous check looked for /uploads/ which never matched the real format,
    // so every screenshot was silently dropped.
    const safeScreenshot = (typeof screenshot === 'string' &&
      /^\/app\/api\/files\/[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/.test(screenshot))
      ? screenshot : null
    // Canonical reason set — must match components/ReportButton REASONS.
    const VALID_REASONS = ['harassment', 'inappropriate', 'fake', 'spam', 'offensive', 'other']
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
    // Report has no unique on (reporter, reported): two concurrent POSTs
    // both passed the check above and made two pending rows (and two staff
    // pushes). The claim serialises them.
    if (!await claimOnce(`report:${session.id}:${reportedId}`, 60_000)) {
      return NextResponse.json({ error: 'You already have a pending report against this user' }, { status: 400 })
    }

    const report = await prisma.report.create({
      data: { reporterId: session.id, reportedId, reason, details: details || null, screenshot: safeScreenshot, eventId: eventId || null },
    })
      // The claim was taken before this write; hand it back if the write fails,
      // or a retry is refused as a duplicate of a report that doesn't exist.
      .catch(async (e: unknown) => { await releaseClaim(`report:${session.id}:${reportedId}`); throw e })

    const reasonLabel = reason.replace(/_/g, ' ')
    const staff = await prisma.user.findMany({ where: { role: { in: ['admin', 'moderator'] } }, select: { id: true } })
    staff.forEach(s => createNotification(
      s.id,
      'report',
      '🚨 New report',
      `${session.name} reported ${reportedUser.name} for ${reasonLabel}.`,
      '/admin/moderation'
    ).catch(() => {}))

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
          ).catch(() => {}))
        }
      } catch (e) { console.error('[report aggregation alert]', e) }
    })()

    return NextResponse.json(report)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
