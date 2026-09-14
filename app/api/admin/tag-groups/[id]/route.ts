import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManageTags } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { deleteCached } from '@/lib/analyticsCache'

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
  // /api/tags serves this taxonomy from a 2-minute cache; the tag routes
  // already bust it, the group routes didn't, so a rename lagged on every picker.
  deleteCached('tags:groups')
  return NextResponse.json(group)
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !canManageTags(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const snapshot = await prisma.tagGroup.findUnique({ where: { id },
    select: { name: true, emoji: true, _count: { select: { tags: true } } } })
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Tag.group has no cascade, so deleting a group that still has tags hit the
  // foreign key and answered a bare 500. Cascading instead would silently strip
  // those tags off every event and interest map using them (EventTag and
  // InterestTagMap cascade from Tag) — so refuse and say what to do.
  const tagCount = snapshot._count.tags
  const refuse = (n: number) => NextResponse.json({
    error: `"${snapshot.name}" still has ${n} tag${n === 1 ? '' : 's'}. Delete ${n === 1 ? 'it' : 'them'} first — deleting a tag also removes it from the events using it.`,
  }, { status: 409 })
  if (tagCount > 0) return refuse(tagCount)
  try {
    await prisma.tagGroup.delete({ where: { id } })
  } catch (e) {
    // A tag added between the count and the delete trips the same key.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') return refuse(1)
    throw e
  }
  deleteCached('tags:groups')
  writeAudit(session.id, session.name, 'tag_group.delete', id, 'tag_group',
    { name: snapshot.name, emoji: snapshot.emoji, tagCount },
    `Deleted tag group ${snapshot.emoji} "${snapshot.name}"`,
  )
  return NextResponse.json({ ok: true })
}
