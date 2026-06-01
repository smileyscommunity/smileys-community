import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManagePosts } from '@/lib/access'
import { slugify } from '@/lib/slug'

export async function GET() {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const posts = await prisma.post.findMany({
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { name: true } } },
  })
  return NextResponse.json(posts)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { title, excerpt, body, coverImage, status, category } = await req.json()
  if (!title?.trim() || !body?.trim()) {
    return NextResponse.json({ error: 'Title and body are required' }, { status: 400 })
  }

  const base = slugify(title).slice(0, 80)
  let slug = base
  let i = 1
  while (await prisma.post.findUnique({ where: { slug } })) {
    slug = `${base}-${i++}`
  }

  const post = await prisma.post.create({
    data: {
      title:      title.trim(),
      slug,
      excerpt:    excerpt?.trim() || null,
      body:       body.trim(),
      coverImage: coverImage || null,
      status:     status === 'published' ? 'published' : 'draft',
      category:   category || 'Community',
      authorId:   session.id,
      publishedAt: status === 'published' ? new Date() : null,
    },
  })
  return NextResponse.json(post)
}
