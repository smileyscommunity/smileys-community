import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const { action, reviewNote } = await req.json()
    // action: 'dismiss' | 'warn' | 'ban'

    if (action === 'ban' && !isAdmin(session)) {
      return NextResponse.json({ error: 'Only admins can ban users' }, { status: 403 })
    }

    const report = await prisma.report.findUnique({ where: { id } })
    if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Fetch reported user — name for audit descriptions, cityId for
    // cross-city scope check. Moderators can only action reports
    // against users in their own city; admins act globally.
    const reported = await prisma.user.findUnique({
      where:  { id: report.reportedId },
      select: { name: true, cityId: true, status: true },
    })
    if (!isAdmin(session) && reported && session.cityId !== reported.cityId) {
      return NextResponse.json({ error: 'Cross-city moderation is admin-only' }, { status: 403 })
    }

    await prisma.report.update({
      where: { id },
      data: {
        status:     action === 'dismiss' ? 'dismissed' : 'actioned',
        reviewNote: reviewNote || null,
        reviewedBy: session.id,
        reviewedAt: new Date(),
      },
    })

    if (action === 'dismiss') {
      writeAudit(session.id, session.name, 'report.dismiss', id, 'report',
        { reportedId: report.reportedId, note: reviewNote },
        `Report against ${reported?.name ?? report.reportedId} dismissed${reviewNote ? ` — ${reviewNote}` : ''}`,
      )
      // Notify reporter anonymously
      await createNotification(
        report.reporterId, 'report_reviewed',
        'Your report has been reviewed',
        'Thank you for helping keep Smileys safe. Your report was reviewed and dismissed — no action was needed.',
        undefined,
      )
    }

    if (action === 'warn' || action === 'ban') {
      // Notify reporter that action was taken (anonymously — no details)
      await createNotification(
        report.reporterId, 'report_reviewed',
        'Your report has been reviewed',
        'Thank you for helping keep Smileys safe. Your report was reviewed and appropriate action has been taken.',
        undefined,
      )
    }

    if (action === 'warn') {
      await prisma.user.update({
        where: { id: report.reportedId },
        data: { warningCount: { increment: 1 } },
      })
      await createNotification(
        report.reportedId,
        'warning',
        'Community warning',
        reviewNote || 'Your behaviour has been flagged. Further violations may result in removal.',
        undefined,
      )
      writeAudit(session.id, session.name, 'user.warn', report.reportedId, 'user',
        { reportId: id, note: reviewNote },
        `Warning issued to ${reported?.name ?? report.reportedId}${reviewNote ? ` — "${reviewNote}"` : ''}`,
      )
    }

    if (action === 'ban') {
      // Decrement club memberCount for this user's approved memberships so a
      // banned member stops inflating club counts. Guarded so re-banning an
      // already-banned user can't double-decrement.
      if (reported?.status !== 'banned') {
        const approvedClubs = await prisma.clubMembership.findMany({
          where:  { userId: report.reportedId, status: 'approved' },
          select: { clubId: true },
        })
        if (approvedClubs.length) {
          await prisma.$transaction(approvedClubs.map(m =>
            prisma.club.update({ where: { id: m.clubId }, data: { memberCount: { decrement: 1 } } })
          ))
        }
      }
      await prisma.user.update({
        where: { id: report.reportedId },
        data: {
          status:    'banned',
          banReason: reviewNote || 'Banned following community report',
          bannedAt:  new Date(),
        },
      })
      writeAudit(session.id, session.name, 'user.ban', report.reportedId, 'user',
        { reportId: id, note: reviewNote },
        `${reported?.name ?? report.reportedId} banned — ${reviewNote || 'community report'}`,
      )
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
