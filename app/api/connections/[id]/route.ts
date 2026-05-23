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

  // decline — delete the record
  await prisma.memberConnection.delete({ where: { id } })
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

  await prisma.memberConnection.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
