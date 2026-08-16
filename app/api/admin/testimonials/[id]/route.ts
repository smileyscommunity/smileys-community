import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { ALLOWED_CATEGORIES } from '../constants'
import { INVALID, resolveCityIdInput } from '../cityInput'

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
  if ('photo' in body) {
    const cleanPhoto = body.photo ? String(body.photo).trim().slice(0, 500) : null
    // Match POST validation — no external photo URLs (would leak visitor
    // IPs / referers on the public Why Smileys page).
    if (cleanPhoto && !/^\/app\/api\/files\/[a-zA-Z0-9\-_/]+\.(jpg|jpeg|png|webp|gif)$/i.test(cleanPhoto)) {
      return NextResponse.json({ error: 'Photo must be uploaded via the form — external URLs are not allowed' }, { status: 400 })
    }
    data.photo = cleanPhoto
  }
  if ('active'     in body) data.active     = !!body.active
  if ('order'      in body) data.order      = Math.max(0, Math.min(9999, Number(body.order) || 0))
  if ('category'   in body) {
    const cat = String(body.category)
    data.category = ALLOWED_CATEGORIES.includes(cat) ? cat : 'general'
  }

  if ('cityId' in body) {
    const cleanCityId = await resolveCityIdInput(body.cityId)
    if (cleanCityId === INVALID) {
      return NextResponse.json({ error: 'Unknown city' }, { status: 400 })
    }
    data.cityId = cleanCityId
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const item = await prisma.testimonial.update({
    where: { id }, data,
    include: { city: { select: { id: true, name: true } } },
  })
  return NextResponse.json(item)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const snapshot = await prisma.testimonial.findUnique({ where: { id },
    select: { memberName: true, role: true, quote: true, category: true, active: true } })
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await prisma.testimonial.delete({ where: { id } })
  writeAudit(session.id, session.name, 'testimonial.delete', id, 'testimonial',
    { memberName: snapshot.memberName, role: snapshot.role, category: snapshot.category, active: snapshot.active, quotePreview: snapshot.quote.slice(0, 100) },
    `Deleted testimonial from "${snapshot.memberName}" (${snapshot.category})`,
  )
  return NextResponse.json({ ok: true })
}
