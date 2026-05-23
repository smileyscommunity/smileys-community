import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManageTags } from '@/lib/access'

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
  await prisma.tagGroup.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
