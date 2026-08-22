import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { Prisma } from '@prisma/client'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    // One row per conversation via DISTINCT ON. The old approach derived
    // conversations from the 200 newest messages ACROSS ALL THREADS, so a
    // single busy thread (the rate limit allows 200/day) evicted every
    // other conversation from the inbox entirely and undercounted unreads.
    const rows = await prisma.$queryRaw<{ fromId: string; toId: string; text: string; createdAt: Date }[]>(Prisma.sql`
      SELECT DISTINCT ON (partner) "fromId", "toId", text, "createdAt"
      FROM (
        SELECT "fromId", "toId", text, "createdAt",
               CASE WHEN "fromId" = ${session.id} THEN "toId" ELSE "fromId" END AS partner
        FROM direct_messages
        WHERE ("fromId" = ${session.id} OR "toId" = ${session.id}) AND "deletedAt" IS NULL
      ) m
      ORDER BY partner, "createdAt" DESC
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
      select: { id: true, name: true, color: true, profilePhoto: true },
    })
    const partnerById = new Map(partners.map(p => [p.id, p]))

    const conversations = rows
      .flatMap(r => {
        const pid = r.fromId === session.id ? r.toId : r.fromId
        const partner = partnerById.get(pid)
        if (!partner) return []
        return [{
          partner,
          lastMessage: { text: r.text, fromMe: r.fromId === session.id, createdAt: r.createdAt.toISOString() },
          unread: unreadBySender.get(pid) ?? 0,
        }]
      })
      .sort((a, b) => (a.lastMessage.createdAt < b.lastMessage.createdAt ? 1 : -1))

    return NextResponse.json(conversations)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
