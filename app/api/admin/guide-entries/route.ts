import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManagePosts, canActInCity } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { validateGuideEntry, guideEntryPayload } from '@/lib/guideEntryInput'

// CRUD for guide experiences (Guide phase 2.3b). Until this existed, entries
// could only be written by a script on the server — so the Bodrum guide's
// content was blocked on a deploy, and the six seeded drafts had no way to be
// finished. Editorial content should never need an engineer.
//
// Authorization: canManagePosts (the same gate the Handbook and articles use —
// guide entries are editorial content of the same kind), AND canActInCity for
// the city being written to, so a city-scoped moderator can't publish into
// another city's guide.

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const citySlug = new URL(req.url).searchParams.get('city')?.trim()
  const city = citySlug
    ? await prisma.city.findUnique({ where: { slug: citySlug }, select: { id: true } })
    : null
  if (citySlug && !city) return NextResponse.json({ error: 'Unknown city' }, { status: 404 })
  if (city && !canActInCity(session, city.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [entries, cities] = await Promise.all([
    prisma.guideEntry.findMany({
      where:   { kind: 'experience', ...(city ? { cityId: city.id } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      include: { city: { select: { slug: true, name: true } } },
    }),
    // Only cities the editor may act in — the picker shouldn't offer a city
    // whose save would 403.
    prisma.city.findMany({
      orderBy: { name: 'asc' },
      select:  { id: true, slug: true, name: true, status: true },
    }),
  ])

  return NextResponse.json({
    entries,
    cities: cities.filter(c => canActInCity(session, c.id)),
  })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const city = body?.citySlug
    ? await prisma.city.findUnique({ where: { slug: String(body.citySlug) }, select: { id: true, slug: true } })
    : null
  if (!city) return NextResponse.json({ error: 'Pick a city' }, { status: 400 })
  if (!canActInCity(session, city.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const check = await validateGuideEntry(body, { cityId: city.id, citySlug: city.slug })
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })

  const clash = await prisma.guideEntry.findUnique({
    where:  { cityId_kind_slug: { cityId: city.id, kind: 'experience', slug: check.value.slug } },
    select: { id: true },
  })
  if (clash) return NextResponse.json({ error: 'That slug already exists in this city' }, { status: 409 })

  const created = await prisma.guideEntry.create({
    data: { cityId: city.id, kind: 'experience', ...guideEntryPayload(check.value) },
    select: { id: true, slug: true, status: true },
  })
  await writeAudit(session.id, session.name, 'guide_entry_create', created.id, 'guide_entry', {
    city: city.slug, slug: created.slug, status: created.status,
  })
  return NextResponse.json(created, { status: 201 })
}
