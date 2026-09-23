import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { newSinceWhere, newMessagesWhere } from '@/lib/notificationBadge'

const PAGE = 30

// One indexed read by primary key, next to counts that already cost more than
// it does. Kept as its own function so both the `count=1` badge path and the
// full feed read the mark the same way.
async function bellSeenAt(userId: string): Promise<Date | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { notificationsSeenAt: true } })
  return u?.notificationsSeenAt ?? null
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // The badges want a number, not thirty rows carrying message previews,
    // twice a minute, per open tab.
    if (req.nextUrl.searchParams.get('count') === '1') {
      const seenAt = await bellSeenAt(session.id)
      const [unreadCount, newCount, unreadMessages, newMessages] = await Promise.all([
        prisma.notification.count({ where: { userId: session.id, isRead: false } }),
        prisma.notification.count({ where: newSinceWhere(session.id, seenAt) }),
        // Broken out because every direct message also writes one of these:
        // the phone's badge added them to the unread-message count and showed
        // one message as two.
        prisma.notification.count({ where: { userId: session.id, isRead: false, type: 'message' } }),
        // The same subtraction, against the new-since count the Me badge now
        // uses — without it the dedup would be taking a lifetime number out
        // of a since-you-looked one and could go negative.
        prisma.notification.count({ where: newMessagesWhere(session.id, seenAt) }),
      ])
      return NextResponse.json({ unreadCount, newCount, unreadMessages, newMessages })
    }

    // Older than a cursor, for "load older" — the list used to be the newest
    // thirty and nothing else: on a busy account the rest were unreachable,
    // and the header counted unread out of that slice.
    const beforeRaw = req.nextUrl.searchParams.get('before')
    const before = beforeRaw && !isNaN(new Date(beforeRaw).getTime()) ? new Date(beforeRaw) : null
    // The id breaks a tie: two rows written in the same millisecond (a
    // bundle restamp, a fan-out) ordered arbitrarily, and a cursor of "older
    // than this instant" could never reach the one that shared it.
    const beforeId = req.nextUrl.searchParams.get('beforeId') ?? undefined
    const olderThanCursor = before
      ? beforeId
        ? { OR: [{ createdAt: { lt: before } }, { createdAt: before, id: { lt: beforeId } }] }
        : { createdAt: { lt: before } }
      : {}

    const seenAt = await bellSeenAt(session.id)
    const [notifications, unreadCount, newCount, unreadMessages] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: session.id, ...olderThanCursor },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PAGE + 1,
      }),
      prisma.notification.count({ where: { userId: session.id, isRead: false } }),
      prisma.notification.count({ where: newSinceWhere(session.id, seenAt) }),
      prisma.notification.count({ where: { userId: session.id, isRead: false, type: 'message' } }),
    ])
    const hasMore = notifications.length > PAGE
    return NextResponse.json({
      notifications: hasMore ? notifications.slice(0, PAGE) : notifications,
      unreadCount,
      newCount,
      unreadMessages,
      hasMore,
    })
  } catch (e) {
    // A failure is not an empty inbox. This used to answer [] with a 200, so
    // an expired session — or a database hiccup — read as "you're all caught
    // up" on the page, the bell and the badge at once.
    console.error('[notifications GET]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
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

    const { id, markAll, seen } = await req.json().catch(() => ({}))
    // `id` went into a Prisma where unchecked, so a filter object in its
    // place ({"not":"x"}) marked every row the caller owns. Same scope as
    // markAll, so no breach — but the route should say what it takes.
    if (id !== undefined && typeof id !== 'string') {
      return NextResponse.json({ error: 'id must be a string' }, { status: 400 })
    }

    // "I opened the bell." Moves the badge's baseline and nothing else — the
    // rows stay unread, because looking at a dropdown is not reading forty
    // notifications. Its own flag rather than a side effect of the GET: a
    // poll every 60s in a background tab would otherwise keep marking the
    // member as having looked at things they never saw.
    if (seen) {
      await prisma.user.update({ where: { id: session.id }, data: { notificationsSeenAt: new Date() } })
      return NextResponse.json({ ok: true })
    }

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
      // How many went, so the page can say it — the confirm used to offer to
      // clear "all" while showing thirty, and delete hundreds including
      // unread ones the member had never seen.
      const { count } = await prisma.notification.deleteMany({ where: { userId: session.id } })
      return NextResponse.json({ ok: true, deleted: count })
    }

    const { id } = await req.json().catch(() => ({}))
    if (id !== undefined && typeof id !== 'string') {
      return NextResponse.json({ error: 'id must be a string' }, { status: 400 })
    }
    if (id) {
      await prisma.notification.deleteMany({ where: { id, userId: session.id } })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
