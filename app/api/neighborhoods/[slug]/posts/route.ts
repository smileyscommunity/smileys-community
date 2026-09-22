import { NextRequest, NextResponse } from 'next/server'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'
import { prisma } from '@/lib/prisma'
import { getSession, type SessionUser } from '@/lib/session'
import { resolveCityId, getCityConfig, DEFAULT_CITY_SLUG } from '@/lib/city'
import { getPublicCity } from '@/lib/cities'
import { resolvePostingCityId } from '@/lib/cityMembership'
import { rateLimit } from '@/lib/rateLimit'
import { resolveNeighborhoodBySlug } from '@/lib/neighborhoodsDb'
import { buildReactions, buildAuthor } from '@/lib/posts'
import { LIVE_BOARD_AUTHOR } from '@/lib/boardAccess'
import { blockedIdsFor } from '@/lib/memberPrivacy'
import { wallAuthors } from '@/lib/wallAuthor'
import { notifyMentions } from '@/lib/mentions'

// The slug resolves the same way the page does — and now from the same input.
// The page takes ?city= first (lib/cityPageParam) because four slugs belong to
// two cities each; the wall resolved from the session alone, so an Ankara
// member's Ulus page carried Istanbul's wall underneath it and a post written
// there was filed to Istanbul's Ulus. The client sends the city the page
// resolved to; the session remains the answer when it doesn't.
async function resolveWall(slug: string, session: SessionUser, req: NextRequest) {
  const wanted = req.nextUrl.searchParams.get('city')?.trim()
  const pinned = wanted ? await getPublicCity(wanted) : null
  return resolveNeighborhoodBySlug(slug, pinned?.id ?? await resolveCityId(session))
}

type Params = { params: Promise<{ slug: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const { slug } = await params
  const wall = await resolveWall(slug, session, req)
  if (!wall) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // A read is 30 rows with their replies, likes and authors. Every write on
  // this wall is limited; the read was not, so one member could walk every
  // neighbourhood of every public city at full speed.
  if (!await rateLimit(`nh-wall-read:${session.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const cursor = req.nextUrl.searchParams.get('cursor') ?? undefined
  // Banned, removed and hidden-from-members authors drop off the wall the way
  // they drop off the board — a ban never deleted their posts — and a blocked
  // pair never sees each other's.
  const blocked = await blockedIdsFor(session.id)
  const posts = await prisma.neighborhoodPost.findMany({
    // A name is unique only within its city — Moda exists in more than one.
    where: {
      neighborhood: wall.view.name, cityId: wall.cityId,
      user: LIVE_BOARD_AUTHOR,
      ...(blocked.size ? { userId: { notIn: [...blocked] } } : {}),
    },
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    take: 30,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: {
      user:    { select: { id: true, name: true, color: true, profilePhoto: true, role: true, profileVisibility: true } },
      likes:   { select: { userId: true, emoji: true } },
      replies: {
        orderBy: { createdAt: 'asc' },
        take: 20,
        where:   { user: LIVE_BOARD_AUTHOR, ...(blocked.size ? { userId: { notIn: [...blocked] } } : {}) },
        include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, role: true, profileVisibility: true } } },
      },
      // Counted the same way they're listed, or "Show all 3 replies" opens
      // an empty list for ever: a banned author's replies are filtered out of
      // the array but were still counted here.
      _count: { select: { replies: { where: { user: LIVE_BOARD_AUTHOR, ...(blocked.size ? { userId: { notIn: [...blocked] } } : {}) } } } },
    },
  })

  // One lookup for every author on the page — a connections-only member who
  // is not a connection of this viewer reads as a first name, no photo.
  const show = await wallAuthors(session, posts.flatMap(p => [p.user, ...p.replies.map(r => r.user)]))

  return NextResponse.json(posts.map(p => ({
    id:          p.id,
    content:     p.content,
    imageUrl:    p.imageUrl,
    isPinned:    p.isPinned,
    createdAt:   p.createdAt,
    author:      show(p.user),
    reactions:   buildReactions(p.likes, session.id).reactions,
    replyCount:  p._count.replies,
    replies:     p.replies.map(r => ({
      id: r.id, content: r.content, createdAt: r.createdAt, author: show(r.user),
    })),
  })))
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  if (!await rateLimit(`nh-post:${session.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Slow down — too many posts' }, { status: 429 })
  }

  const { slug } = await params
  const wall = await resolveWall(slug, session, req)
  if (!wall) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // READING another city's wall is deliberate — a slug resolves across public
  // cities so every neighbourhood page is shareable and indexable. WRITING to
  // one is not: the same rule hangouts, pulses and listings follow
  // (resolvePostingCityId) says a write lands in your own city unless you have
  // actually joined the one you are browsing. Without it a single Istanbul
  // account could seed posts on Ankara's, İzmir's and Tbilisi's walls.
  const postingCityId = await resolvePostingCityId(session)
  if (wall.cityId !== postingCityId) {
    return NextResponse.json(
      { error: 'You can post on your own city\'s neighborhood walls — join this city first' },
      { status: 403 },
    )
  }
  const neighborhood = wall.view.name

  const { content, imageUrl } = await req.json().catch(() => ({}))
  // A non-string content used to reach .trim() and 500.
  if (content != null && typeof content !== 'string') {
    return NextResponse.json({ error: 'content must be a string' }, { status: 400 })
  }
  const trimmed = content?.trim() ?? ''
  if (!trimmed && !imageUrl) return NextResponse.json({ error: 'Content required' }, { status: 400 })
  if (trimmed.length > 2000) return NextResponse.json({ error: 'Post too long (max 2000 chars)' }, { status: 400 })
  if (imageUrl && !isUploadedImageUrl(imageUrl, ['posts'])) {
    return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 })
  }

  const post = await prisma.neighborhoodPost.create({
    data: { neighborhood, userId: session.id, cityId: wall.cityId, content: trimmed, imageUrl: imageUrl ?? null },
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, role: true } } },
  })

  // The mention notification has to land on the page the post is actually on:
  // a bare slug is the default city's page for the four shared ones.
  const wallCity = await getCityConfig(wall.cityId)
  const link = `/neighborhoods/${slug}${wallCity.slug === DEFAULT_CITY_SLUG ? '' : `?city=${wallCity.slug}`}`
  notifyMentions({ content: trimmed, authorId: session.id, authorName: session.name, cityId: wall.cityId, link }).catch(() => {})

  return NextResponse.json({
    id: post.id, content: post.content, imageUrl: post.imageUrl,
    isPinned: false, createdAt: post.createdAt,
    author: buildAuthor(post.user),   // the writer's own row — never restricted from themselves
    reactions: [], replies: [],
  }, { status: 201 })
}
