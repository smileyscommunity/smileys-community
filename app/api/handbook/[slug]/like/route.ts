import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

// Toggle a like on a handbook article. Same shape as the club /
// neighborhood like routes: POST toggles, and the response carries
// the fresh count so the client doesn't need a follow-up GET.
//
// The handbook is public, so the *page* renders for logged-out
// visitors — but liking still requires a session (the UI sends
// guests to sign in rather than calling this).

type Params = { params: Promise<{ slug: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const { slug } = await params

  // Resolve by slug (the public identifier) and require the article to
  // actually be a published handbook piece — otherwise a caller could
  // like a draft, or any other Post row, by guessing a slug.
  const post = await prisma.post.findUnique({
    where:  { slug },
    select: { id: true, kind: true, status: true },
  })
  if (!post || post.kind !== 'handbook' || post.status !== 'published') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const key = { postId_userId: { postId: post.id, userId: session.id } }
  const existing = await prisma.postLike.findUnique({ where: key })

  if (existing) {
    await prisma.postLike.delete({ where: key })
  } else {
    await prisma.postLike.create({ data: { postId: post.id, userId: session.id } })
  }

  const count = await prisma.postLike.count({ where: { postId: post.id } })
  return NextResponse.json({ liked: !existing, count })
}
