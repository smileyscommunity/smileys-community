import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

export async function GET() {
  const session = await getSession()
  if (!session || (session.role !== 'admin' && session.role !== 'moderator')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const items = await prisma.storyPhoto.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'desc' }] })
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || (session.role !== 'admin' && session.role !== 'moderator')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { url, caption, event } = await req.json()
  const cleanUrl = url?.trim()
  if (!cleanUrl || cleanUrl.length > 2000) {
    return NextResponse.json({ error: 'Valid URL required (max 2000 chars)' }, { status: 400 })
  }
  // Only allow relative paths or https URLs
  if (!cleanUrl.startsWith('/') && !cleanUrl.startsWith('https://')) {
    return NextResponse.json({ error: 'URL must be a relative path or https URL' }, { status: 400 })
  }
  if (caption && caption.length > 300) {
    return NextResponse.json({ error: 'Caption too long (max 300 chars)' }, { status: 400 })
  }
  if (event && event.length > 200) {
    return NextResponse.json({ error: 'Event name too long (max 200 chars)' }, { status: 400 })
  }

  const maxOrder = await prisma.storyPhoto.aggregate({ _max: { order: true } })
  const item = await prisma.storyPhoto.create({
    data: {
      url:     cleanUrl,
      caption: caption?.trim() || null,
      event:   event?.trim() || null,
      order:   (maxOrder._max.order ?? 0) + 1,
    },
  })
  return NextResponse.json(item)
}
