import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { isBlockedEitherWay } from '@/lib/memberPrivacy'
import { isAdminOrModerator } from '@/lib/access'

// Toggle/swap reactions on a direct message. One reaction per user per message
// (DB-enforced). POST { messageId, emoji } — same emoji removes; different
// emoji swaps. Returns the new reactions array for the message so the client
// can render without a refetch.

// Small, opinionated set — WhatsApp uses 6 quick-reaction emojis by default.
const ALLOWED_EMOJI = ['❤️', '😂', '😮', '😢', '👍', '🙏']

export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    const { userId: otherId } = await params
    const { messageId, emoji } = await req.json().catch(() => ({}))

    // A block closes this door too. Reading and sending were both blocked, but
    // reacting wasn't — so someone you blocked, with the thread still open in a
    // tab, could keep putting emoji on your messages.
    if (!isAdminOrModerator(session) && await isBlockedEitherWay(session.id, otherId)) {
      return NextResponse.json({ error: 'You cannot react in this conversation', reason: 'blocked' }, { status: 403 })
    }
    // A toggle is two or three writes; without a budget it was free to run in
    // a loop. Generous enough that nobody tapping emoji ever meets it.
    if (!await rateLimit(`dm-react:${session.id}`, 60, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    if (typeof messageId !== 'string') return NextResponse.json({ error: 'messageId required' }, { status: 400 })
    if (typeof emoji !== 'string' || !ALLOWED_EMOJI.includes(emoji)) {
      return NextResponse.json({ error: 'Invalid emoji' }, { status: 400 })
    }

    // Verify the message is part of this conversation — prevents reacting to
    // anyone's DMs by guessing IDs.
    const message = await prisma.directMessage.findUnique({
      where:  { id: messageId },
      select: { fromId: true, toId: true, deletedAt: true },
    })
    // A deleted message isn't in either thread any more; reacting to it put a
    // reaction on something neither side can see.
    if (!message || message.deletedAt) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const inThread =
      (message.fromId === session.id && message.toId === otherId) ||
      (message.fromId === otherId   && message.toId === session.id)
    if (!inThread) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const existing = await prisma.directMessageReaction.findUnique({
      where: { messageId_userId: { messageId, userId: session.id } },
    })

    if (existing && existing.emoji === emoji) {
      // Same emoji → remove (toggle off).
      await prisma.directMessageReaction.delete({ where: { id: existing.id } })
    } else if (existing) {
      // Different emoji → swap.
      await prisma.directMessageReaction.update({
        where: { id: existing.id },
        data:  { emoji },
      })
    } else {
      await prisma.directMessageReaction.create({
        data: { messageId, userId: session.id, emoji },
      })
    }

    const reactions = await prisma.directMessageReaction.findMany({
      where:  { messageId },
      select: { userId: true, emoji: true },
    })
    return NextResponse.json({ reactions })
  } catch (e) {
    console.error('[dm react]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
