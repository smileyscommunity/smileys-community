import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator, isAdmin, canActInCity, failClosedCityId } from '@/lib/access'

import { ALLOWED_CATEGORIES } from './constants'
import { INVALID, resolveCityIdInput } from './cityInput'

export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const items = await prisma.testimonial.findMany({
    // Moderators: their own city's quotes plus the across-Smileys ones.
    where:   isAdmin(session) ? {} : { OR: [{ cityId: failClosedCityId(session) }, { cityId: null }] },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    include: { city: { select: { id: true, name: true } } },
  })
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { memberName, role, quote, category, photo, cityId } = await req.json()
  if (!memberName?.trim() || !quote?.trim()) {
    return NextResponse.json({ error: 'Name and quote required' }, { status: 400 })
  }
  if (memberName.trim().length > 200) return NextResponse.json({ error: 'Name too long' }, { status: 400 })
  if (quote.trim().length > 3000)     return NextResponse.json({ error: 'Quote too long (max 3000 chars)' }, { status: 400 })
  if (role?.trim().length > 200)      return NextResponse.json({ error: 'Role too long' }, { status: 400 })

  // Photo URL must be a local upload path. Without this, an admin could
  // set `photo: "https://attacker.com/pixel.gif"` and the public Why
  // Smileys page would render an <img src> that leaks every visitor's
  // IP + referer to the attacker on each page load. We accept the same
  // path shape /app/api/upload returns.
  const cleanPhoto = photo ? String(photo).trim().slice(0, 500) : null
  if (cleanPhoto && !/^\/app\/api\/files\/[a-zA-Z0-9\-_/]+\.(jpg|jpeg|png|webp|gif)$/i.test(cleanPhoto)) {
    return NextResponse.json({ error: 'Photo must be uploaded via the form — external URLs are not allowed' }, { status: 400 })
  }

  const cleanCategory = ALLOWED_CATEGORIES.includes(category) ? category : 'general'

  // A quote belongs to a city, or explicitly to none. An unknown id is
  // rejected rather than quietly coerced to null: silently turning "Izmir"
  // into "everywhere" is how these ended up unscoped in the first place.
  const cleanCityId = await resolveCityIdInput(cityId)
  if (cleanCityId !== INVALID && !canActInCity(session, cleanCityId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (cleanCityId === INVALID) {
    return NextResponse.json({ error: 'Unknown city' }, { status: 400 })
  }

  const maxOrder = await prisma.testimonial.aggregate({ _max: { order: true } })
  const item = await prisma.testimonial.create({
    data: {
      memberName: memberName.trim(),
      role:       role?.trim() || null,
      quote:      quote.trim(),
      category:   cleanCategory,
      photo:      cleanPhoto,
      cityId:     cleanCityId,
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
  // A moderator reorders only quotes they may touch — any other id in the
  // list refuses the whole request rather than silently skipping it.
  if (!isAdmin(session)) {
    const rows = await prisma.testimonial.findMany({ where: { id: { in: ids } }, select: { cityId: true } })
    if (rows.length !== ids.length || rows.some(r => !canActInCity(session, r.cityId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }
  await Promise.all(ids.map((id: string, i: number) =>
    prisma.testimonial.update({ where: { id }, data: { order: i } })
  ))
  return NextResponse.json({ ok: true })
}
