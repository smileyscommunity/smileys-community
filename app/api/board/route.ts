import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { authorProjector } from '@/lib/authorProjection'
import { resolveCityId } from '@/lib/city'
import { resolvePostingCityId } from '@/lib/cityMembership'
import { getPublicCity } from '@/lib/cities'
import { rateLimit } from '@/lib/rateLimit'
import { safeNeighborhoodFor } from '@/lib/neighborhoodsDb'
import { BOARD_POST_TYPES, QUESTION_TAGS } from '@/lib/board'
import { readablePostWhere, blockedPairIds, SHOWN_REPLY, LIVE_BOARD_AUTHOR, redactBoardTextForGuest } from '@/lib/boardAccess'
import { canActInCity } from '@/lib/access'

// Community board conversation feed. Publicly readable (the board is a
// public growth surface like /visiting and /neighborhoods). Guests get
// authors as a first name (lib/authorProjection) and post text with invite
// links, numbers and emails cut out (lib/boardAccess redactBoardTextForGuest).
// All writes are member-only.

const TYPE_VALUES = new Set(BOARD_POST_TYPES.map(t => t.value))
const TAG_VALUES  = new Set(QUESTION_TAGS.map(t => t.value))
const PAGE = 15

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type         = searchParams.get('type') || undefined
  const neighborhood = searchParams.get('neighborhood') || undefined
  const offset       = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0)

  const postId       = searchParams.get('post') || undefined
  // ?city=<slug> scopes the feed to that city: the /board page carries it so
  // a shared link shows the city it names (lib/cityPageParam), and the client
  // passes it through. An unknown slug falls back to the viewer's city.
  const citySlug     = searchParams.get('city')?.trim()
  // ?saved=1: the viewer's saved posts, every city — a member's own list.
  const savedOnly    = searchParams.get('saved') === '1'

  const session = await getSession()
  if (savedOnly && !session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const blocked = await blockedPairIds(session?.id ?? null)

  const select = {
    id: true, type: true, title: true, body: true, neighborhood: true,
    tag: true, pinned: true, createdAt: true, editedAt: true, cityId: true,
    user: { select: { id: true, name: true, color: true, profilePhoto: true, profileVisibility: true } },
    // Counted as shown: a banned member's reply isn't in the thread, so it
    // isn't in "3 replies" either.
    _count: { select: { replies: { where: SHOWN_REPLY }, saves: { where: { user: LIVE_BOARD_AUTHOR } } } },
    // The viewer's own save, so the button renders in the right state.
    ...(session ? { saves: { where: { userId: session.id }, select: { userId: true as const } } } : {}),
  }

  const clubSlug = searchParams.get('club') || undefined
  // §31 — an event's conversation is canonical Board content scoped by
  // eventId; there is no separate event forum.
  const eventId = searchParams.get('event') || undefined

  // Private-club scoping: the club feed of a private club is member-only.
  // (The general feed already excludes private-club posts entirely.) An
  // unknown club and a private one a guest can't read answer the same, so
  // the status can't confirm a private slug exists.
  if (clubSlug) {
    const club = await prisma.club.findUnique({ where: { slug: clubSlug }, select: { id: true, isPrivate: true } })
    const member = club?.isPrivate && session ? await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { status: true },
    }) : null
    if (!club || (club.isPrivate && member?.status !== 'approved')) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 })
    }
  }
  // An event's conversation is readable where the event is: published, and a
  // private club's event only by its members.
  if (eventId && !await canReadEventConversation(eventId, session?.id ?? null)) {
    return NextResponse.json({ posts: [], isMember: !!session, prependedPostId: null })
  }

  const readable = readablePostWhere(session?.id ?? null)
  let posts = await prisma.boardPost.findMany({
    where: {
      status: readable.status,
      user:   readable.user,
      ...(blocked.length ? { userId: { notIn: blocked } } : {}),
      // The OR groups must AND together (sibling keys would overwrite one
      // another). ?club=<slug> narrows to that club's conversations; saved
      // and event lists take any post the viewer may read; the general feed
      // excludes posts tagged to PRIVATE clubs (those render only inside
      // the club, where membership is enforced).
      AND: [
        clubSlug
          ? { club: { slug: clubSlug } }
          : savedOnly || eventId
            ? { OR: readable.OR }
            : { OR: [{ clubId: null }, { club: { isPrivate: false } }] },
        ...(eventId ? [{ eventId }] : []),
        ...(savedOnly && session ? [{ saves: { some: { userId: session.id } } }] : []),
        // General feed is city-scoped; club, event and saved lists cross
        // city lines.
        ...(clubSlug || eventId || savedOnly ? [] : [{ cityId: (citySlug ? (await getPublicCity(citySlug))?.id : undefined) ?? await resolveCityId(session) }]),
      ],
      ...(type && TYPE_VALUES.has(type as never) ? { type } : {}),
      ...(neighborhood ? { neighborhood } : {}),
    },
    orderBy: savedOnly ? [{ createdAt: 'desc' }] : [{ pinned: 'desc' }, { createdAt: 'desc' }],
    skip: offset,
    take: PAGE,
    select,
  })

  // Deep-linked post (?post=<id>, from reply notifications and the
  // neighborhood pages): prepend it when the first page doesn't already
  // contain it. Only the CITY and filter gates are waived: the read gate
  // (removed, banned author, private club) and blocks hold here too, or a
  // forwarded link would read a private club's conversation straight off
  // this public endpoint.
  // Said out loud in the response: the prepended post makes page 1 sixteen
  // items, and a client that counted those as the page thought there was no
  // next page (16 !== 15) and offset its "Load more" by one, skipping a post.
  let prependedPostId: string | null = null
  if (postId && !posts.some(p => p.id === postId)) {
    const single = await prisma.boardPost.findFirst({
      where: { id: postId, ...readable, ...(blocked.length ? { userId: { notIn: blocked } } : {}) },
      select,
    })
    if (single) { posts = [single, ...posts]; prependedPostId = single.id }
  }

  // Authors: a first name for guests, and for members viewing a
  // connections-only author they aren't connected to (lib/authorProjection).
  const project = await authorProjector(session, posts.map(p => p.user))
  const text = (t: string) => (session ? t : redactBoardTextForGuest(t))
  return NextResponse.json({
    posts: posts.map(p => ({
      id: p.id, type: p.type, title: text(p.title), body: text(p.body),
      neighborhood: p.neighborhood, tag: p.tag,
      pinned: p.pinned, createdAt: p.createdAt, editedAt: p.editedAt,
      user: project(p.user),
      replyCount: p._count.replies,
      saveCount:  p._count.saves,
      viewerSaved: session ? (p as { saves?: unknown[] }).saves!.length > 0 : false,
      // Staff of the post's city can remove and pin it (the ••• menu).
      canModerate: !!session && canActInCity(session, p.cityId),
    })),
    isMember: !!session,
    prependedPostId,
  })
}

