import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { trackServer } from '@/lib/posthog-server'

// PATCH /api/connections/[id] — accept or decline
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { action } = await req.json() // 'accept' | 'decline'

  const connection = await prisma.memberConnection.findUnique({ where: { id } })
  if (!connection || connection.receiverId !== session.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (connection.status !== 'pending') {
    return NextResponse.json({ error: 'Already handled' }, { status: 400 })
  }

  // Blocking now severs pending rows, but belt-and-braces for requests that
  // predate that change (or race it): a blocked pair must not be able to
  // become connected. Same 404 as a missing row so nothing is probed.
  const blocked = await prisma.memberBlock.findFirst({
    where: { OR: [
      { blockerId: session.id,              blockedId: connection.requesterId },
      { blockerId: connection.requesterId,  blockedId: session.id },
    ] },
    select: { id: true },
  })
  if (blocked) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (action === 'accept') {
    const updated = await prisma.memberConnection.update({
      where: { id },
      data:  { status: 'accepted' },
    })
    await createNotification(
      connection.requesterId,
      'connection_accepted',
      `${session.name} accepted your request`,
      `You're now connected with ${session.name}.`,
      '/members',
    )
    trackServer(session, 'connection_accepted', {
      requester_id: connection.requesterId,
      connection_id: id,
    })
    return NextResponse.json({ connection: updated })
  }

  // Only an explicit 'decline' deletes the request. Previously ANY non-accept
  // action (a typo like 'accepted', an omitted field, a garbled retry) fell
  // through here and permanently destroyed the pending request with a 200.
  if (action !== 'decline') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  // decline — keep the row as decline-memory. It disappears from both
  // sides' lists (the API filters declined out), but its existence blocks
  // the requester from ever re-notifying this person: POST's pairKey
  // fast-path silently no-ops for them. Deleting it (the old behavior)
  // let a declined requester immediately ask again.
  await prisma.memberConnection.update({
    where: { id },
    data:  { status: 'declined' },
  })
  trackServer(session, 'connection_declined', {
    requester_id: connection.requesterId,
    connection_id: id,
  })
  return NextResponse.json({ ok: true })
}

// DELETE /api/connections/[id] — remove connection or withdraw request
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const connection = await prisma.memberConnection.findUnique({ where: { id } })
  if (!connection) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (connection.requesterId !== session.id && connection.receiverId !== session.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Declined rows are decline-memory — deleting one would let the declined
  // requester send (and notify) again. They're invisible to both parties,
  // so a legitimate client never targets them; respond as if unknown.
  if (connection.status === 'declined') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // The RECEIVER removing a pending request is a decline, and declines are
  // permanent — hard-deleting here erased the decline-memory the PATCH
  // carefully keeps, letting the requester re-request and re-notify.
  // Withdraw (requester deletes own pending) and unfriend (either party
  // deletes an accepted connection) still hard-delete.
  if (connection.status === 'pending' && connection.receiverId === session.id) {
    await prisma.memberConnection.update({ where: { id }, data: { status: 'declined' } })
  } else {
    await prisma.memberConnection.delete({ where: { id } })
  }
  // One event covers withdraw (requester deletes own pending request),
  // decline-via-DELETE (receiver deletes pending request), and unfriend
  // (either party deletes an accepted connection). Properties differentiate.
  trackServer(session, 'connection_removed', {
    connection_id: id,
    was_pending:   connection.status === 'pending',
    by_requester:  connection.requesterId === session.id,
  })
  return NextResponse.json({ ok: true })
}
