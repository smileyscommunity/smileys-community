import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { ALLOWED_CATEGORIES } from '../constants'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json()

  // Whitelist and validate only allowed fields
  const data: Record<string, unknown> = {}
  if ('memberName' in body) data.memberName = String(body.memberName ?? '').trim().slice(0, 200)
  if ('role'       in body) data.role       = body.role ? String(body.role).trim().slice(0, 200) : null
  if ('quote'      in body) data.quote      = String(body.quote ?? '').trim().slice(0, 3000)
  if ('photo'      in body) data.photo      = body.photo ? String(body.photo).trim().slice(0, 500) : null
  if ('active'     in body) data.active     = !!body.active
  if ('order'      in body) data.order      = Math.max(0, Math.min(9999, Number(body.order) || 0))
  if ('category'   in body) {
    const cat = String(body.category)
    data.category = ALLOWED_CATEGORIES.includes(cat) ? cat : 'general'
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const item = await prisma.testimonial.update({ where: { id }, data })
  return NextResponse.json(item)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  await prisma.testimonial.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
