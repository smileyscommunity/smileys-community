import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

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
  const cleanedQuestion = String(question ?? '').trim()
  const cleanedOptions  = Array.isArray(options)
    ? options.map((o: unknown) => String(o ?? '').trim()).filter(Boolean)
    : []

  if (!cleanedQuestion || cleanedOptions.length < 2) {
    return NextResponse.json({ error: 'Question and at least 2 options required' }, { status: 400 })
  }
  if (cleanedQuestion.length > 300) {
    return NextResponse.json({ error: 'Question too long (max 300 chars)' }, { status: 400 })
  }
  if (cleanedOptions.length > 10) {
    return NextResponse.json({ error: 'Maximum 10 options allowed' }, { status: 400 })
  }
  if (cleanedOptions.some(o => o.length > 200)) {
    return NextResponse.json({ error: 'Each option must be under 200 characters' }, { status: 400 })
  }

  // Reject duplicate options — previously the server accepted ["Yes",
  // "Yes", "No"] and split member votes across the duplicates. Compare
  // case-insensitively so "Yes" and "yes" count as the same answer.
  const seen = new Set<string>()
  for (const o of cleanedOptions) {
    const key = o.toLowerCase()
    if (seen.has(key)) {
      return NextResponse.json({ error: 'Options must be unique' }, { status: 400 })
    }
    seen.add(key)
  }

  // Deactivate existing active polls + create the new one in one
  // transaction so a transient throw between the two doesn't leave the
  // community with zero active polls.
  const poll = await prisma.$transaction(async tx => {
    await tx.communityPoll.updateMany({ where: { active: true }, data: { active: false } })
    return tx.communityPoll.create({
      data: {
        question: cleanedQuestion,
        active:   true,
        options: {
          create: cleanedOptions.map((text, order) => ({ text, order })),
        },
      },
      include: { options: { orderBy: { order: 'asc' }, include: { _count: { select: { votes: true } } } } },
    })
  })

  // Audit — creating a poll changes the community-wide content every
  // dashboard surfaces. Previously only DELETE was audited.
  writeAudit(session.id, session.name, 'poll.create', poll.id, 'community_poll',
    { question: poll.question, optionCount: cleanedOptions.length },
    `Created community poll: "${poll.question}"`,
  )

  return NextResponse.json(poll)
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { pollId } = await req.json()
  if (!pollId) return NextResponse.json({ error: 'pollId required' }, { status: 400 })
  const snapshot = await prisma.communityPoll.findUnique({
    where:  { id: pollId },
    select: { question: true, active: true, createdAt: true,
              _count: { select: { options: true } } },
  })
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await prisma.communityPoll.delete({ where: { id: pollId } })
  writeAudit(session.id, session.name, 'poll.delete', pollId, 'community_poll',
    { question: snapshot.question, active: snapshot.active, optionCount: snapshot._count.options,
      createdAt: snapshot.createdAt.toISOString() },
    `Deleted ${snapshot.active ? 'active' : 'inactive'} community poll: "${snapshot.question}"`,
  )
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { pollId, active } = await req.json()
  if (!pollId) return NextResponse.json({ error: 'pollId required' }, { status: 400 })

  // Same transactional shape as POST — if a different poll was active,
  // deactivate it AND mark the target active together so there's never
  // a window with two active polls or zero.
  const poll = await prisma.$transaction(async tx => {
    if (active) {
      await tx.communityPoll.updateMany({
        where: { active: true, id: { not: pollId } },
        data:  { active: false },
      })
    }
    return tx.communityPoll.update({
      where: { id: pollId },
      data:  { active: !!active },
    })
  })

  // Audit — flipping which poll is "live" is a content change worth a
  // trail (e.g. a moderator ending a controversial poll early).
  writeAudit(session.id, session.name, active ? 'poll.activate' : 'poll.end',
    pollId, 'community_poll',
    { question: poll.question, active: !!active },
    `${active ? 'Reactivated' : 'Ended'} community poll: "${poll.question}"`,
  )
  return NextResponse.json(poll)
}
