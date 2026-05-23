import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManageTags } from '@/lib/access'

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
  await prisma.tag.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
