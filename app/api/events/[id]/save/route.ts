import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ id: string }> }

// Save / unsave an event (Events brief §35) — a bookmark, deliberately
// distinct from an RSVP: saving says "I might go", RSVP says "I'm going",
// and conflating them would corrupt attendance numbers. Toggle semantics
// so the button is idempotent from the client's perspective.
export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`event-save:${session.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Slow down a little' }, { status: 429 })
  }

  const { id } = await params
  const event = await prisma.event.findUnique({ where: { id }, select: { id: true, status: true } })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  // Only a published event can be saved; one that was cancelled since can
  // still be UN-saved, or the bookmark was stuck on it for good.
  if (event.status !== 'published') {
    const { count } = await prisma.eventSave.deleteMany({ where: { userId: session.id, eventId: id } })
    if (count === 0) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    return NextResponse.json({ saved: false })
  }

  const existing = await prisma.eventSave.findUnique({
    where: { userId_eventId: { userId: session.id, eventId: id } },
    select: { id: true },
  })

  if (existing) {
    await prisma.eventSave.delete({ where: { id: existing.id } })
    return NextResponse.json({ saved: false })
  }

  await prisma.eventSave.create({ data: { userId: session.id, eventId: id } })
  return NextResponse.json({ saved: true })
}
