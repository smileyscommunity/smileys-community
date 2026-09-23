import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

// A page of poll history, newest first. The list used to stop at the last
// five, so older results were unreachable from the panel. `?after=<pollId>`
// continues from that poll; the page asks again while a full page comes back.
// The body stays a bare array, which is what every consumer already reads.
// Mirrored in app/admin/polls/page.tsx (a route file can't export it).
const POLL_PAGE_SIZE = 10

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const after = req.nextUrl.searchParams.get('after')?.trim() || null
  const polls = await prisma.communityPoll.findMany({
    // id breaks createdAt ties, so a cursor never skips or repeats a poll.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take:    POLL_PAGE_SIZE,
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    include: {
      options: { orderBy: { order: 'asc' }, include: { _count: { select: { votes: true } } } },
    },
  })
  return NextResponse.json(polls)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  // Admin-only: there's one live poll network-wide, and publishing one ends
  // whatever every other city was voting on.
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { question, options, cityId: rawCityId } = await req.json()
  // Which city the question is for. A poll with no city is asked of everyone
  // — deliberate, and the only way to ask one question community-wide — so an
  // explicit null is honoured and anything else has to be a real public city.
  let pollCityId: string | null = null
  if (rawCityId != null) {
    if (typeof rawCityId !== 'string') {
      return NextResponse.json({ error: 'cityId must be a string or null' }, { status: 400 })
    }
    const city = await prisma.city.findUnique({ where: { id: rawCityId }, select: { id: true } })
    if (!city) return NextResponse.json({ error: 'Unknown city' }, { status: 400 })
    pollCityId = city.id
  }
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
    // Retire only the poll this one replaces: the city's own, or — for a
    // global question — the global one. Unscoped, publishing an Istanbul poll
    // silently closed Tbilisi's.
    await tx.communityPoll.updateMany({ where: { active: true, cityId: pollCityId }, data: { active: false } })
    return tx.communityPoll.create({
      data: {
        question: cleanedQuestion,
        active:   true,
        cityId:   pollCityId,
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
  // Admin-only, like POST: ending or reactivating the poll changes it for
  // every city at once.
  if (!session || !isAdmin(session)) {
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
