import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canModerateMessages } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canModerateMessages(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const msg = await prisma.eventMessage.findUnique({
      where: { id },
      select: { id: true, userId: true, eventId: true, message: true },
    })
    if (!msg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.eventMessage.delete({ where: { id } })
    writeAudit(session.id, session.name, 'message.delete', id, 'eventMessage',
      { eventId: msg.eventId, userId: msg.userId, preview: msg.message.slice(0, 80) },
      `Message deleted: "${msg.message.slice(0, 60)}${msg.message.length > 60 ? '…' : ''}"`,
    )

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
