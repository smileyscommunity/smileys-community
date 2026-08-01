import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { rateLimit } from '@/lib/rateLimit'

// POST /api/visiting/tip — a one-way local recommendation for someone with
// an active visit. Deliberately NOT a message: it lands as a notification
// and opens no thread, so it can't be escalated into a conversation the
// visitor never agreed to.
//
// This is the only path on the site that puts SENDER-WRITTEN text in front
// of a member with no connection and no consent step (the wave bypasses the
// same guard, but its text is a fixed template nobody can edit). Everything
// below exists because of that:
//
//   - one tip per sender per recipient per 30 days — a tip is a single
//     helpful thought, and capping it at one removes repeat-pinging as a
//     harassment vector entirely
//   - 10/day overall, so nobody can paper the whole visitor list
//   - only to someone with a currently active visit, so the channel closes
//     when their trip ends
//   - blocks honoured in both directions
//   - URLs stripped: an unconsented channel must not be able to deliver a
//     phishing or spam link
//   - the sender is named in the notification and it links to their profile;
//     nothing here is anonymous
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { targetUserId, text } = await req.json()
  if (!targetUserId || targetUserId === session.id) {
    return NextResponse.json({ error: 'Invalid target' }, { status: 400 })
  }

  // Strip links before length checks so a stripped-to-empty payload is
  // rejected rather than delivered as a blank tip.
  const cleaned = typeof text === 'string'
    ? text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '').replace(/\s+/g, ' ').trim()
    : ''
  if (!cleaned)             return NextResponse.json({ error: 'Write a short tip first' }, { status: 400 })
  if (cleaned.length > 200) return NextResponse.json({ error: 'Tip too long (max 200 characters)' }, { status: 400 })

  const target = await prisma.user.findUnique({
    where:  { id: targetUserId },
    select: { id: true, name: true, status: true },
  })
  if (!target || target.status !== 'approved') {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const today = new Date().toISOString().slice(0, 10)
  const announcement = await prisma.visitorAnnouncement.findFirst({
    where:  { userId: targetUserId, status: 'active', endsOn: { gte: today } },
    select: { id: true },
  })
  if (!announcement) {
    return NextResponse.json({ error: 'No active visitor post found' }, { status: 400 })
  }

  const block = await prisma.memberBlock.findFirst({
    where: {
      OR: [
        { blockerId: session.id,  blockedId: targetUserId },
        { blockerId: targetUserId, blockedId: session.id  },
      ],
    },
    select: { id: true },
  })
  if (block) return NextResponse.json({ error: 'Cannot send a tip to this user' }, { status: 403 })

  // Rate limits run last: they consume a slot on success, so a request that
  // was going to fail validation must never burn the once-per-person quota.
  if (!await rateLimit(`tip:${session.id}`, 10, 24 * 60 * 60_000)) {
    return NextResponse.json({ error: 'Tip limit reached for today (10/day)' }, { status: 429 })
  }
  if (!await rateLimit(`tip-to:${session.id}:${targetUserId}`, 1, 30 * 24 * 60 * 60_000)) {
    return NextResponse.json({ error: 'You already sent this visitor a tip' }, { status: 429 })
  }

  await createNotification(
    targetUserId,
    'visitor_tip',
    `💡 ${session.name} shared a local tip`,
    cleaned,
    `/members/${session.id}`,
  ).catch(() => {})

  return NextResponse.json({ ok: true })
}
