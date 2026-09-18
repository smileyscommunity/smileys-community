import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isBlockedEitherWay } from '@/lib/memberPrivacy'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ id: string }> }

// Toggle "save" on a post. "Interested" went with board plans (2026-08-02):
// nothing in the app offered it, but the endpoint still took it, and each
// off→on cycle pinged the author again — a script could push ~15 a minute.
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await rateLimit(`board-react:${session.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too fast — slow down' }, { status: 429 })
  }

  const { id } = await params
  const { kind } = (await req.json().catch(() => null)) ?? {}
  if (kind !== 'save') {
    return NextResponse.json({ error: 'Invalid reaction' }, { status: 400 })
  }

  const post = await prisma.boardPost.findUnique({
    where:  { id },
    select: { id: true, userId: true, status: true, title: true, clubId: true, club: { select: { isPrivate: true } } },
  })
  if (!post || post.status !== 'active') return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  // A block is a block on the board too — DM and listing contact already
  // refuse it; replying/"interested" pinged the author by name regardless.
  // After the status gate so a blocked member learns nothing a stranger
  // wouldn't about a removed post.
  if (post.userId !== session.id && await isBlockedEitherWay(session.id, post.userId)) {
    return NextResponse.json({ error: 'Cannot interact with this member' }, { status: 403 })
  }

  // Same private-club gate as replies: a non-member with a private post's id
  // must not be able to ping its author (or confirm the post exists).
  if (post.clubId && post.club?.isPrivate) {
    const member = await prisma.clubMembership.findUnique({
      where:  { userId_clubId: { userId: session.id, clubId: post.clubId } },
      select: { status: true },
    })
    if (member?.status !== 'approved') {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }
  }

  const where = { postId_userId: { postId: id, userId: session.id } }

  const existing = await prisma.boardSave.findUnique({ where })
  if (existing) {
    await prisma.boardSave.delete({ where })
    return NextResponse.json({ active: false })
  }
  await prisma.boardSave.create({ data: { postId: id, userId: session.id } })
  return NextResponse.json({ active: true })
}
