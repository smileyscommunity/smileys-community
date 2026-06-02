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
  const { name, emoji } = await req.json()
  const tag = await prisma.tag.update({
    where: { id },
    data: { ...(name && { name: name.trim() }), ...(emoji && { emoji }) },
  })
  return NextResponse.json(tag)
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !canManageTags(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const snapshot = await prisma.tag.findUnique({ where: { id },
    select: { name: true, emoji: true, groupId: true } })
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await prisma.tag.delete({ where: { id } })
  writeAudit(session.id, session.name, 'tag.delete', id, 'tag',
    { name: snapshot.name, emoji: snapshot.emoji, groupId: snapshot.groupId },
    `Deleted tag ${snapshot.emoji} "${snapshot.name}"`,
  )
  return NextResponse.json({ ok: true })
}
