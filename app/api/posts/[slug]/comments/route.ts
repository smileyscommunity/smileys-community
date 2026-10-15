import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'
import { firstNameOf } from '@/lib/data'
import { authorProjector } from '@/lib/authorProjection'
import { canModerateComments, cleanCommentBody } from '@/lib/storyComments'
import { extractMentions, mentionCandidatesSql, mentionMatches, dropBlocked, MAX_RECIPIENTS } from '@/lib/mentions'
import { blockedPairIds, SHOWN_REPLY } from '@/lib/boardAccess'
import { isBlockedEitherWay } from '@/lib/memberPrivacy'

// Member comments under a story. Flat (no threads), members only: a guest
// sees the count on the page and is sent to sign in, so this answers 401
// rather than leaking text. Stories only — a handbook article is reference
// material, not a conversation.

type Params = { params: Promise<{ slug: string }> }

// @FirstName mentions, the same composer token and matching as the clubs and
// neighborhood walls (lib/mentions): whole first names, the commenter's own
// city, capped, never across a block. Returns who was pinged.
async function notifyCommentMentions(
  post: { slug: string; title: string },
  session: { id: string; name: string; cityId?: string },
  body: string,
): Promise<Set<string>> {
  const words = extractMentions(body)
  if (!words.length) return new Set()
  const candidates = await prisma.$queryRaw<{ id: string; name: string }[]>(
    mentionCandidatesSql({ words, authorId: session.id, cityId: session.cityId ?? null }),
  )
  const matched    = candidates.filter(u => words.some(w => mentionMatches(u.name, w)))
  const recipients = (await dropBlocked(session.id, matched)).slice(0, MAX_RECIPIENTS)
  await Promise.allSettled(recipients.map(u =>
    createNotification(u.id, 'story_comment_mention', `${firstNameOf(session.name)} mentioned you`,
      `"${post.title.slice(0, 80)}" — ${body.slice(0, 100)}`, `/posts/${post.slug}#comments`)))
  return new Set(recipients.map(u => u.id))
}

async function notifyEarlierCommenters(
  post: { id: string; slug: string; title: string; authorId: string },
  session: { id: string; name: string },
  body: string,
  skip: Set<string>,
) {
  const link = `/posts/${post.slug}#comments`
  const earlier = await prisma.postComment.findMany({
    where:    { postId: post.id, removedAt: null, userId: { notIn: [session.id, post.authorId, ...skip] }, user: { status: 'approved', hiddenFromMembers: false } },
    distinct: ['userId'],
    orderBy:  { createdAt: 'desc' },
    take:     30,
    select:   { userId: true },
  })
  for (const { userId } of earlier) {
    if (await isBlockedEitherWay(session.id, userId)) continue
    // One unread notice per story: a busy thread is one bell entry, not a
    // push for every comment.
    const unread = await prisma.notification.findFirst({ where: { userId, type: 'story_comment_reply', link, isRead: false }, select: { id: true } })
    if (unread) continue
    await createNotification(
      userId,
      'story_comment_reply',
      `💬 ${firstNameOf(session.name)} also commented`,
      `"${post.title.slice(0, 80)}" — ${body.slice(0, 100)}`,
      link,
    ).catch(() => {})
  }
}

async function publishedStory(slug: string) {
  const post = await prisma.post.findUnique({
    where:  { slug },
    select: { id: true, slug: true, title: true, kind: true, status: true, authorId: true, cityId: true, commentsOff: true },
  })
  return post && post.kind === 'community' && post.status === 'published' && !post.commentsOff ? post : null
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
      id: true, body: true, createdAt: true, editedAt: true,
      user: { select: { id: true, name: true, color: true, profilePhoto: true, profileVisibility: true } },
      _count: { select: { likes: true } },
      likes: { where: { userId: session.id }, select: { userId: true } },
    },
  })).reverse()
  const project = await authorProjector(session, rows.map(r => r.user))
  const staff = canModerateComments(session, post.cityId)
  return NextResponse.json({
    comments: rows.map(r => ({
      id: r.id, body: r.body, createdAt: r.createdAt, editedAt: r.editedAt,
      likeCount: r._count.likes, liked: r.likes.length > 0,
      isMine: r.user.id === session.id,
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

  const raw   = await req.json().catch(() => ({}))
  const clean = cleanCommentBody(raw?.body)
  if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 400 })
  const body = clean.body

  // Everyone already in the conversation hears about the new comment, once per
  // story until they read it: earlier commenters other than the commenter and
  // the story's author (who has their own notice below).
  const created = await prisma.postComment.create({
    data:   { postId: post.id, userId: session.id, body },
    select: { id: true, body: true, createdAt: true, user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
  })

  // @mentions first: a mentioned member gets the mention notice, not also the
  // author / earlier-commenter one below.
  const mentioned = await notifyCommentMentions(post, session, body).catch(() => new Set<string>())

  if (post.authorId !== session.id && !mentioned.has(post.authorId)) {
    createNotification(
      post.authorId,
      'story_comment',
      `💬 ${firstNameOf(session.name)} commented on your story`,
      `"${post.title.slice(0, 80)}" — ${body.slice(0, 100)}`,
      `/posts/${post.slug}#comments`,
    ).catch(() => {})
  }

  notifyEarlierCommenters(post, session, body, mentioned).catch(() => {})

  return NextResponse.json({ comment: { ...created, editedAt: null, likeCount: 0, liked: false, isMine: true, canRemove: true } }, { status: 201 })
}
