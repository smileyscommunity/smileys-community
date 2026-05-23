import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManagePosts } from '@/lib/access'

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const post = await prisma.post.findUnique({ where: { id }, include: { author: { select: { name: true } } } })
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(post)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { title, excerpt, body, coverImage, status, category } = await req.json()
  if (!title?.trim() || !body?.trim()) {
    return NextResponse.json({ error: 'Title and body are required' }, { status: 400 })
  }

  const existing = await prisma.post.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const wasPublished = existing.status === 'published'
  const nowPublished = status === 'published'

  const post = await prisma.post.update({
    where: { id },
    data: {
      title:      title.trim(),
      excerpt:    excerpt?.trim() || null,
      body:       body.trim(),
      coverImage: coverImage || null,
      status:     nowPublished ? 'published' : 'draft',
      category:   category || 'Community',
      publishedAt: nowPublished
        ? (wasPublished ? existing.publishedAt : new Date())
        : null,
    },
  })
  return NextResponse.json(post)
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  await prisma.post.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
