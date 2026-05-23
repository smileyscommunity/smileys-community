import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const items = await prisma.testimonial.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'desc' }] })
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { memberName, role, quote, category, photo } = await req.json()
  if (!memberName?.trim() || !quote?.trim()) {
    return NextResponse.json({ error: 'Name and quote required' }, { status: 400 })
  }
  if (memberName.trim().length > 200) return NextResponse.json({ error: 'Name too long' }, { status: 400 })
  if (quote.trim().length > 3000)     return NextResponse.json({ error: 'Quote too long (max 3000 chars)' }, { status: 400 })
  if (role?.trim().length > 200)      return NextResponse.json({ error: 'Role too long' }, { status: 400 })

  const ALLOWED_CATEGORIES = ['general', 'friends', 'expat', 'business', 'travel']
  const cleanCategory = ALLOWED_CATEGORIES.includes(category) ? category : 'general'

  const maxOrder = await prisma.testimonial.aggregate({ _max: { order: true } })
  const item = await prisma.testimonial.create({
    data: {
      memberName: memberName.trim(),
      role:       role?.trim() || null,
      quote:      quote.trim(),
      category:   cleanCategory,
      photo:      photo ? String(photo).trim().slice(0, 500) : null,
      order:      (maxOrder._max.order ?? 0) + 1,
    },
  })
  return NextResponse.json(item)
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { ids } = await req.json() // reorder: array of ids in new order
  if (!Array.isArray(ids)) return NextResponse.json({ error: 'ids required' }, { status: 400 })
  await Promise.all(ids.map((id: string, i: number) =>
    prisma.testimonial.update({ where: { id }, data: { order: i } })
  ))
  return NextResponse.json({ ok: true })
}
