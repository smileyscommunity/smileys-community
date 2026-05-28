import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { isAdminOrModerator, isClubHost } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ userId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    const { userId: otherId } = await params
    const { searchParams } = new URL(req.url)
    const since = searchParams.get('since')

    const messages = await prisma.directMessage.findMany({
      where: {
        OR: [
          { fromId: session.id, toId: otherId },
          { fromId: otherId,    toId: session.id },
        ],
        ...(since ? { createdAt: { gt: new Date(since) } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      include: {
        from: { select: { id: true, name: true, color: true, profilePhoto: true } },
        // Reactions ship with the message so the UI doesn't need a second
        // request per message. Small list (1 row per reactor) so payload
        // stays compact.
        reactions: { select: { userId: true, emoji: true } },
        // Quoted-message snippet for reply chips. We embed a snippet rather
        // than relying on the client having the parent in the same batch —
        // a reply might quote an older message that was paginated out.
        replyTo: {
          select: {
            id: true,
            text: true,
            imageUrl: true,
            from: { select: { id: true, name: true } },
          },
        },
      },
    })

    // Mark incoming messages as read
    await prisma.directMessage.updateMany({
      where: { fromId: otherId, toId: session.id, isRead: false },
      data:  { isRead: true },
    })

    return NextResponse.json(messages)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    const { userId: toId } = await params
    if (toId === session.id) return NextResponse.json({ error: 'Cannot message yourself' }, { status: 400 })
    if (!await rateLimit(`dm:${session.id}`, 60, 60_000)) {
      return NextResponse.json({ error: 'Sending too fast — slow down' }, { status: 429 })
    }

    const { text, imageUrl, replyToId } = await req.json()
    const hasText  = typeof text === 'string' && text.trim().length > 0
    const hasImage = typeof imageUrl === 'string' && imageUrl.length > 0
    if (!hasText && !hasImage) return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 })
    if (hasText && text.trim().length > 2000) return NextResponse.json({ error: 'Message too long (max 2000 chars)' }, { status: 400 })

    // Image must be a path produced by our /api/upload (same regex enforced
    // for event/listing photos) — prevents injecting external trackers.
    const photoRegex = /^\/app\/api\/files\/[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/
    const safeImageUrl = hasImage && photoRegex.test(imageUrl) ? imageUrl : null
    if (hasImage && !safeImageUrl) return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 })

    // Verify the replyToId (if present) belongs to this conversation — prevents
    // quoting random messages from other threads.
    let safeReplyToId: string | null = null
    if (typeof replyToId === 'string' && replyToId.length > 0) {
      const parent = await prisma.directMessage.findUnique({
        where:  { id: replyToId },
        select: { fromId: true, toId: true },
      })
      const inThread = parent && (
        (parent.fromId === session.id && parent.toId === toId) ||
        (parent.fromId === toId       && parent.toId === session.id)
      )
      if (!inThread) return NextResponse.json({ error: 'Invalid reply target' }, { status: 400 })
      safeReplyToId = replyToId
    }

    const isModeration = isAdminOrModerator(session)
    const privileged = isModeration || await isClubHost(session.id)
    if (!privileged) {
      const connection = await prisma.memberConnection.findFirst({
        where: {
          status: 'accepted',
          OR: [
            { requesterId: session.id, receiverId: toId },
            { requesterId: toId, receiverId: session.id },
          ],
        },
      })
      if (!connection) return NextResponse.json({ error: 'You can only message connected members' }, { status: 403 })
    }

    // Personal blocks override connection/club-host privileges. Only admins/moderators
    // bypass — they need to contact any user for moderation.
    if (!isModeration) {
      const block = await prisma.memberBlock.findFirst({
        where: {
          OR: [
            { blockerId: session.id, blockedId: toId },
            { blockerId: toId, blockedId: session.id },
          ],
        },
        select: { id: true },
      })
      if (block) return NextResponse.json({ error: 'You cannot message this user' }, { status: 403 })
    }

    const recipient = await prisma.user.findUnique({ where: { id: toId }, select: { id: true, name: true } })
    if (!recipient) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const message = await prisma.directMessage.create({
      data: {
        fromId:    session.id,
        toId,
        text:      hasText ? text.trim() : '',
        imageUrl:  safeImageUrl,
        replyToId: safeReplyToId,
      },
      include: {
        from:      { select: { id: true, name: true, color: true, profilePhoto: true } },
        reactions: { select: { userId: true, emoji: true } },
        replyTo:   { select: { id: true, text: true, imageUrl: true, from: { select: { id: true, name: true } } } },
      },
    })

    // Notify recipient — only if no recent unread notification from this sender
    const recentNotif = await prisma.notification.findFirst({
      where: { userId: toId, type: 'message', link: `/messages/${session.id}`, isRead: false },
    })
    if (!recentNotif) {
      const preview = hasText ? text.trim().slice(0, 80) : '📷 Photo'
      createNotification(toId, 'message', `${session.name} sent you a message 💬`, preview, `/messages/${session.id}`)
        .catch(() => {})
    }

    return NextResponse.json(message)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    const { userId: otherId } = await params
    const { messageId } = await req.json()

    const msg = await prisma.directMessage.findUnique({ where: { id: messageId } })
    if (!msg) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (msg.fromId !== session.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await prisma.directMessage.delete({ where: { id: messageId } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
