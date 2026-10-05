import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canActInCity } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'
import { getExperienceAnyCity } from '@/lib/guideContent'
import { listGuideTips } from '@/lib/guideTips'

type Params = { params: Promise<{ slug: string }> }

// "Tips from Smileys" under Guide experiences. Public read (the pages are
// public), member-only writes. Authors follow lib/authorProjection: a first
// name for guests. This used to justify full names and photos as matching
// the board and listing cards, which never showed guests either.
export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  // Resolve the slug's OWNING city the same way the detail page does
  // (default city wins a collision) and scope tips to it — a bare-slug
  // query would show one city's tips on another city's page the first
  // time two cities reuse a slug.
  const owner = await getExperienceAnyCity(slug)
  if (!owner) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const session = await getSession()
  // The page renders this same list into its first response (lib/guideTips).
  return NextResponse.json({ tips: await listGuideTips(slug, owner.cityId, session), isMember: !!session })
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`guide-tip:${session.id}`, 5, 86_400_000)) {
    return NextResponse.json({ error: 'Tip limit reached for today' }, { status: 429 })
  }

  const { slug } = await params
  const owner = await getExperienceAnyCity(slug)
  if (!owner) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const raw = await req.json().catch(() => ({}))
  // Plain text, short, and link-free — tips are advice, not ads.
  const body = typeof raw.body === 'string'
    ? raw.body.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '').replace(/\s+/g, ' ').trim().slice(0, 220)
    : ''
  if (body.length < 10) return NextResponse.json({ error: 'Give the tip a little more detail' }, { status: 400 })

  const created = await prisma.guideTip.create({
    data:   { userId: session.id, slug, cityId: owner.cityId, body },
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

  const tip = await prisma.guideTip.findUnique({ where: { id: tipId }, select: { userId: true, slug: true, cityId: true } })
  if (!tip || tip.slug !== slug) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (tip.userId !== session.id && !canActInCity(session, tip.cityId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.guideTip.delete({ where: { id: tipId } })
  return NextResponse.json({ ok: true })
}
