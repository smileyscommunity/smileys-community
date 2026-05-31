import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

// GET   /api/admin/campaigns   — list campaigns + sponsor/prize/donation counts
// POST  /api/admin/campaigns   — create
// PATCH /api/admin/campaigns   — update by id
// DELETE /api/admin/campaigns  — by id (cascades to sponsors/prizes/donations)
//
// Auth: admin OR moderator.

export const dynamic = 'force-dynamic'

const SLUG_RE = /^[a-z0-9-]+$/

function parsePayload(body: Record<string, unknown>) {
  return {
    slug:        typeof body.slug === 'string' ? body.slug.trim().toLowerCase().slice(0, 80) : null,
    name:        typeof body.name === 'string' ? body.name.trim().slice(0, 200) : null,
    emoji:       typeof body.emoji === 'string' ? body.emoji.trim().slice(0, 10) : null,
    tagline:     typeof body.tagline === 'string' ? body.tagline.trim().slice(0, 200) : null,
    description: typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : null,
    coverImage:  typeof body.coverImage === 'string' ? body.coverImage.trim().slice(0, 500) : null,
    status:      typeof body.status === 'string' && ['draft', 'active', 'wrapped', 'archived'].includes(body.status) ? body.status : null,
    routeSlug:   typeof body.routeSlug === 'string' ? body.routeSlug.trim().slice(0, 80) : null,
    startsAt:    typeof body.startsAt === 'string' && body.startsAt ? new Date(body.startsAt) : (body.startsAt === null ? null : undefined),
    endsAt:      typeof body.endsAt === 'string' && body.endsAt ? new Date(body.endsAt) : (body.endsAt === null ? null : undefined),
  }
}

export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Prisma's `_count` select doesn't accept a where filter per
  // relation. To surface "X donations (Y pending)" on each card
  // we run a parallel groupBy on pending donations and merge by
  // campaignId — one extra round-trip, indexed lookup.
  const [campaigns, pendingByCamp] = await Promise.all([
    prisma.campaign.findMany({
      orderBy: [{ status: 'asc' }, { startsAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, slug: true, name: true, emoji: true, tagline: true, description: true,
        coverImage: true, status: true, routeSlug: true, hasFixtures: true,
        startsAt: true, endsAt: true, createdAt: true, updatedAt: true,
        _count: { select: { sponsors: true, prizes: true, donations: true } },
      },
    }),
    prisma.cupPrizeDonation.groupBy({
      by: ['campaignId'],
      where:  { status: 'pending' },
      _count: { _all: true },
    }),
  ])
  const pendingMap = new Map<string | null, number>(
    pendingByCamp.map(p => [p.campaignId, p._count._all]),
  )
  const enriched = campaigns.map(c => ({
    ...c,
    _count: { ...c._count, pendingDonations: pendingMap.get(c.id) ?? 0 },
  }))
  return NextResponse.json({ campaigns: enriched })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const p = parsePayload(body)
  if (!p.name)                                     return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!p.slug || !SLUG_RE.test(p.slug))             return NextResponse.json({ error: 'slug must be lowercase letters, digits, hyphens' }, { status: 400 })

  try {
    const campaign = await prisma.campaign.create({
      data: {
        slug: p.slug, name: p.name,
        emoji: p.emoji, tagline: p.tagline, description: p.description, coverImage: p.coverImage,
        status: p.status ?? 'draft',
        routeSlug: p.routeSlug || p.slug,
        startsAt: p.startsAt instanceof Date ? p.startsAt : null,
        endsAt:   p.endsAt   instanceof Date ? p.endsAt   : null,
      },
    })
    writeAudit(session.id, session.name, 'campaign.create', campaign.id, 'campaign',
      { slug: campaign.slug, name: campaign.name, status: campaign.status },
      `Created campaign "${campaign.name}"`,
    )
    return NextResponse.json({ campaign })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') return NextResponse.json({ error: 'Slug already in use — pick another' }, { status: 409 })
    throw e
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const before = await prisma.campaign.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const p = parsePayload(body)
  if (p.slug && !SLUG_RE.test(p.slug)) return NextResponse.json({ error: 'slug must be lowercase letters, digits, hyphens' }, { status: 400 })

  const data: Record<string, unknown> = {}
  if (p.name)                                                  data.name        = p.name
  if (p.slug)                                                  data.slug        = p.slug
  if (p.emoji !== null && p.emoji !== undefined)               data.emoji       = p.emoji
  if (p.tagline !== null && p.tagline !== undefined)           data.tagline     = p.tagline
  if (p.description !== null && p.description !== undefined)   data.description = p.description
  if (p.coverImage !== null && p.coverImage !== undefined)     data.coverImage  = p.coverImage
  if (p.status)                                                data.status      = p.status
  if (p.routeSlug)                                             data.routeSlug   = p.routeSlug
  if (p.startsAt !== undefined)                                data.startsAt    = p.startsAt
  if (p.endsAt   !== undefined)                                data.endsAt      = p.endsAt

  try {
    const campaign = await prisma.campaign.update({ where: { id }, data })
    writeAudit(session.id, session.name, 'campaign.update', id, 'campaign',
      { name: campaign.name, changed: Object.keys(data) },
      `Updated campaign "${campaign.name}"`,
    )
    return NextResponse.json({ campaign })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') return NextResponse.json({ error: 'Slug already in use' }, { status: 409 })
    throw e
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const campaign = await prisma.campaign.findUnique({ where: { id }, select: { name: true, slug: true } })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Refuse to delete the world-cup-2026 campaign — it carries the
  // live cup data. Archive instead via PATCH.
  if (campaign.slug === 'world-cup-2026') {
    return NextResponse.json({ error: 'Cannot delete the live cup campaign — set status=archived instead' }, { status: 400 })
  }

  await prisma.campaign.delete({ where: { id } })
  writeAudit(session.id, session.name, 'campaign.delete', id, 'campaign',
    { name: campaign.name },
    `Deleted campaign "${campaign.name}"`,
  )
  return NextResponse.json({ ok: true })
}
