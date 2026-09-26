import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rateLimit, getIp } from '@/lib/rateLimit'

// Increment an article's view counter. Fired once per browser session by
// ArticleViewBeacon (the client dedupes via sessionStorage). Best-effort and
// atomic (`increment`) — a missed or double count doesn't matter for a soft
// engagement metric. Guarded to published posts so draft previews and unknown
// slugs can't inflate the number. Works for both handbook and community
// articles since `slug` is unique across all posts.
//
// Raw SQL on purpose: Prisma's @updatedAt would stamp the row on every view,
// and updatedAt is the version the post editors check before saving (and the
// article's dateModified) — a reader opening the page must not make an open
// editor's save 409.
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  // Soft metric, but not an open counter: one browser, one bump per minute.
  if (!await rateLimit(`post-view:${getIp(req)}`, 60, 60_000)) return NextResponse.json({ ok: true })
  const { slug } = await params
  await prisma.$executeRaw`UPDATE "posts" SET "views" = "views" + 1 WHERE "slug" = ${slug} AND "status" = 'published'`
  return NextResponse.json({ ok: true })
}
