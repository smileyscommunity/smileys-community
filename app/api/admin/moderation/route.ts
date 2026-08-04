import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canModerateReports, isAdmin } from '@/lib/access'

export async function GET() {
  try {
    const session = await getSession()
    if (!session || !canModerateReports(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Reports don't carry cityId directly; they're scoped via the
    // reported user's cityId. Moderators see only reports against
    // users in their own city. Admins see everything.
    const cityFilter = isAdmin(session) || !session.cityId
      ? {}
      : { reported: { is: { cityId: session.cityId } } }

    const reports = await prisma.report.findMany({
      where:   cityFilter,
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: { select: { id: true, name: true, email: true, color: true } },
        reported: { select: { id: true, name: true, email: true, color: true, status: true, role: true } },
      },
    })

    // Attach event title for reports that carry an eventId (e.g. post-event survey flags).
    const eventIds = [...new Set(reports.flatMap(r => r.eventId ? [r.eventId] : []))]
    const events = eventIds.length
      ? await prisma.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, title: true } })
      : []
    const eventMap = new Map(events.map(e => [e.id, e]))

    // Attach the reported post's title/body for board-post reports — without
    // this a boardPostId report showed up with no indication of what was
    // actually flagged, since there's no admin page for BoardPost to link to.
    const boardPostIds = [...new Set(reports.flatMap(r => r.boardPostId ? [r.boardPostId] : []))]
    const boardPosts = boardPostIds.length
      ? await prisma.boardPost.findMany({ where: { id: { in: boardPostIds } }, select: { id: true, title: true, body: true, status: true } })
      : []
    const boardPostMap = new Map(boardPosts.map(p => [p.id, p]))

    return NextResponse.json(reports.map(r => ({
      ...r,
      event:     r.eventId     ? (eventMap.get(r.eventId)         ?? null) : null,
      boardPost: r.boardPostId ? (boardPostMap.get(r.boardPostId) ?? null) : null,
    })))
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
