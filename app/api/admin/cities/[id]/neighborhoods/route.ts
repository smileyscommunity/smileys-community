import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator, canActInCity } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { neighborhoodToSlug } from '@/lib/neighborhoods'
import { invalidateNeighborhoodCache } from '@/lib/neighborhoodsDb'
import { DEFAULT_CITY_SLUG } from '@/lib/city'

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

  // Existing ACTIVE rows are skipped, not errors — re-pasting a list after
  // adding two more names should add exactly the two. A soft-deleted row
  // whose name comes back is RE-ACTIVATED: delete "Foo", paste "Foo" again
  // used to report "already present" while the picker stayed Foo-less, with
  // no way back short of psql.
  const existing = await prisma.neighborhood.findMany({
    where:  { cityId },
    select: { id: true, slug: true, name: true, sortOrder: true, active: true },
  })
  const bySlug = new Map(existing.map(n => [n.slug, n]))
  let nextOrder = existing.reduce((m, n) => Math.max(m, n.sortOrder), 0) + 1

  const toCreate:     string[] = []
  const toReactivate: { id: string; name: string }[] = []
  for (const n of names) {
    const hit = bySlug.get(neighborhoodToSlug(n))
    if (!hit) toCreate.push(n)
    else if (hit.active === false) toReactivate.push({ id: hit.id, name: hit.name })
  }

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
  }
  if (toReactivate.length > 0) {
    await prisma.neighborhood.updateMany({
      where: { id: { in: toReactivate.map(r => r.id) }, cityId },
      data:  { active: true },
    })
  }
  if (toCreate.length > 0 || toReactivate.length > 0) {
    await writeAudit(session.id, session.name, 'city.neighborhoods_add', cityId, 'city',
      { city: city.name, added: toCreate.length, reactivated: toReactivate.length, names: [...toCreate, ...toReactivate.map(r => r.name)].slice(0, 30) },
      `Added ${toCreate.length} + reactivated ${toReactivate.length} neighborhood(s) in ${city.name}`,
    )
  }

  // `total` is what the readiness meter writes into the panel — it must be
  // the ACTIVE count (what the go-live gate checks), not all rows; counting
  // soft-deleted rows made the meter show ✓ for a city the gate would refuse.
  const activeTotal = await prisma.neighborhood.count({ where: { cityId, active: true } })
  return NextResponse.json({
    ok: true,
    added: toCreate.length,
    reactivated: toReactivate.length,
    skipped: names.length - toCreate.length - toReactivate.length,
    total: activeTotal,
  }, { status: 201 })
}

// GET — the city's current neighborhood rows, for the panel's list.
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id: cityId } = await params
  // Same gate as POST/DELETE — this was the only verb without it, letting a
  // moderator read another city's rows including soft-deleted ones.
  if (!canActInCity(session, cityId)) {
    return NextResponse.json({ error: 'Cross-city management is admin-only' }, { status: 403 })
  }
  const neighborhoods = await prisma.neighborhood.findMany({
    where:   { cityId },
    orderBy: { sortOrder: 'asc' },
    select:  { id: true, name: true, slug: true, emoji: true, active: true },
  })
  return NextResponse.json(neighborhoods)
}

