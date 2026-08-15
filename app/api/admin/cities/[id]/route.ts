import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { CITY_STATUS, CITY_STATUS_VALUES, isCityStatus } from '@/lib/cityStatus'

// PATCH /api/admin/cities/[id] — edit a city's shopfront and, crucially, its
// status. Flipping status to `live` is what publishes a city across the whole
// public site (homepage card, /<slug> page, nav, apply form) — there is no
// second switch to remember and no deploy involved.
//
// Admin-only, same reasoning as city creation: a moderator is scoped to a city
// and has nothing to scope a platform-level change against.

interface Params { params: Promise<{ id: string }> }

// A hero is public, so it must not point into `applications/` — that folder is
// admin-only at the file route (raw photos of pending and rejected applicants),
// so such a hero would 403 for every visitor, and it has no business being a
// marketing image in the first place. The uploader writes to `general/`.
// general/ only — the hero uploader writes there. A broader allowlist let an
// admin point a city hero at a member's PROFILE photo (users/…): access-safe
// (admins read those anyway) but a consent footgun as public marketing.
const PHOTO_RE = /^\/app\/api\/files\/general\/[a-zA-Z0-9-]+\.(jpg|jpeg|png|webp|gif)$/

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const city = await prisma.city.findUnique({
    where:  { id },
    select: { id: true, name: true, slug: true, status: true },
  })
  if (!city) return NextResponse.json({ error: 'City not found' }, { status: 404 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const data: {
    status?: string; tagline?: string | null
    description?: string | null; heroImage?: string | null
  } = {}

  if ('status' in body) {
    if (!isCityStatus(body.status)) {
      return NextResponse.json(
        { error: `Status must be one of: ${CITY_STATUS_VALUES.join(', ')}` },
        { status: 400 },
      )
    }
    // Going live with no clubs and no hosts produces exactly the empty-city
    // shopfront the whole design is meant to avoid, so it's blocked here rather
    // than discovered by a visitor.
    if (body.status === CITY_STATUS.Live && city.status !== CITY_STATUS.Live) {
      const [clubs, hosts] = await Promise.all([
        prisma.club.count({ where: { cityId: id, isActive: true } }),
        prisma.cityHost.count({ where: { cityId: id, revokedAt: null } }),
      ])
      if (clubs === 0 || hosts === 0) {
        return NextResponse.json({
          error: `${city.name} isn't ready to go live yet — it has ${clubs} active club${clubs === 1 ? '' : 's'} and ${hosts} host${hosts === 1 ? '' : 's'}. Seed starter clubs and assign at least one host first, or set it to Preparing.`,
        }, { status: 400 })
      }
    }
    data.status = body.status
  }

  // Empty string clears the field — an admin removing a tagline shouldn't have
  // to send null explicitly from a form input.
  for (const field of ['tagline', 'description'] as const) {
    if (field in body) {
      const v = body[field]
      if (v === null || v === '') { data[field] = null; continue }
      if (typeof v !== 'string') {
        return NextResponse.json({ error: `${field} must be text` }, { status: 400 })
      }
      data[field] = v.trim().slice(0, field === 'tagline' ? 160 : 1000)
    }
  }

  if ('heroImage' in body) {
    const v = body.heroImage
    if (v === null || v === '') {
      data.heroImage = null
    } else if (typeof v === 'string' && PHOTO_RE.test(v)) {
      data.heroImage = v
    } else {
      return NextResponse.json({ error: 'Invalid hero image URL' }, { status: 400 })
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const updated = await prisma.city.update({ where: { id }, data })

  await writeAudit(
    session.id, session.name,
    data.status && data.status !== city.status ? 'city.status_change' : 'city.update',
    city.id, 'city',
    {
      name: city.name,
      ...(data.status && data.status !== city.status ? { from: city.status, to: data.status } : {}),
      fields: Object.keys(data),
    },
  )

  return NextResponse.json({
    ok: true,
    city: {
      id: updated.id, name: updated.name, slug: updated.slug, status: updated.status,
      tagline: updated.tagline, description: updated.description, heroImage: updated.heroImage,
    },
  })
}
