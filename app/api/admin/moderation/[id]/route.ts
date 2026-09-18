import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator, canActInCity } from '@/lib/access'
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
    const { action, reviewNote, removeContent } = await req.json()
    // An unknown or missing action used to fall through, mark the report
    // actioned and answer ok with nothing done.
    if (action !== 'dismiss' && action !== 'warn' && action !== 'ban' && action !== 'remove') {
      return NextResponse.json({ error: 'action must be dismiss, warn, ban or remove' }, { status: 400 })
    }

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
    // Fail closed: a missing user used to skip the city check, then `warn`
    // hit prisma.user.update on the missing id and 500'd — after the report
    // row had already been marked actioned.
    // A board report is the post's city's to handle — the city the queue
    // files it under (../route.ts) and the one DELETE /api/board/[id] checks.
    const boardPost = report.boardPostId
      ? await prisma.boardPost.findUnique({ where: { id: report.boardPostId }, select: { id: true, cityId: true, status: true } })
      : null
    const cityOk = boardPost
      ? canActInCity(session, boardPost.cityId)
      : !!reported && session.cityId === reported.cityId
    if (!isAdmin(session) && !cityOk) {
      return NextResponse.json({ error: 'Cross-city moderation is admin-only' }, { status: 403 })
    }
    // Taking the reported post or reply down — on its own ('remove') or with
    // a warning or ban. Staff had no way to: the review actions never touched
    // the content, and the board showed staff only "Report".
    const takeDown = action === 'remove' || ((action === 'warn' || action === 'ban') && removeContent === true)
    if (takeDown && !boardPost) {
      return NextResponse.json({ error: 'Only board posts and replies can be removed from here' }, { status: 400 })
    }
    if (!reported && action !== 'dismiss' && action !== 'remove') {
      return NextResponse.json({ error: 'That member no longer exists — dismiss the report instead' }, { status: 404 })
    }

    // Claimed, not just updated. Two staff acting on the same report — or one
    // working from a tab left open — both went through: a double warning, or
    // a dismissed report flipped to actioned. Only a still-pending report can
    // be acted on, and only once; the loser gets a 409 and nothing else runs.
    const reviewed = {
      status:     action === 'dismiss' ? 'dismissed' : 'actioned',
      reviewNote: reviewNote || null,
      reviewedBy: session.id,
      reviewedAt: new Date(),
    }

    // Dismissing a survey-sourced report means the admin judged the
    // flagged anomaly not real — clear the survey's anomaly flag in the
    // same transaction, or the dashboard anomaly rate keeps counting it
    // for the rest of the 30-day window. Reports created before surveyId
    // existed fall back to the survey's eventId+userId unique key (the
    // reporter is the survey responder).
    const clearsSurvey = action === 'dismiss' && report.reason === 'post_event_survey' && (report.surveyId || report.eventId)
    const claimed = clearsSurvey
      ? await prisma.$transaction(async tx => {
          const { count } = await tx.report.updateMany({ where: { id, status: 'pending' }, data: reviewed })
          if (count === 0) return false
          await tx.eventSurvey.updateMany({
            where: report.surveyId
              ? { id: report.surveyId }
              : { eventId: report.eventId!, userId: report.reporterId },
            data: { anomaly: false },
          })
          return true
        })
      : (await prisma.report.updateMany({ where: { id, status: 'pending' }, data: reviewed })).count > 0
    if (!claimed) {
      return NextResponse.json({ error: 'This report has already been handled' }, { status: 409 })
    }

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

    if (takeDown && boardPost) {
      if (report.boardReplyId) {
        await prisma.boardReply.updateMany({ where: { id: report.boardReplyId, removedAt: null }, data: { removedAt: new Date() } })
      } else {
        await prisma.boardPost.updateMany({ where: { id: boardPost.id, status: 'active' }, data: { status: 'removed', pinned: false } })
      }
      writeAudit(session.id, session.name, report.boardReplyId ? 'board.reply_remove' : 'board.remove',
        report.boardReplyId ?? boardPost.id, report.boardReplyId ? 'board_reply' : 'board_post',
        { reportId: id, userId: report.reportedId, note: reviewNote },
        `Removed a reported board ${report.boardReplyId ? 'reply' : 'post'} by ${reported?.name ?? report.reportedId}`,
      )
    }

    if (action === 'warn' || action === 'ban' || action === 'remove') {
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
      const banReason = reviewNote || 'Banned following community report'
      const banned = await prisma.user.update({
        where: { id: report.reportedId },
        data: {
          status:    'banned',
          banReason,
          bannedAt:  new Date(),
          // The JWT carries status; the bump makes getSession revoke the
          // live cookie on the next request instead of at next login.
          tokenVersion: { increment: 1 },
        },
        select: { email: true, phone: true, name: true },
      })
      // Same two follow-ups the users route does on a ban. Without the
      // blacklist row the apply route finds nothing when they re-apply with
      // a new email — the "no blacklist = re-apply hole" of the 2026-07 wave.
      if (banned.email) {
        await prisma.blacklist.upsert({
          where:  { email: banned.email },
          create: { email: banned.email, phone: banned.phone ?? undefined, name: banned.name ?? undefined, reason: banReason, bannedBy: session.name },
          update: {},
        }).catch(err => console.error('[moderation ban] blacklist upsert failed', { id: report.reportedId, err: String(err) }))
      }
      await prisma.passwordResetToken.deleteMany({ where: { userId: report.reportedId } })
        .catch(err => console.error('[moderation ban] token cleanup failed', { id: report.reportedId, err: String(err) }))
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
