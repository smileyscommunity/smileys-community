import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'
import { firstNameOf } from '@/lib/data'
import { authorProjector } from '@/lib/authorProjection'
import { canManagePosts, canActOnCityContent } from '@/lib/access'
import { blockedPairIds, SHOWN_REPLY } from '@/lib/boardAccess'
import { isBlockedEitherWay } from '@/lib/memberPrivacy'

// Member comments under a story. Flat (no threads), members only: a guest
// sees the count on the page and is sent to sign in, so this answers 401
// rather than leaking text. Stories only — a handbook article is reference
// material, not a conversation.

type Params = { params: Promise<{ slug: string }> }

const MAX_LEN = 1000

async function publishedStory(slug: string) {
  const post = await prisma.post.findUnique({
    where:  { slug },
    select: { id: true, slug: true, title: true, kind: true, status: true, authorId: true, cityId: true },
  })
  return post && post.kind === 'community' && post.status === 'published' ? post : null
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Sign in to read comments' }, { status: 401 })

  const { slug } = await params
  const post = await publishedStory(slug)
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const blocked = await blockedPairIds(session.id)
  // Newest 200, shown oldest first, so a long thread keeps the latest visible.
  const rows = (await prisma.postComment.findMany({
    where:   { postId: post.id, ...SHOWN_REPLY, ...(blocked.length ? { userId: { notIn: blocked } } : {}) },
    orderBy: { createdAt: 'desc' },
    take:    200,
    select: {
      id: true, body: true, createdAt: true,
      user: { select: { id: true, name: true, color: true, profilePhoto: true, profileVisibility: true } },
    },
  })).reverse()
  const project = await authorProjector(session, rows.map(r => r.user))
  const staff = canManagePosts(session) && canActOnCityContent(session, post.cityId)
  return NextResponse.json({
    comments: rows.map(r => ({
      id: r.id, body: r.body, createdAt: r.createdAt,
      user: project(r.user),
      // Its author, the story's author, or staff who can act on the story.
      canRemove: r.user.id === session.id || post.authorId === session.id || staff,
    })),
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`post-comment:${session.id}`, 6, 60_000))         return NextResponse.json({ error: 'Commenting too fast — slow down' }, { status: 429 })
  if (!await rateLimit(`post-comment-day:${session.id}`, 40, 86_400_000)) return NextResponse.json({ error: 'Daily comment limit reached' }, { status: 429 })

  const { slug } = await params
  const post = await publishedStory(slug)
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (post.authorId !== session.id && await isBlockedEitherWay(session.id, post.authorId)) {
    return NextResponse.json({ error: 'Cannot interact with this member' }, { status: 403 })
  }

  const raw  = await req.json().catch(() => ({}))
  const body = typeof raw?.body === 'string' ? raw.body.trim().slice(0, MAX_LEN) : ''
  if (!body) return NextResponse.json({ error: 'Comment cannot be empty' }, { status: 400 })
  // Same one-link cap as board replies: comments are the link-spam surface.
  if ((body.match(/\b(?:https?:\/\/|www\.)\S+/gi) ?? []).length > 1) {
    return NextResponse.json({ error: 'One link per comment, please' }, { status: 400 })
  }

  const created = await prisma.postComment.create({
    data:   { postId: post.id, userId: session.id, body },
    select: { id: true, body: true, createdAt: true, user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
  })

  if (post.authorId !== session.id) {
    createNotification(
      post.authorId,
      'story_comment',
      `💬 ${firstNameOf(session.name)} commented on your story`,
      `"${post.title.slice(0, 80)}" — ${body.slice(0, 100)}`,
      `/posts/${post.slug}#comments`,
    ).catch(() => {})
  }

  return NextResponse.json({ comment: { ...created, canRemove: true } }, { status: 201 })
}
