import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    const messages = await prisma.directMessage.findMany({
      where: { OR: [{ fromId: session.id }, { toId: session.id }], deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        from: { select: { id: true, name: true, color: true, profilePhoto: true } },
        to:   { select: { id: true, name: true, color: true, profilePhoto: true } },
      },
    })

    const convMap = new Map<string, {
      partner: { id: string; name: string; color: string; profilePhoto: string | null }
      lastMessage: { text: string; fromMe: boolean; createdAt: string }
      unread: number
    }>()

    for (const msg of messages) {
      const partner = msg.fromId === session.id ? msg.to : msg.from
      const pid = partner.id
      if (!convMap.has(pid)) {
        convMap.set(pid, {
          partner,
          lastMessage: { text: msg.text, fromMe: msg.fromId === session.id, createdAt: msg.createdAt.toISOString() },
          unread: 0,
        })
      }
      if (msg.toId === session.id && !msg.isRead) {
        convMap.get(pid)!.unread++
      }
    }

    return NextResponse.json([...convMap.values()])
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
