import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { writeAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// Withdraw a story that never went live. A published one is public writing
// with a permanent URL and is not the writer's to pull from here — staff
// unpublish those, on request. Nor a 'draft': staff moved it there to work
// on it, and it comes back to the writer as published or declined.
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const story = await prisma.post.findFirst({
    where:  { id, authorId: session.id, kind: 'community', status: { in: ['submitted', 'declined'] } },
    select: { title: true, status: true },
  })
  if (!story) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const gone = await prisma.post.deleteMany({ where: { id, authorId: session.id, status: story.status } })
  if (gone.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  writeAudit(session.id, session.name, 'post.withdraw', id, 'post',
    { title: story.title, status: story.status }, `Withdrew ${story.status} story "${story.title}"`)
  return NextResponse.json({ ok: true })
}
