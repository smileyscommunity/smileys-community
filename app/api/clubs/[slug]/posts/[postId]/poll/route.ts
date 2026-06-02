import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit, getIp } from '@/lib/rateLimit'

type Params = { params: Promise<{ slug: string; postId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  if (!await rateLimit(`poll-vote:${session.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many votes' }, { status: 429 })
  }

  const { slug, postId } = await params
  const { optionId } = await req.json()
  if (!optionId) return NextResponse.json({ error: 'optionId required' }, { status: 400 })

  // IDOR fix: scope the post by the slug's clubId so a non-member of the
  // poll's actual club cannot vote in (or toggle) its options.
  const [club, post] = await Promise.all([
    prisma.club.findUnique({ where: { slug }, select: { id: true } }),
    prisma.clubPost.findUnique({ where: { id: postId }, select: { clubId: true } }),
  ])
  if (!club || !post || post.clubId !== club.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Verify user is a member of this club (or admin)
  if (session.role !== 'admin') {
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { status: true },
    })
    if (membership?.status !== 'approved') {
      return NextResponse.json({ error: 'Join this club to vote' }, { status: 403 })
    }
  }

  const poll = await prisma.clubPoll.findUnique({
    where: { postId },
    select: { id: true, options: { select: { id: true } } },
  })
  if (!poll) return NextResponse.json({ error: 'Poll not found' }, { status: 404 })

  const validOption = poll.options.some(o => o.id === optionId)
  if (!validOption) return NextResponse.json({ error: 'Invalid option' }, { status: 400 })

  const existing = await prisma.clubPollVote.findUnique({
    where: { userId_pollId: { userId: session.id, pollId: poll.id } },
    select: { id: true, optionId: true },
  })

  if (existing) {
    if (existing.optionId === optionId) {
      await prisma.clubPollVote.delete({ where: { id: existing.id } })
    } else {
      await prisma.clubPollVote.update({ where: { id: existing.id }, data: { optionId } })
    }
  } else {
    await prisma.clubPollVote.create({ data: { userId: session.id, pollId: poll.id, optionId } })
  }

  const updated = await prisma.clubPoll.findUnique({
    where: { id: poll.id },
    include: {
      options: { include: { votes: { select: { userId: true } } } },
      votes:   { select: { userId: true, optionId: true } },
    },
  })
  if (!updated) return NextResponse.json({ error: 'Poll not found' }, { status: 404 })

  const myVote = updated.votes.find(v => v.userId === session.id)
  return NextResponse.json({
    myVoteOptionId: myVote?.optionId ?? null,
    totalVotes:     updated.votes.length,
    options: updated.options.map(o => ({
      id:        o.id,
      voteCount: o.votes.length,
      votedByMe: myVote?.optionId === o.id,
    })),
  })
}
