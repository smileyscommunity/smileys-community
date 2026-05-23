import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator } from '@/lib/access'

export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const polls = await prisma.communityPoll.findMany({
    orderBy: { createdAt: 'desc' },
    take:    5,
    include: {
      options: { orderBy: { order: 'asc' }, include: { _count: { select: { votes: true } } } },
    },
  })
  return NextResponse.json(polls)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { question, options } = await req.json()
  if (!question?.trim() || !Array.isArray(options) || options.filter((o: string) => o?.trim()).length < 2) {
    return NextResponse.json({ error: 'Question and at least 2 options required' }, { status: 400 })
  }
  if (question.trim().length > 300) {
    return NextResponse.json({ error: 'Question too long (max 300 chars)' }, { status: 400 })
  }
  if (options.length > 10) {
    return NextResponse.json({ error: 'Maximum 10 options allowed' }, { status: 400 })
  }
  const longOption = options.find((o: string) => o?.trim().length > 200)
  if (longOption) {
    return NextResponse.json({ error: 'Each option must be under 200 characters' }, { status: 400 })
  }

  // Deactivate existing active polls
  await prisma.communityPoll.updateMany({ where: { active: true }, data: { active: false } })

  const poll = await prisma.communityPoll.create({
    data: {
      question: question.trim(),
      active:   true,
      options: {
        create: options
          .filter((o: string) => o?.trim())
          .map((text: string, order: number) => ({ text: text.trim(), order })),
      },
    },
    include: { options: { orderBy: { order: 'asc' } } },
  })

  return NextResponse.json(poll)
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { pollId } = await req.json()
  if (!pollId) return NextResponse.json({ error: 'pollId required' }, { status: 400 })
  await prisma.communityPoll.delete({ where: { id: pollId } })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { pollId, active } = await req.json()
  if (!pollId) return NextResponse.json({ error: 'pollId required' }, { status: 400 })

  if (active) await prisma.communityPoll.updateMany({ where: { active: true }, data: { active: false } })

  const poll = await prisma.communityPoll.update({
    where: { id: pollId },
    data:  { active: !!active },
  })
  return NextResponse.json(poll)
}
