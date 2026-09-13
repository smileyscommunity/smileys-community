import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { writeAudit } from '@/lib/audit'
import { rateLimit } from '@/lib/rateLimit'
import { UserStatus } from '@/lib/constants'

async function canManage(session: { id: string; role: string } | null, eventId: string) {
  if (!session) return false
  if (session.role === 'admin') return true
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { hostId: true } })
  return event?.hostId === session.id
}

// Every add notifies the member, so add/remove on a loop was a way to spam
// someone's bell. One budget across both verbs, per session.
const COHOST_LIMIT = 30
const COHOST_WINDOW_MS = 10 * 60_000

// userId went straight into Prisma: a number or object threw a validation
// error, an unknown id a P2003 — both unhandled 500s.
async function readUserId(req: NextRequest): Promise<string | null> {
  const body = await req.json().catch(() => null)
  const userId = body && typeof body === 'object' ? (body as { userId?: unknown }).userId : undefined
  return typeof userId === 'string' && userId.trim() ? userId : null
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    const { id } = await params
    if (!await canManage(session, id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const cohosts = await prisma.eventCoHost.findMany({
      where: { eventId: id },
      include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
      orderBy: { addedAt: 'asc' },
    })
    return NextResponse.json(cohosts)
  } catch (e) {
    console.error('[cohosts GET]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    const { id } = await params
    if (!session || !await canManage(session, id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!await rateLimit(`cohosts:${session.id}`, COHOST_LIMIT, COHOST_WINDOW_MS)) {
      return NextResponse.json({ error: 'Too many co-host changes — try again in a few minutes' }, { status: 429 })
    }

    const userId = await readUserId(req)
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const event = await prisma.event.findUnique({ where: { id }, select: { title: true, hostId: true } })
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (event.hostId === userId) return NextResponse.json({ error: 'Already the main host' }, { status: 400 })

    // A co-host runs the door and sees the event chat — only a real, approved
    // member qualifies (pending applicants and suspended accounts don't).
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, status: true } })
    if (!user) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    if (user.status !== UserStatus.Approved) return NextResponse.json({ error: 'Only approved members can be co-hosts' }, { status: 400 })

    const cohost = await prisma.eventCoHost.upsert({
      where: { eventId_userId: { eventId: id, userId } },
      create: { eventId: id, userId },
      update: {},
      include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
    })

    await createNotification(
      userId,
      'host_assigned',
      `You've been added as co-host`,
      `You've been added as a co-host for "${event.title}".`,
      `/events/${id}`,
    )

    // Removes were audited, adds weren't — half the story of who could run an event.
    writeAudit(session.id, session.name, 'event.cohost_add', userId, 'user',
      { eventId: id, eventTitle: event.title, userName: user.name },
      `Added ${user.name ?? userId} as co-host of "${event.title}"`,
    )

    return NextResponse.json(cohost)
  } catch (e) {
    console.error('[cohosts POST]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    const { id } = await params
    if (!session || !await canManage(session, id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!await rateLimit(`cohosts:${session.id}`, COHOST_LIMIT, COHOST_WINDOW_MS)) {
      return NextResponse.json({ error: 'Too many co-host changes — try again in a few minutes' }, { status: 429 })
    }

    const userId = await readUserId(req)
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const [user, event] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      prisma.event.findUnique({ where: { id }, select: { title: true } }),
    ])
    await prisma.eventCoHost.deleteMany({ where: { eventId: id, userId } })
    writeAudit(session.id, session.name, 'event.cohost_remove', userId, 'user',
      { eventId: id, eventTitle: event?.title, userName: user?.name },
      `Removed ${user?.name ?? userId} as co-host of "${event?.title ?? id}"`,
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[cohosts DELETE]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
