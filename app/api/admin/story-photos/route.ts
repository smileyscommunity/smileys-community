import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { isSafeHref } from '@/lib/safeUrl'

export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const items = await prisma.storyPhoto.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'desc' }] })
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { url, caption, event } = await req.json()
  const cleanUrl = String(url ?? '').trim().slice(0, 2000)
  if (!cleanUrl) {
    return NextResponse.json({ error: 'Photo URL required' }, { status: 400 })
  }
  // Use the shared isSafeHref allowlist — previously the inline check
  // accepted any string starting with `/`, so `//evil.com` (resolves
  // to https://evil.com when rendered as an <img src>) bypassed it.
  if (!isSafeHref(cleanUrl)) {
    return NextResponse.json({ error: 'URL must be a relative path (/path) or https:// URL' }, { status: 400 })
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
