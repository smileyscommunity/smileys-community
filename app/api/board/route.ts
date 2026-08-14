import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId } from '@/lib/city'
import { rateLimit } from '@/lib/rateLimit'
import { safeNeighborhoodFor } from '@/lib/neighborhoodsDb'
import { BOARD_POST_TYPES, QUESTION_TAGS } from '@/lib/board'

// Istanbul Board conversation feed. Publicly readable (the Board is a
// public growth surface like /visiting and /neighborhoods) — but posts
// carry no contact fields, and the member data exposed here (name, photo)
// matches what public listing cards already show. All writes are
// member-only.

const TYPE_VALUES = new Set(BOARD_POST_TYPES.map(t => t.value))
const TAG_VALUES  = new Set(QUESTION_TAGS.map(t => t.value))

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type         = searchParams.get('type') || undefined
  const neighborhood = searchParams.get('neighborhood') || undefined
  const offset       = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0)

  const postId       = searchParams.get('post') || undefined

  const session = await getSession()

  const select = {
    id: true, type: true, title: true, body: true, neighborhood: true,
    tag: true, whenLabel: true, expiresAt: true, pinned: true, createdAt: true,
    user: { select: { id: true, name: true, color: true, profilePhoto: true } },
    _count: { select: { replies: true, interests: true, saves: true } },
    // The viewer's own reactions, so buttons render in the right state.
    ...(session ? {
      interests: { where: { userId: session.id }, select: { userId: true as const } },
      saves:     { where: { userId: session.id }, select: { userId: true as const } },
    } : {}),
  }

  const clubSlug = searchParams.get('club') || undefined
  // §31 — an event's conversation is canonical Board content scoped by
  // eventId; there is no separate event forum.
  const eventId = searchParams.get('event') || undefined

  // Private-club scoping: the club feed of a private club is member-only.
  // (The general feed already excludes private-club posts entirely.)
  if (clubSlug) {
    const club = await prisma.club.findUnique({ where: { slug: clubSlug }, select: { id: true, isPrivate: true } })
    if (!club) return NextResponse.json({ error: 'Club not found' }, { status: 404 })
    if (club.isPrivate) {
      const s = await getSession()
      const member = s ? await prisma.clubMembership.findUnique({
        where: { userId_clubId: { userId: s.id, clubId: club.id } },
        select: { status: true },
      }) : null
      if (member?.status !== 'approved') {
        return NextResponse.json({ error: 'Members only' }, { status: 403 })
      }
    }
  }

  let posts = await prisma.boardPost.findMany({
    where: {
      status: 'active',
      // §48 (Members brief): posts by deactivated/banned members leave
      // the public feed.
      user: { status: 'approved' },
      // Two OR groups must AND together (spreading them as sibling keys
      // would silently overwrite one another): expiry — expired plans
      // drop out of the feed but stay reachable at their own URL — and
      // club scoping (Clubs brief §18/§30): ?club=<slug> narrows to that
      // club's conversations, while the general feed excludes posts
      // tagged to PRIVATE clubs (those render only inside the club,
      // where membership is enforced).
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        clubSlug
          ? { club: { slug: clubSlug } }
          : { OR: [{ clubId: null }, { club: { isPrivate: false } }] },
        ...(eventId ? [{ eventId }] : []),
        // General feed is city-scoped; club and event feeds inherit their
        // club's/event's city implicitly and stay reachable cross-city.
        ...(clubSlug || eventId ? [] : [{ cityId: await resolveCityId(session) }]),
      ],
      ...(type && TYPE_VALUES.has(type as never) ? { type } : {}),
      ...(neighborhood ? { neighborhood } : {}),
    },
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    skip: offset,
    take: 15,
    select,
  })

  // Deep-linked post (?post=<id>, from reply notifications and the
  // neighborhood pages): prepend it when the first page doesn't already
  // contain it — this is what keeps expired plans "reachable at their own
  // URL" per the comment above. Only the EXPIRY and CITY gates are waived:
  // the banned-author and private-club gates must hold here too, or a
  // shared/forwarded link would read a private club's conversation (or a
  // banned member's post) straight off this public endpoint.
  if (postId && !posts.some(p => p.id === postId)) {
    const single = await prisma.boardPost.findFirst({
      where: {
        id: postId, status: 'active',
        user: { status: 'approved' },
        OR: [
          { clubId: null },
          { club: { isPrivate: false } },
          ...(session ? [{ club: { memberships: { some: { userId: session.id, status: 'approved' } } } }] : []),
        ],
      },
      select,
    })
    if (single) posts = [single, ...posts]
  }

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

  // Links are legitimate in a community feed (sharing an article, a place),
  // but the 10-post daily cap times unlimited URLs is a workable spam
  // payload for a compromised member account. One link per post keeps the
  // legitimate use and removes the fan-out. Counted across title+body so
  // the title can't smuggle a second one.
  const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi
  const linkCount = (`${title} ${text}`.match(URL_PATTERN) ?? []).length
  if (linkCount > 1) {
    return NextResponse.json({ error: 'One link per post, please' }, { status: 400 })
  }

  const neighborhood = await safeNeighborhoodFor(await resolveCityId(session), body.neighborhood)

  const tag = typeof body.tag === 'string' && TAG_VALUES.has(body.tag) ? body.tag : null

  // Optional club tag (Clubs brief §19/§30) — posting into a club
  // requires approved membership of that club, private or not; the post
  // stays canonical on the Board and also surfaces in the club.
  let clubId: string | null = null
  // A club post lives in the CLUB's city (matches the GET, which lets club
  // feeds cross city lines); a plain post lives in the author's.
  let postCityId: string | null = null
  if (typeof body.club === 'string' && body.club) {
    const club = await prisma.club.findUnique({ where: { slug: body.club }, select: { id: true, isActive: true, cityId: true } })
    if (!club || !club.isActive) return NextResponse.json({ error: 'Club not found' }, { status: 404 })
    const member = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { status: true },
    })
    if (member?.status !== 'approved') {
      return NextResponse.json({ error: 'Join the club to post in it' }, { status: 403 })
    }
    clubId = club.id
    postCityId = club.cityId
  }

  // Optional event tie (§31) — the post stays canonical on the Board and
  // also surfaces on the event page. Validated so a bad id can't orphan.
  let eventTie: string | null = null
  if (typeof body.event === 'string' && body.event) {
    const ev = await prisma.event.findUnique({ where: { id: body.event }, select: { id: true, status: true } })
    if (ev && ev.status === 'published') eventTie = ev.id
  }

  const created = await prisma.boardPost.create({
    data: { userId: session.id, cityId: postCityId ?? await resolveCityId(session), type, title, body: text, neighborhood, tag, clubId, eventId: eventTie },
    select: { id: true },
  })

  return NextResponse.json({ id: created.id }, { status: 201 })
}
