import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const category = searchParams.get('category')

  const posts = await prisma.post.findMany({
    where: {
      status: 'published',
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
