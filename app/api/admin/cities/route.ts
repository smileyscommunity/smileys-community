import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { slugify } from '@/lib/slug'

// GET /api/admin/cities — list every city with its club count + hosts, so the
// admin Cities page can show launch status at a glance.
export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const cities = await prisma.city.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      _count: { select: { clubs: true } },
      cityHosts: {
        where: { revokedAt: null },
        select: { id: true, user: { select: { id: true, name: true, email: true } } },
      },
    },
  })

  return NextResponse.json(cities.map(c => ({
    id: c.id, name: c.name, slug: c.slug, country: c.country, timezone: c.timezone,
    currency: c.currency, defaultLang: c.defaultLang, status: c.status,
    clubCount: c._count.clubs,
    hosts: c.cityHosts.map(h => ({ cityHostId: h.id, id: h.user.id, name: h.user.name, email: h.user.email })),
  })))
}

// POST /api/admin/cities — create a new city (in "launching" status). Clubs are
// seeded separately via /[id]/launch-clubs once the city exists.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const name     = typeof body.name === 'string' ? body.name.trim() : ''
  const country  = typeof body.country === 'string' ? body.country.trim() : ''
  const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : ''
  const currency = typeof body.currency === 'string' && body.currency.trim() ? body.currency.trim().toUpperCase() : 'EUR'
  const defaultLang = typeof body.defaultLang === 'string' && body.defaultLang.trim() ? body.defaultLang.trim() : 'en'

  if (!name)     return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!country)  return NextResponse.json({ error: 'Country is required' }, { status: 400 })
  if (!timezone) return NextResponse.json({ error: 'Timezone is required (e.g. Europe/Lisbon)' }, { status: 400 })

  const slug = slugify(name)
  if (!slug) return NextResponse.json({ error: 'Name must contain letters or numbers' }, { status: 400 })

  const existing = await prisma.city.findUnique({ where: { slug }, select: { id: true } })
  if (existing) return NextResponse.json({ error: `A city with slug "${slug}" already exists` }, { status: 409 })

  const city = await prisma.city.create({
    data: { name, slug, country, timezone, currency, defaultLang, status: 'launching' },
    select: { id: true, name: true, slug: true },
  })

  return NextResponse.json(city, { status: 201 })
}
