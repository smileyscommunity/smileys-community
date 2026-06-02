import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const data = await req.json()
  const item = await prisma.storyPhoto.update({ where: { id }, data })
  return NextResponse.json(item)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const snapshot = await prisma.storyPhoto.findUnique({ where: { id } })
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await prisma.storyPhoto.delete({ where: { id } })
  writeAudit(session.id, session.name, 'story_photo.delete', id, 'story_photo',
    snapshot as Record<string, unknown>,
    `Deleted story photo (${snapshot.url ?? id})`,
  )
  return NextResponse.json({ ok: true })
}
