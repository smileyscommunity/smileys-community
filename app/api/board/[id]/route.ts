import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canActInCity } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'
import { writeAudit } from '@/lib/audit'
import { QUESTION_TAGS } from '@/lib/board'

type Params = { params: Promise<{ id: string }> }

const TAG_VALUES = new Set<string>(QUESTION_TAGS.map(t => t.value))
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi

// PATCH: the author edits the title, details or topic (a typo used to mean
// deleting the post and its replies); staff of the post's city pin or unpin
// it. Nothing else about a post changes after it's made.
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const post = await prisma.boardPost.findUnique({ where: { id }, select: { userId: true, cityId: true, status: true, type: true, title: true } })
  if (!post || post.status !== 'active') return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  const isAuthor = post.userId === session.id
  const isStaff  = canActInCity(session, post.cityId)

  const body = (await req.json().catch(() => null)) ?? {}
  const data: { title?: string; body?: string; tag?: string | null; editedAt?: Date; pinned?: boolean } = {}

  if ('pinned' in body) {
    if (!isStaff) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    data.pinned = body.pinned === true
  }
  if ('title' in body || 'body' in body || 'tag' in body) {
    if (!isAuthor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!await rateLimit(`board-edit:${session.id}`, 20, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many edits — try again later' }, { status: 429 })
    }
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : undefined
    const text  = typeof body.body === 'string' ? body.body.trim().slice(0, 1000) : undefined
    if (title !== undefined && !title) return NextResponse.json({ error: 'Say what your post is about' }, { status: 400 })
    // Same one-link rule as creating a post, over what the post will say.
    const current = await prisma.boardPost.findUnique({ where: { id }, select: { body: true } })
    if ((`${title ?? post.title} ${text ?? current?.body ?? ''}`.match(URL_PATTERN) ?? []).length > 1) {
      return NextResponse.json({ error: 'One link per post, please' }, { status: 400 })
    }
    if (title !== undefined) data.title = title
    if (text  !== undefined) data.body  = text
    if ('tag' in body) data.tag = post.type === 'question' && typeof body.tag === 'string' && TAG_VALUES.has(body.tag) ? body.tag : null
    data.editedAt = new Date()
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })

  const updated = await prisma.boardPost.update({
    where:  { id },
    data,
    select: { id: true, title: true, body: true, tag: true, pinned: true, editedAt: true },
  })
  if ('pinned' in data) {
    writeAudit(session.id, session.name, data.pinned ? 'board.pin' : 'board.unpin', id, 'board_post',
      { cityId: post.cityId }, `${data.pinned ? 'Pinned' : 'Unpinned'} board post "${post.title.slice(0, 80)}"`)
  }
  return NextResponse.json(updated)
}

// Author (or staff) removes a post. Soft delete — status='removed' — so
// moderation can still see what was posted if it was reported first.
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const post = await prisma.boardPost.findUnique({ where: { id }, select: { userId: true, cityId: true, title: true, status: true } })
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  const isAuthor = post.userId === session.id
  if (!isAuthor && !canActInCity(session, post.cityId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (post.status === 'removed') return NextResponse.json({ ok: true })

  await prisma.boardPost.update({ where: { id }, data: { status: 'removed', pinned: false } })
  if (!isAuthor) {
    writeAudit(session.id, session.name, 'board.remove', id, 'board_post',
      { userId: post.userId, cityId: post.cityId }, `Removed board post "${post.title.slice(0, 80)}"`)
  }
  return NextResponse.json({ ok: true })
}
