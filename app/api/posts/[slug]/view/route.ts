import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Increment an article's view counter. Fired once per browser session by
// ArticleViewBeacon (the client dedupes via sessionStorage). Best-effort and
// atomic (`increment`) — a missed or double count doesn't matter for a soft
// engagement metric. Guarded to published posts so draft previews and unknown
// slugs can't inflate the number. Works for both handbook and community
// articles since `slug` is unique across all posts.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  await prisma.post.updateMany({
    where: { slug, status: 'published' },
    data:  { views: { increment: 1 } },
  })
  return NextResponse.json({ ok: true })
}
