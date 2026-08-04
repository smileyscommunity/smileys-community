import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

// Soft-remove a visitor announcement. Allowed for the original poster (if
// they're a member) or for staff. Anonymous posts can only be removed by
// staff — they're not coming back to delete their own.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const announcement = await prisma.visitorAnnouncement.findUnique({ where: { id } })
  if (!announcement) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (announcement.userId !== session.id && !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.visitorAnnouncement.update({ where: { id }, data: { status: 'removed' } })
  // /visiting caches the announcement list for 2 minutes — a removed post
  // lingering there after the owner deleted it reads as broken.
  revalidateTag('visitor-announcements')
  return NextResponse.json({ ok: true })
}
