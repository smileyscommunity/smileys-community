import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { restrictedSetFor } from '@/lib/memberPrivacy'
import { firstNameOf } from '@/lib/data'
import { Prisma } from '@prisma/client'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    // One row per conversation via DISTINCT ON. The old approach derived
    // conversations from the 200 newest messages ACROSS ALL THREADS, so a
    // single busy thread (the rate limit allows 200/day) evicted every
    // other conversation from the inbox entirely and undercounted unreads.
    const rows = await prisma.$queryRaw<{ fromId: string; toId: string; text: string; imageUrl: string | null; createdAt: Date }[]>(Prisma.sql`
      -- The LIMIT has to apply to conversations ordered by RECENCY. It used
      -- to sit on the DISTINCT ON output, which postgres orders by partner id,
      -- so past 100 threads the ones kept were the 100 lowest ids — a message
      -- that arrived this morning could be missing from the inbox entirely,
      -- and its unread count missing from the badge with it.
      SELECT * FROM (
        SELECT DISTINCT ON (partner) "fromId", "toId", text, "imageUrl", "createdAt", partner
        FROM (
          SELECT "fromId", "toId", text, "imageUrl", "createdAt",
                 CASE WHEN "fromId" = ${session.id} THEN "toId" ELSE "fromId" END AS partner
          FROM direct_messages
          WHERE ("fromId" = ${session.id} OR "toId" = ${session.id}) AND "deletedAt" IS NULL
        ) m
        ORDER BY partner, "createdAt" DESC
      ) latest
      ORDER BY "createdAt" DESC
      LIMIT 100
    `)

    // Unread counts per sender — real totals, not "unreads that happened to
    // land in the window".
    const unreadRows = await prisma.directMessage.groupBy({
      by:     ['fromId'],
      where:  { toId: session.id, isRead: false, deletedAt: null },
      _count: { _all: true },
    })
    const unreadBySender = new Map(unreadRows.map(r => [r.fromId, r._count._all]))

    const partnerIds = rows.map(r => (r.fromId === session.id ? r.toId : r.fromId))
    const partners = await prisma.user.findMany({
      where:  { id: { in: partnerIds } },
      select: { id: true, name: true, color: true, profilePhoto: true, profileVisibility: true },
    })
    const partnerById = new Map(partners.map(p => [p.id, p]))

    // A blocked pair sees nothing of each other anywhere else, but the
    // conversation stayed in the inbox with its preview and its unread count
    // — an unread badge that could never be cleared, since opening the thread
    // is refused.
    const blocks = await prisma.memberBlock.findMany({
      where:  { OR: [{ blockerId: session.id }, { blockedId: session.id }] },
      select: { blockerId: true, blockedId: true },
    })
    // Someone who blocked ME: the thread is closed, so it leaves the inbox.
    const blockedMe  = new Set(blocks.filter(b => b.blockerId !== session.id).map(b => b.blockerId))
    // Someone I blocked: the thread stays, read-only. Dropping it left the
    // history with no way in — and reporting a harasser is exactly the moment
    // a member needs it.
    const iBlocked   = new Set(blocks.filter(b => b.blockerId === session.id).map(b => b.blockedId))

    // The same rule the rest of the product applies: a connections-only
    // member the viewer isn't connected to is a first name and no photo. This
    // route sent the full name and the photo, which is precisely what that
    // setting hides — and a thread can exist without a connection (they
    // answered your board listing, or the connection was removed later).
    const restricted = await restrictedSetFor(session, partners)

    const conversations = rows
      .flatMap(r => {
        const pid = r.fromId === session.id ? r.toId : r.fromId
        const partner = partnerById.get(pid)
        if (!partner || blockedMe.has(pid)) return []
        const isRestricted = restricted.has(pid)
        return [{
          partner: {
            id:           partner.id,
            name:         isRestricted ? firstNameOf(partner.name) : partner.name,
            color:        partner.color,
            profilePhoto: isRestricted ? null : partner.profilePhoto,
            restricted:   isRestricted,
          },
          // Truncated here rather than in CSS: the whole 2000 characters of
          // every conversation's last message went to the browser to render
          // one clipped line. A photo with no caption had nothing to show.
          preview: { text: r.text.slice(0, 120), hasImage: !!r.imageUrl },
          fromMe: r.fromId === session.id,
          // Nothing new can arrive in a thread I closed, and an unread count
          // on it could never be cleared.
          unread: iBlocked.has(pid) ? 0 : (unreadBySender.get(pid) ?? 0),
          blocked: iBlocked.has(pid),
          lastAt: r.createdAt.toISOString(),
        }]
      })

    // Every thread's unreads, not just this page of 100 — the badge has to
    // agree with the inbox for someone with more conversations than that.
    // Blocked either way is excluded: unreachable, so never clearable.
    const totalUnread = unreadRows.reduce(
      (n, r) => (blockedMe.has(r.fromId) || iBlocked.has(r.fromId) ? n : n + r._count._all), 0)

    return NextResponse.json({ conversations, totalUnread })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
