import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator, canActInCity } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { neighborhoodToSlug } from '@/lib/neighborhoods'

type Params = { params: Promise<{ id: string }> }

// POST /api/admin/cities/[id]/neighborhoods — bulk-add a city's neighborhoods
// from the admin panel. This was the LAST launch step that needed a developer:
// clubs seed from a button, hosts assign from a field, but neighborhoods (the
// go-live gate's hard blocker) required a hand-written seed script run on the
// server. An admin pasting names makes a city launch fully self-serve.
//
// Names are the only required input — the pickers and the go-live gate need
// nothing else, and emoji/vibe/coords are enrichment that can come later (or
// via a seed script for the cities that want the full treatment). Slug is
// derived with the same neighborhoodToSlug every seed script uses, so slugs
// stay consistent regardless of which path created the row.
const MAX_BATCH = 100

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id: cityId } = await params
  // Same cross-city rule as hosts/launch-clubs: admins anywhere, a moderator
  // only their own city.
  if (!canActInCity(session, cityId)) {
    return NextResponse.json({ error: 'Cross-city neighborhood management is admin-only' }, { status: 403 })
  }
  const city = await prisma.city.findUnique({ where: { id: cityId }, select: { id: true, name: true } })
  if (!city) return NextResponse.json({ error: 'City not found' }, { status: 404 })

  const body = await req.json().catch(() => null) as { names?: unknown } | null
  if (!body || !Array.isArray(body.names)) {
    return NextResponse.json({ error: 'Expected { names: string[] }' }, { status: 400 })
  }

  // Normalize: trim, drop empties, cap length, dedupe within the batch by
  // slug (the DB's per-city uniqueness) so "Kadıköy" and "kadikoy " don't
  // race each other into a constraint violation.
  const seen = new Set<string>()
  const names: string[] = []
  for (const raw of body.names) {
    if (typeof raw !== 'string') continue
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, 60)
    if (!name) continue
    const slug = neighborhoodToSlug(name)
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    names.push(name)
  }
  if (names.length === 0) return NextResponse.json({ error: 'No valid names' }, { status: 400 })
  if (names.length > MAX_BATCH) {
    return NextResponse.json({ error: `Too many at once (max ${MAX_BATCH})` }, { status: 400 })
  }

  // Existing rows (by slug OR name) are skipped, not errors — re-pasting a
  // list after adding two more names should add exactly the two.
  const existing = await prisma.neighborhood.findMany({
    where:  { cityId },
    select: { slug: true, name: true, sortOrder: true },
  })
  const existingSlugs = new Set(existing.map(n => n.slug))
  let nextOrder = existing.reduce((m, n) => Math.max(m, n.sortOrder), 0) + 1

  const toCreate = names.filter(n => !existingSlugs.has(neighborhoodToSlug(n)))
  if (toCreate.length > 0) {
    await prisma.neighborhood.createMany({
      data: toCreate.map(name => ({
        cityId,
        name,
        slug: neighborhoodToSlug(name),
        sortOrder: nextOrder++,
      })),
      skipDuplicates: true,
    })
    await writeAudit(session.id, session.name, 'city.neighborhoods_add', cityId, 'city',
      { city: city.name, added: toCreate.length, names: toCreate.slice(0, 30) },
      `Added ${toCreate.length} neighborhood${toCreate.length === 1 ? '' : 's'} to ${city.name}`,
    )
  }

  return NextResponse.json({
    ok: true,
    added: toCreate.length,
    skipped: names.length - toCreate.length,
    total: existing.length + toCreate.length,
  }, { status: 201 })
}

// GET — the city's current neighborhood rows, for the panel's list.
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id: cityId } = await params
  const neighborhoods = await prisma.neighborhood.findMany({
    where:   { cityId },
    orderBy: { sortOrder: 'asc' },
    select:  { id: true, name: true, slug: true, emoji: true, active: true },
  })
  return NextResponse.json(neighborhoods)
}

// DELETE /api/admin/cities/[id]/neighborhoods?neighborhoodId=... — soft-hide
// one (typo'd paste, renamed area). Soft on purpose: content already tagged
// with the name stays readable; the row just leaves the pickers.
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id: cityId } = await params
  if (!canActInCity(session, cityId)) {
    return NextResponse.json({ error: 'Cross-city neighborhood management is admin-only' }, { status: 403 })
  }
  const neighborhoodId = req.nextUrl.searchParams.get('neighborhoodId')
  if (!neighborhoodId) return NextResponse.json({ error: 'neighborhoodId required' }, { status: 400 })

  // Guard the city in the where so a guessed id can't touch another city's row.
  const updated = await prisma.neighborhood.updateMany({
    where: { id: neighborhoodId, cityId },
    data:  { active: false },
  })
  if (updated.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
