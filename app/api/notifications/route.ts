import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json([])

    const notifications = await prisma.notification.findMany({
      where: { userId: session.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    })
    return NextResponse.json(notifications)
  } catch (e) {
    console.error(e)
    return NextResponse.json([])
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Lightweight per-user limit. PATCH only touches the caller's
    // own notifications so the abuse ceiling is low, but a
    // misbehaving client could still hammer the route.
    if (!await rateLimit(`notif-patch:${session.id}`, 60, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { id, markAll } = await req.json()

    if (markAll) {
      await prisma.notification.updateMany({
        where: { userId: session.id, isRead: false },
        data: { isRead: true },
      })
    } else if (id) {
      await prisma.notification.updateMany({
        where: { id, userId: session.id },
        data: { isRead: true },
      })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Same per-user gate as PATCH — DELETE is just as cheap to
    // spam and just as easy to misbehave.
    if (!await rateLimit(`notif-delete:${session.id}`, 60, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    if (req.nextUrl.searchParams.get('clearAll') === 'true') {
      await prisma.notification.deleteMany({ where: { userId: session.id } })
      return NextResponse.json({ ok: true })
    }

    const { id } = await req.json()
    if (id) {
      await prisma.notification.deleteMany({ where: { id, userId: session.id } })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
