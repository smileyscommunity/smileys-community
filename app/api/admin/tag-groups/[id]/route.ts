import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManageTags } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !canManageTags(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { name, emoji, sortOrder } = await req.json()
  const group = await prisma.tagGroup.update({
    where: { id },
    data: { ...(name && { name: name.trim() }), ...(emoji && { emoji }), ...(sortOrder != null && { sortOrder }) },
  })
  return NextResponse.json(group)
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !canManageTags(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const snapshot = await prisma.tagGroup.findUnique({ where: { id },
    select: { name: true, emoji: true, _count: { select: { tags: true } } } })
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await prisma.tagGroup.delete({ where: { id } })
  writeAudit(session.id, session.name, 'tag_group.delete', id, 'tag_group',
    { name: snapshot.name, emoji: snapshot.emoji, tagCount: snapshot._count.tags },
    `Deleted tag group ${snapshot.emoji} "${snapshot.name}"${snapshot._count.tags ? ` — ${snapshot._count.tags} child tag${snapshot._count.tags === 1 ? '' : 's'} cascaded` : ''}`,
  )
  return NextResponse.json({ ok: true })
}
