import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator } from '@/lib/access'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'
import { writeAudit } from '@/lib/audit'

export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const items = await prisma.storyPhoto.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'desc' }] })
  return NextResponse.json(items)
}

// Writes are an admin's: these photos are the public /why page of every city
// (StoryPhoto has no city), the way network-wide quotes are admin-only.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { url, caption, event } = await req.json()
  const cleanUrl = String(url ?? '').trim().slice(0, 2000)
  if (!cleanUrl) {
    return NextResponse.json({ error: 'Photo URL required' }, { status: 400 })
  }
  // An image from our own uploads only. Any https:// URL was accepted, and
  // an outside host then saw the IP and browser of every /why visitor.
  if (!isUploadedImageUrl(cleanUrl)) {
    return NextResponse.json({ error: 'Upload the photo — outside image links aren\'t allowed' }, { status: 400 })
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
  writeAudit(session.id, session.name, 'story_photo.create', item.id, 'story_photo',
    { url: item.url, caption: item.caption, event: item.event }, `Added a story photo (${item.url})`)
  return NextResponse.json(item)
}
