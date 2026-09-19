import { NextRequest, NextResponse } from 'next/server'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { isAdminOrModerator, isClubHost } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'
import { authorProjector } from '@/lib/authorProjection'
import { firstNameOf } from '@/lib/data'
import { MESSAGE_FOLDERS } from '@/lib/uploadedImageUrl'

type Params = { params: Promise<{ userId: string }> }

type QuoteRow = { id: string; text: string; imageUrl: string | null; deletedAt: Date | null; from: { id: string; name: string } }

// Deleted messages are filtered out of the thread, but a reply's quote chip
// embeds its parent — which carried the deleted text and photo straight back
// to both parties. Keep the chip (so the reply still reads as a reply) and
// withhold the content behind a deleted flag.
function redactDeletedQuote(q: QuoteRow | null) {
  if (!q) return null
  const { deletedAt, ...rest } = q
  return deletedAt ? { ...rest, text: null, imageUrl: null, deleted: true } : rest
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    const { userId: otherId } = await params
    const { searchParams } = new URL(req.url)
    // A garbage `since` used to become Invalid Date → Prisma throw → 500;
    // an unparseable cursor now just falls back to the full initial load.
    const sinceRaw = searchParams.get('since')
    const since = sinceRaw && !isNaN(new Date(sinceRaw).getTime()) ? sinceRaw : null

    // A block closes the thread to the person who was blocked. The BLOCKER
    // keeps reading their own history: blocking a harasser used to lock the
    // blocker out of the very messages they need to report, and the inbox
    // then showed the thread as "No messages yet. Say hi!".
    let readOnly = false
    if (!isAdminOrModerator(session)) {
      const blocks = await prisma.memberBlock.findMany({
        where: { OR: [
          { blockerId: session.id, blockedId: otherId },
          { blockerId: otherId, blockedId: session.id },
        ] },
        select: { blockerId: true },
      })
      if (blocks.some(b => b.blockerId === otherId)) {
        return NextResponse.json({ error: 'You cannot view this conversation', reason: 'blocked' }, { status: 403 })
      }
      readOnly = blocks.length > 0
    }

    // Older history, for "load older messages" — the thread was capped at the
    // newest 100 with no way back.
    const beforeRaw = searchParams.get('before')
    const before = beforeRaw && !isNaN(new Date(beforeRaw).getTime()) ? beforeRaw : null

    const messages = await prisma.directMessage.findMany({
      where: {
        OR: [
          { fromId: session.id, toId: otherId },
          { fromId: otherId,    toId: session.id },
        ],
        deletedAt: null,
        ...(since ? { createdAt: { gt: new Date(since) } } : {}),
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      // Initial load: fetch last 100 in desc order and reverse — gives the
      // most-recent 100 in chronological order without a two-query skip/take.
      // Poll path (since provided): asc, no limit — incremental and small.
      orderBy: { createdAt: since && !before ? 'asc' : 'desc' },
      // The poll's delta is capped too: `?since=` far enough back used to
      // return the entire thread in one response.
      take: 100,
      include: {
        from: { select: { id: true, name: true, color: true, profilePhoto: true, profileVisibility: true } },
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
            deletedAt: true,
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
    // …and the bell entry that announced them. The send path skips notifying
    // while an unread "message" notification from this sender exists, and
    // nothing here cleared it — so after the first message, every later one
    // arrived with no bell and no push until the member happened to open
    // /notifications. Reading the thread IS reading the notice.
    await prisma.notification.updateMany({
      where: { userId: session.id, type: 'message', link: `/messages/${otherId}`, isRead: false },
      data:  { isRead: true },
    })

    // Initial load was fetched desc — reverse to chronological order for the client.
    const ordered = since && !before ? messages : [...messages].reverse()
    // A connections-only member the viewer isn't connected to shows as their
    // profile does — first name, no photo. This route sent both in full, and
    // a DM thread can exist with no connection at all (they answered your
    // board listing, or the connection was removed afterwards).
    const show = await authorProjector(session, ordered.map(m => m.from))
    return NextResponse.json({
      messages: ordered.map(m => ({ ...m, from: show(m.from), replyTo: redactDeletedQuote(m.replyTo) })),
      readOnly,
      // A full page of older history means there may be more behind it.
      hasMore: !since && messages.length === 100,
    })
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
    // Layered rate limits:
    //   - 60/min total across all DMs catches burst spam (was the only check)
    //   - 20/hour to ANY single recipient catches a stalker hammering one
    //     person while staying under the 60/min ceiling
    //   - 200/day total stops sustained harassment campaigns across multiple
    //     targets that would otherwise stay under both per-minute limits
    // Spent below, once the request is known to be a real send: a member
    // repeatedly trying to write to someone who isn't connected used to eat
    // the hourly and daily budgets without a single message going out.
    const { text, imageUrl, replyToId } = await req.json().catch(() => ({}))
    const hasText  = typeof text === 'string' && text.trim().length > 0
    const hasImage = typeof imageUrl === 'string' && imageUrl.length > 0
    if (!hasText && !hasImage) return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 })
    if (hasText && text.trim().length > 2000) return NextResponse.json({ error: 'Message too long (max 2000 chars)' }, { status: 400 })

    // Image must be a path produced by our /api/upload (same regex enforced
    // for event/listing photos) — prevents injecting external trackers.
    // messages/ only: a DM photo lives in its own folder, served to the two
    // people in the conversation and nobody else (app/api/files). Accepting
    // the public folders here would let a member attach — and thereby
    // re-serve — an image from anywhere else in the pipeline.
    const safeImageUrl = hasImage && isUploadedImageUrl(imageUrl, MESSAGE_FOLDERS) ? imageUrl : null
    if (hasImage && !safeImageUrl) return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 })

    // Verify the replyToId (if present) belongs to this conversation — prevents
    // quoting random messages from other threads.
    let safeReplyToId: string | null = null
    if (typeof replyToId === 'string' && replyToId.length > 0) {
      const parent = await prisma.directMessage.findUnique({
        where:  { id: replyToId },
        select: { fromId: true, toId: true, deletedAt: true },
      })
      const inThread = parent && (
        (parent.fromId === session.id && parent.toId === toId) ||
        (parent.fromId === toId       && parent.toId === session.id)
      )
      if (!inThread) return NextResponse.json({ error: 'Invalid reply target' }, { status: 400 })
      // A deleted message can't be quoted — the new reply would carry the
      // deleted text back into the thread through its quote.
      if (parent.deletedAt) return NextResponse.json({ error: 'That message was deleted' }, { status: 400 })
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
      // No connection: still allow REPLYING to a thread the other party
      // started (admins/mods/club hosts can message anyone — without this,
      // their recipients can't answer and the thread is a one-way megaphone).
      // Replies only: an inbound message must already exist, so this never
      // lets an unconnected member initiate.
      const inboundThread = connection ? null : await prisma.directMessage.findFirst({
        where:  { fromId: toId, toId: session.id },
        select: { id: true },
      })
      if (!connection && !inboundThread) {
        return NextResponse.json({ error: 'You can only message connected members', reason: 'not_connected' }, { status: 403 })
      }
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
      if (block) return NextResponse.json({ error: 'You cannot message this person', reason: 'blocked' }, { status: 403 })
    }

    // A live account. Writing into a banned or deleted row wrote a message
    // nobody would ever read.
    const recipient = await prisma.user.findUnique({
      where: { id: toId }, select: { id: true, name: true, status: true, suspendedUntil: true },
    })
    if (!recipient || recipient.status !== 'approved') {
      return NextResponse.json({ error: 'That member is no longer here' }, { status: 404 })
    }

    // Only now, when the message is really going to be sent.
    if (!await rateLimit(`dm:${session.id}`,          60,  60_000))    return NextResponse.json({ error: 'Sending too fast — slow down' }, { status: 429 })
    if (!await rateLimit(`dm-to:${session.id}:${toId}`, 20, 60 * 60_000)) return NextResponse.json({ error: 'You\'ve messaged this person too many times in the last hour' }, { status: 429 })
    if (!await rateLimit(`dm-day:${session.id}`,      200, 24 * 60 * 60_000)) return NextResponse.json({ error: 'Daily message cap reached' }, { status: 429 })

    const message = await prisma.directMessage.create({
      data: {
        fromId:    session.id,
        toId,
        text:      hasText ? text.trim() : '',
        imageUrl:  safeImageUrl,
        replyToId: safeReplyToId,
      },
      include: {
        from:      { select: { id: true, name: true, color: true, profilePhoto: true, profileVisibility: true } },
        reactions: { select: { userId: true, emoji: true } },
        replyTo:   { select: { id: true, text: true, imageUrl: true, deletedAt: true, from: { select: { id: true, name: true } } } },
      },
    })
    // Same quote shape as GET (the parent could be deleted between the check
    // above and this create).
    const { profileVisibility, ...fromShown } = message.from
    const shaped = { ...message, from: fromShown, replyTo: redactDeletedQuote(message.replyTo) }

    // One bell entry per burst, not per message: skipped while an unread one
    // from this sender is still sitting there. Reading the thread now marks
    // that entry read (GET above), so the next message notifies again — it
    // used to stay unread for ever, which silenced every message after the
    // first. The four-hour bound is the backstop for a recipient who never
    // opens it at all.
    const recentNotif = await prisma.notification.findFirst({
      where: {
        userId: toId, type: 'message', link: `/messages/${session.id}`, isRead: false,
        createdAt: { gte: new Date(Date.now() - 4 * 60 * 60_000) },
      },
      select: { id: true },
    })
    if (!recentNotif) {
      const preview = hasText ? text.trim().slice(0, 80) : '📷 Photo'
      // The sender is named the way the recipient would see them on their
      // profile: a connections-only member who isn't connected is a first
      // name (the listing-contact route already got this right).
      const senderRestricted = profileVisibility === 'connections' && !privileged
        && !await prisma.memberConnection.findFirst({
          where: { status: 'accepted', OR: [
            { requesterId: session.id, receiverId: toId },
            { requesterId: toId, receiverId: session.id },
          ] },
          select: { id: true },
        })
      const senderName = senderRestricted ? firstNameOf(session.name) : session.name
      createNotification(toId, 'message', `${senderName} sent you a message 💬`, preview, `/messages/${session.id}`)
        .catch(() => {})
    }

    return NextResponse.json(shaped)
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
    const { messageId } = await req.json().catch(() => ({}))
    // The one body field that reached Prisma unchecked: a non-string threw
    // inside the query and surfaced as a 500.
    if (typeof messageId !== 'string' || !messageId) {
      return NextResponse.json({ error: 'messageId required' }, { status: 400 })
    }

    const msg = await prisma.directMessage.findUnique({ where: { id: messageId } })
    if (!msg) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (msg.fromId !== session.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // Soft-delete — the row stays as the record behind an abuse report, and
    // GET filters `deletedAt: null` so it leaves both parties' views. (Staff
    // read it from the database if a report needs it; no route serves it,
    // deliberately — a moderator's bypass here would be a way to read any
    // member's messages.)
    await prisma.directMessage.update({ where: { id: messageId }, data: { deletedAt: new Date() } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
