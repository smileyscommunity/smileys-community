import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json(null)

  const poll = await prisma.communityPoll.findFirst({
    where:   { active: true },
    orderBy: { createdAt: 'desc' },
    include: {
      options: {
        orderBy: { order: 'asc' },
        include: { _count: { select: { votes: true } } },
      },
    },
  })
  if (!poll) return NextResponse.json(null)

  const userVote = await prisma.communityPollVote.findUnique({
    where: { userId_pollId: { userId: session.id, pollId: poll.id } },
    select: { optionId: true },
  })

  const totalVotes = poll.options.reduce((sum, o) => sum + o._count.votes, 0)

  return NextResponse.json({
    id:         poll.id,
    question:   poll.question,
    totalVotes,
    votedOptionId: userVote?.optionId ?? null,
    options: poll.options.map(o => ({
      id:      o.id,
      text:    o.text,
      votes:   o._count.votes,
      percent: totalVotes > 0 ? Math.round((o._count.votes / totalVotes) * 100) : 0,
    })),
  })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  if (!await rateLimit(`poll-vote:${session.id}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { pollId, optionId } = await req.json()
  if (!pollId || !optionId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  // Verify option belongs to poll
  const option = await prisma.communityPollOption.findUnique({
    where: { id: optionId },
    select: { pollId: true },
  })
  if (!option || option.pollId !== pollId) {
    return NextResponse.json({ error: 'Invalid option' }, { status: 400 })
  }

  // Only the active poll accepts votes. GET only ever returns the active poll,
  // but a replayed/guessed pollId could otherwise mutate a closed poll's tally.
  const poll = await prisma.communityPoll.findUnique({
    where: { id: pollId },
    select: { active: true },
  })
  if (!poll || !poll.active) {
    return NextResponse.json({ error: 'This poll is closed' }, { status: 400 })
  }

  await prisma.communityPollVote.upsert({
    where:  { userId_pollId: { userId: session.id, pollId } },
    create: { userId: session.id, pollId, optionId },
    update: { optionId },
  })

  return NextResponse.json({ ok: true })
}
