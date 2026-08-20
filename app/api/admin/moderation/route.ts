import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canModerateReports, isAdmin, failClosedCityId } from '@/lib/access'
import { neighborhoodToSlug } from '@/lib/neighborhoods'

export async function GET() {
  try {
    const session = await getSession()
    if (!session || !canModerateReports(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Reports don't carry cityId directly; they're scoped via the
    // reported user's cityId. Moderators see only reports against
    // users in their own city. Admins see everything.
    // Admins see every city; a moderator sees only reports about their own
    // city's members. A city-less moderator must fail CLOSED (match nothing),
    // not fall through to the admin all-cities view — the bug this replaces.
    const cityFilter = isAdmin(session)
      ? {}
      : { reported: { is: { cityId: failClosedCityId(session) } } }

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

    // Same gap, same fix, for Marketplace listing reports (Report.listingId,
    // created by /api/listings/[id]/report) — previously invisible in this
    // queue despite the reuse-the-Report-model comment on that route saying
    // it was meant to surface here.
    const listingIds = [...new Set(reports.flatMap(r => r.listingId ? [r.listingId] : []))]
    const listings = listingIds.length
      ? await prisma.listing.findMany({ where: { id: { in: listingIds } }, select: { id: true, title: true, category: true, status: true } })
      : []
    const listingMap = new Map(listings.map(l => [l.id, l]))

    // Same gap again, for neighborhood-wall reports (Report.neighborhoodPostId,
    // created by /api/neighborhoods/[slug]/posts/[postId]/report). No admin
    // page exists for NeighborhoodPost — the neighborhood slug lets staff jump
    // to the page and use the existing in-place Delete action there.
    const neighborhoodPostIds = [...new Set(reports.flatMap(r => r.neighborhoodPostId ? [r.neighborhoodPostId] : []))]
    const neighborhoodPosts = neighborhoodPostIds.length
      ? await prisma.neighborhoodPost.findMany({ where: { id: { in: neighborhoodPostIds } }, select: { id: true, content: true, neighborhood: true } })
      : []
    const neighborhoodPostMap = new Map(neighborhoodPosts.map(p => [p.id, { ...p, slug: neighborhoodToSlug(p.neighborhood) }]))

    // How many members have blocked the reported user. Blocking is the
    // quietest safety signal we collect — nobody has to write anything or
    // wait for a moderator — and until now it was recorded and never shown,
    // so a report against someone three people had already blocked looked
    // identical to a first-time complaint. One number changes the triage.
    const reportedIds = [...new Set(reports.map(r => r.reportedId))]
    const blockCounts = reportedIds.length
      ? await prisma.memberBlock.groupBy({
          by:    ['blockedId'],
          where: { blockedId: { in: reportedIds } },
          _count: { blockedId: true },
        })
      : []
    const blockMap = new Map(blockCounts.map(b => [b.blockedId, b._count.blockedId]))

    return NextResponse.json(reports.map(r => ({
      ...r,
      reportedBlockCount: blockMap.get(r.reportedId) ?? 0,
      event:            r.eventId            ? (eventMap.get(r.eventId)                      ?? null) : null,
      boardPost:        r.boardPostId        ? (boardPostMap.get(r.boardPostId)              ?? null) : null,
      listing:          r.listingId          ? (listingMap.get(r.listingId)                  ?? null) : null,
      neighborhoodPost: r.neighborhoodPostId ? (neighborhoodPostMap.get(r.neighborhoodPostId) ?? null) : null,
    })))
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
