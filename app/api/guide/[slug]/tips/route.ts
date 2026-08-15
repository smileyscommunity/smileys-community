import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'
import { getExperience } from '@/lib/guideContent'

type Params = { params: Promise<{ slug: string }> }

// "Tips from Smileys" under Guide experiences. Public read (the pages
// are public; author name/photo exposure matches what public board and
// listing cards already show), member-only writes.
export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  if (!await getExperience(slug)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const session = await getSession()
  const tips = await prisma.guideTip.findMany({
    // §48 (Members brief): deactivated/banned authors drop out of
    // discovery surfaces — their tips hide rather than showing a ghost.
    where:   { slug, user: { status: 'approved' } },
    orderBy: [{ likes: { _count: 'desc' } }, { createdAt: 'desc' }],
    take:    30,
    select: {
      id: true, body: true, createdAt: true,
      user:   { select: { id: true, name: true, color: true, profilePhoto: true } },
      _count: { select: { likes: true } },
      ...(session ? { likes: { where: { userId: session.id }, select: { userId: true } } } : {}),
    },
  })

  return NextResponse.json({
    tips: tips.map(t => ({
      id: t.id, body: t.body, createdAt: t.createdAt, user: t.user,
      likeCount:  t._count.likes,
      viewerLiked: session ? (t as { likes?: unknown[] }).likes!.length > 0 : false,
      mine: session ? t.user.id === session.id : false,
    })),
    isMember: !!session,
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`guide-tip:${session.id}`, 5, 86_400_000)) {
    return NextResponse.json({ error: 'Tip limit reached for today' }, { status: 429 })
  }

  const { slug } = await params
  if (!await getExperience(slug)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const raw = await req.json().catch(() => ({}))
  // Plain text, short, and link-free — tips are advice, not ads.
  const body = typeof raw.body === 'string'
    ? raw.body.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '').replace(/\s+/g, ' ').trim().slice(0, 220)
    : ''
  if (body.length < 10) return NextResponse.json({ error: 'Give the tip a little more detail' }, { status: 400 })

  const created = await prisma.guideTip.create({
    data:   { userId: session.id, slug, body },
    select: {
      id: true, body: true, createdAt: true,
      user: { select: { id: true, name: true, color: true, profilePhoto: true } },
    },
  })
  return NextResponse.json({ tip: { ...created, likeCount: 0, viewerLiked: false, mine: true } }, { status: 201 })
}

// Owner or staff removes a tip (?tip=<id>). Hard delete — tips are
// short community advice, not records worth tombstoning.
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { slug } = await params
  const tipId = req.nextUrl.searchParams.get('tip')
  if (!tipId) return NextResponse.json({ error: 'tip id required' }, { status: 400 })

  const tip = await prisma.guideTip.findUnique({ where: { id: tipId }, select: { userId: true, slug: true } })
  if (!tip || tip.slug !== slug) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (tip.userId !== session.id && !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.guideTip.delete({ where: { id: tipId } })
  return NextResponse.json({ ok: true })
}