// Whether a viewer may read an event's conversation: the event is published,
// and a private club's event is its members' (the event page's own rule).
async function canReadEventConversation(eventId: string, viewerId: string | null): Promise<boolean> {
  const ev = await prisma.event.findUnique({
    where:  { id: eventId },
    select: { status: true, membersOnly: true, clubId: true, club: { select: { isPrivate: true } } },
  })
  if (!ev || ev.status !== 'published') return false
  if (ev.membersOnly && !viewerId) return false
  if (ev.club?.isPrivate) {
    if (!viewerId || !ev.clubId) return false
    const m = await prisma.clubMembership.findUnique({ where: { userId_clubId: { userId: viewerId, clubId: ev.clubId } }, select: { status: true } })
    return m?.status === 'approved'
  }
  return true
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

  const tag = typeof body.tag === 'string' && TAG_VALUES.has(body.tag) ? body.tag : null

  // Optional club tag (Clubs brief §19/§30) — posting into a club
  // requires approved membership of that club, private or not; the post
  // stays canonical on the Board and also surfaces in the club.
  let clubId: string | null = null
  // A club post lives in the CLUB's city (matches the GET, which lets club
  // feeds cross city lines); a plain post lives in the author's — their
  // POSTING city (lib/cityMembership), not whichever board they're browsing,
  // which is what resolveCityId used to file it to.
  let postCityId: string | null = null
  let privateClub = false
  if (typeof body.club === 'string' && body.club) {
    const club = await prisma.club.findUnique({ where: { slug: body.club }, select: { id: true, isActive: true, cityId: true, isPrivate: true } })
    if (!club || !club.isActive) return NextResponse.json({ error: 'Club not found' }, { status: 404 })
    const member = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { status: true },
    })
    if (member?.status !== 'approved') {
      return NextResponse.json({ error: 'Join the club to post in it' }, { status: 403 })
    }
    clubId = club.id
    privateClub = club.isPrivate
    // Global clubs (cityId null) have no city of their own — the post
    // lives in the author's city instead. BoardPost.cityId stays required.
    postCityId = club.cityId ?? await resolvePostingCityId(session)
  }

  // Optional event tie (§31) — the post stays canonical on the Board and
  // also shows in the event page's Conversation. Only for someone on the
  // event (host, co-host, a confirmed guest) or staff of its city, and only
  // an event they can read: any member could push posts onto any event's
  // page, a private club's included. The post files to the event's city.
  let eventTie: string | null = null
  if (typeof body.event === 'string' && body.event) {
    const ev = await prisma.event.findUnique({ where: { id: body.event }, select: { id: true, cityId: true, hostId: true } })
    if (!ev || !await canReadEventConversation(ev.id, session.id)) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }
    const onEvent = ev.hostId === session.id || canActInCity(session, ev.cityId) || !!(await prisma.eventAttendee.findFirst({
      where: { eventId: ev.id, userId: session.id, status: 'approved' }, select: { id: true },
    })) || !!(await prisma.eventCoHost.findFirst({ where: { eventId: ev.id, userId: session.id }, select: { id: true } }))
    if (!onEvent) return NextResponse.json({ error: 'Only people going can post in this event\'s conversation' }, { status: 403 })
    eventTie = ev.id
    postCityId = postCityId ?? ev.cityId
  }

  const cityId = postCityId ?? await resolvePostingCityId(session)
  // Validated against the city the post actually files to — neighborhood
  // names are per city, and checking the browsed city's registry dropped a
  // real home neighborhood (or kept a name the post's city doesn't have).
  // A private club's post names no neighbourhood: it must never be what a
  // public neighbourhood page lists.
  const neighborhood = privateClub ? null : await safeNeighborhoodFor(cityId, body.neighborhood)

  const created = await prisma.boardPost.create({
    data: { userId: session.id, cityId, type, title, body: text, neighborhood, tag, clubId, eventId: eventTie },
    select: { id: true },
  })

  return NextResponse.json({ id: created.id }, { status: 201 })
}