// PATCH /api/admin/cities/[id]/neighborhoods — edit ONE row's attributes:
// the enrichment the POST comment promised "can come later" (emoji, vibe,
// area grouping, cost tier, coordinates), plus the active flag. Provided
// fields are validated and updated; omitted fields are never touched, and
// the nullable ones (vibe/area/lat/lng) clear only on an explicit null/''.
//
// The DEFAULT city is refused outright: its editorial layer
// (NEIGHBORHOOD_META in lib/neighborhoods.ts) overrides DB values at render
// time, so an edit here would save cleanly and change nothing anyone can
// see — the worst kind of admin button.
const PATCH_KEYS = new Set(['neighborhoodId', 'slug', 'emoji', 'vibe', 'area', 'cost', 'lat', 'lng', 'active'])

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id: cityId } = await params
  if (!canActInCity(session, cityId)) {
    return NextResponse.json({ error: 'Cross-city neighborhood management is admin-only' }, { status: 403 })
  }
  const city = await prisma.city.findUnique({ where: { id: cityId }, select: { id: true, name: true, slug: true } })
  if (!city) return NextResponse.json({ error: 'City not found' }, { status: 404 })
  if (city.slug === DEFAULT_CITY_SLUG) {
    return NextResponse.json({ error: 'The default city’s attributes are authored in code (NEIGHBORHOOD_META) — a DB edit would not render' }, { status: 400 })
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Expected a JSON object' }, { status: 400 })
  }
  const unknown = Object.keys(body).filter(k => !PATCH_KEYS.has(k))
  if (unknown.length > 0) {
    return NextResponse.json({ error: `Unknown field(s): ${unknown.join(', ')}` }, { status: 400 })
  }

  const neighborhoodId = typeof body.neighborhoodId === 'string' ? body.neighborhoodId : null
  const slugKey        = typeof body.slug === 'string' ? body.slug : null
  if (!neighborhoodId && !slugKey) {
    return NextResponse.json({ error: 'neighborhoodId or slug required' }, { status: 400 })
  }
  // cityId in the where, same as DELETE — a guessed id can't touch another
  // city's row.
  const row = await prisma.neighborhood.findFirst({
    where: neighborhoodId ? { id: neighborhoodId, cityId } : { slug: slugKey!, cityId },
  })
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const data: { emoji?: string; vibe?: string | null; area?: string | null; cost?: number; lat?: number | null; lng?: number | null; active?: boolean } = {}

  if ('emoji' in body) {
    const v = typeof body.emoji === 'string' ? body.emoji.trim() : ''
    if (!v || v.length > 16) return NextResponse.json({ error: 'emoji must be a short non-empty string' }, { status: 400 })
    data.emoji = v
  }
  for (const [key, max] of [['vibe', 200], ['area', 60]] as const) {
    if (!(key in body)) continue
    const v = body[key]
    if (v === null || (typeof v === 'string' && !v.trim())) data[key] = null
    else if (typeof v === 'string' && v.trim().length <= max) data[key] = v.trim()
    else return NextResponse.json({ error: `${key} must be text of at most ${max} characters` }, { status: 400 })
  }
  if ('cost' in body) {
    if (typeof body.cost !== 'number' || !Number.isFinite(body.cost)) {
      return NextResponse.json({ error: 'cost must be a number' }, { status: 400 })
    }
    data.cost = Math.min(3, Math.max(1, Math.round(body.cost)))
  }
  for (const [key, limit] of [['lat', 90], ['lng', 180]] as const) {
    if (!(key in body)) continue
    const v = body[key]
    if (v === null) data[key] = null
    else if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit) data[key] = v
    else return NextResponse.json({ error: `${key} must be a finite number within ±${limit}` }, { status: 400 })
  }
  if ('active' in body) {
    if (typeof body.active !== 'boolean') return NextResponse.json({ error: 'active must be true or false' }, { status: 400 })
    data.active = body.active
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const updated = await prisma.neighborhood.update({
    where:  { id: row.id },
    data,
    select: { id: true, name: true, slug: true, emoji: true, vibe: true, area: true, cost: true, lat: true, lng: true, active: true },
  })
  invalidateNeighborhoodCache(cityId)

  // Diff only the fields this PATCH touched — full-row getDiff would drown
  // the audit entry in updatedAt noise.
  const diff: Record<string, { from: unknown; to: unknown }> = {}
  for (const k of Object.keys(data) as (keyof typeof data)[]) {
    if (row[k] !== updated[k]) diff[k] = { from: row[k], to: updated[k] }
  }
  await writeAudit(session.id, session.name, 'city.neighborhood_update', row.id, 'neighborhood',
    { city: city.name, neighborhood: row.name, fields: Object.keys(data), diff },
    `Updated ${Object.keys(data).join(', ')} on ${row.name} (${city.name})`,
  )

  const res: Record<string, unknown> = { ok: true, neighborhood: updated }
  if ('active' in data) {
    // Same honesty rule as POST's `total`: whenever this verb can change the
    // active count, report the count the go-live gate would actually check.
    res.total = await prisma.neighborhood.count({ where: { cityId, active: true } })
  }
  return NextResponse.json(res)
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
