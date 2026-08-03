import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { rateLimit } from '@/lib/rateLimit'

// Same invitation-scoped DM pattern as listing contact: an active moving
// sale is an explicit "come take my stuff" — once per sale per sender,
// shared daily budget with listing contacts, blocks, URL-stripping.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const today = new Date().toISOString().slice(0, 10)
  const sale = await prisma.movingSale.findUnique({
    where:  { id },
    select: { id: true, userId: true, leavingOn: true, status: true, user: { select: { name: true, status: true } } },
  })
  if (!sale || sale.user.status !== 'approved') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (sale.status !== 'active' || sale.leavingOn < today) {
    return NextResponse.json({ error: 'This moving sale has ended' }, { status: 400 })
  }
  if (sale.userId === session.id) return NextResponse.json({ error: 'This is your own sale' }, { status: 400 })

  const raw = await req.json()
  const text = typeof raw.text === 'string'
    ? raw.text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '').replace(/\s+/g, ' ').trim().slice(0, 300)
    : ''
  if (!text) return NextResponse.json({ error: 'Write a short message first' }, { status: 400 })

  const block = await prisma.memberBlock.findFirst({
    where: { OR: [
      { blockerId: session.id, blockedId: sale.userId },
      { blockerId: sale.userId, blockedId: session.id },
    ] },
    select: { id: true },
  })
  if (block) return NextResponse.json({ error: 'Cannot contact this member' }, { status: 403 })

  if (!await rateLimit(`listing-contact:${session.id}`, 10, 24 * 60 * 60_000)) {
    return NextResponse.json({ error: 'Daily contact limit reached' }, { status: 429 })
  }
  if (!await rateLimit(`moving-contact-once:${session.id}:${id}`, 1, 30 * 24 * 60 * 60_000)) {
    return NextResponse.json({ error: 'You already contacted this seller — check your messages' }, { status: 429 })
  }

  await prisma.directMessage.create({
    data: { fromId: session.id, toId: sale.userId, text: `📦 Re: your moving sale — ${text}` },
  })
  createNotification(
    sale.userId, 'message',
    `📦 ${session.name.split(' ')[0]} is interested in your moving sale`,
    text.slice(0, 100),
    `/messages/${session.id}`,
  ).catch(() => {})
  return NextResponse.json({ ok: true })
}
