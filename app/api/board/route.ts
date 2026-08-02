import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { ISTANBUL_NEIGHBORHOODS } from '@/lib/data'
import { BOARD_POST_TYPES, PLAN_TAGS, QUESTION_TAGS, PLAN_WHEN } from '@/lib/board'

// Istanbul Board conversation feed. Publicly readable (the Board is a
// public growth surface like /visiting and /neighborhoods) — but posts
// carry no contact fields, and the member data exposed here (name, photo)
// matches what public listing cards already show. All writes are
// member-only.

const TYPE_VALUES = new Set(BOARD_POST_TYPES.map(t => t.value))
const TAG_VALUES  = new Set([...PLAN_TAGS, ...QUESTION_TAGS].map(t => t.value))

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type         = searchParams.get('type') || undefined
  const neighborhood = searchParams.get('neighborhood') || undefined
  const offset       = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0)

  const session = await getSession()

  const posts = await prisma.boardPost.findMany({
    where: {
      status: 'active',
      // Expired plans drop out of the feed (stale "tonight?" posts read as
      // a dead community) but stay reachable at their own URL.
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      ...(type && TYPE_VALUES.has(type as never) ? { type } : {}),
      ...(neighborhood ? { neighborhood } : {}),
    },
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    skip: offset,
    take: 15,
    select: {
      id: true, type: true, title: true, body: true, neighborhood: true,
      tag: true, whenLabel: true, expiresAt: true, pinned: true, createdAt: true,
      user: { select: { id: true, name: true, color: true, profilePhoto: true } },
      _count: { select: { replies: true, interests: true, saves: true } },
      // The viewer's own reactions, so buttons render in the right state.
      ...(session ? {
        interests: { where: { userId: session.id }, select: { userId: true } },
        saves:     { where: { userId: session.id }, select: { userId: true } },
      } : {}),
    },
  })

  return NextResponse.json({
    posts: posts.map(p => ({
      id: p.id, type: p.type, title: p.title, body: p.body,
      neighborhood: p.neighborhood, tag: p.tag, whenLabel: p.whenLabel,
      pinned: p.pinned, createdAt: p.createdAt,
      user: p.user,
      replyCount:    p._count.replies,
      interestCount: p._count.interests,
      saveCount:     p._count.saves,
      viewerInterested: session ? (p as { interests?: unknown[] }).interests!.length > 0 : false,
      viewerSaved:      session ? (p as { saves?: unknown[] }).saves!.length > 0 : false,
    })),
    isMember: !!session,
  })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 10 posts/day is generous for genuine use and cheap insurance on a brand
  // new free-text surface; the burst limit catches scripted spam.
  if (!await rateLimit(`board:${session.id}`, 3, 60_000))            return NextResponse.json({ error: 'Posting too fast — slow down' }, { status: 429 })
  if (!await rateLimit(`board-day:${session.id}`, 10, 86_400_000))   return NextResponse.json({ error: 'Daily post limit reached' }, { status: 429 })

  const body = await req.json()
  const type = typeof body.type === 'string' && TYPE_VALUES.has(body.type) ? body.type : null
  if (!type) return NextResponse.json({ error: 'Invalid post type' }, { status: 400 })

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : ''
  if (!title) return NextResponse.json({ error: 'Say what your post is about' }, { status: 400 })

  const text = typeof body.body === 'string' ? body.body.trim().slice(0, 1000) : ''

  const neighborhood = typeof body.neighborhood === 'string'
    && (ISTANBUL_NEIGHBORHOODS as readonly string[]).includes(body.neighborhood)
    ? body.neighborhood : null

  const tag = typeof body.tag === 'string' && TAG_VALUES.has(body.tag) ? body.tag : null

  // Plans expire. 'Today'/'Tonight' die at Istanbul midnight, 'Tomorrow' at
  // the following midnight; anything unstated gets 48h so no plan lingers.
  let whenLabel: string | null = null
  let expiresAt: Date | null = null
  if (type === 'plan') {
    whenLabel = typeof body.whenLabel === 'string' && (PLAN_WHEN as readonly string[]).includes(body.whenLabel)
      ? body.whenLabel : null
    const nowIst = new Date(Date.now() + 3 * 3_600_000) // Istanbul is UTC+3, no DST
    const midnight = Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() + 1) - 3 * 3_600_000
    expiresAt = new Date(whenLabel === 'Tomorrow' ? midnight + 86_400_000 : whenLabel ? midnight : Date.now() + 48 * 3_600_000)
  }

  const created = await prisma.boardPost.create({
    data: { userId: session.id, type, title, body: text, neighborhood, tag, whenLabel, expiresAt },
    select: { id: true },
  })

  return NextResponse.json({ id: created.id }, { status: 201 })
}
