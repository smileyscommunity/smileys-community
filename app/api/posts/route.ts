import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId } from '@/lib/city'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const category = searchParams.get('category')

  // kind: 'community' so handbook articles don't leak into the blog feed
  // (mirrors app/posts/page.tsx), and city-scoped so one city's posts
  // don't surface in every other city's (mirrors the search route:
  // global posts have cityId NULL).
  const cityId = await resolveCityId(await getSession())
  const posts = await prisma.post.findMany({
    where: {
      kind: 'community',
      status: 'published',
      OR: [{ cityId: null }, { cityId }],
      ...(category ? { category } : {}),
    },
    orderBy: { publishedAt: 'desc' },
    select: {
      id: true, title: true, slug: true, excerpt: true,
      coverImage: true, category: true, publishedAt: true,
      author: { select: { name: true } },
    },
  })
  return NextResponse.json(posts)
}
