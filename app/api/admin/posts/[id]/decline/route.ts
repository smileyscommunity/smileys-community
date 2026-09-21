import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManagePosts, canActOnCityContent } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { createNotification } from '@/lib/notify'

// The answer a member story can get besides "published": until this existed
// the queue's only other button was Delete, so a submission that didn't go
// up vanished without a word and the writer never heard back. The row stays
// (status 'declined') so the list and the member's own "Your stories" both
// remember it; the note, if any, travels in the notification only.
const NOTE_MAX = 300

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, NOTE_MAX) : ''

  const post = await prisma.post.findUnique({ where: { id }, select: { title: true, status: true, cityId: true, authorId: true } })
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canActOnCityContent(session, post.cityId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (post.status !== 'submitted') {
    return NextResponse.json({ error: 'Only a story awaiting review can be declined' }, { status: 400 })
  }

  // Guarded on the current status so two reviewers clicking at once tell the
  // writer once.
  const changed = await prisma.post.updateMany({ where: { id, status: 'submitted' }, data: { status: 'declined' } })
  if (changed.count === 0) return NextResponse.json({ error: 'Only a story awaiting review can be declined' }, { status: 400 })

  writeAudit(session.id, session.name, 'post.decline', id, 'post',
    { title: post.title, note: note || null },
    `Declined story "${post.title}"`,
  )
  await createNotification(
    post.authorId, 'story_declined',
    'About your story',
    note
      ? `"${post.title}" isn't going up this time. ${note}`
      : `"${post.title}" isn't going up this time — thank you for writing it.`,
    '/share-story',
  ).catch(e => console.error('Story decline notify failed:', e))

  return NextResponse.json({ ok: true })
}
