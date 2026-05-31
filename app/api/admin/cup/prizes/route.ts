import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

// GET   /api/admin/cup/prizes       — every prize incl. archived
// POST  /api/admin/cup/prizes       — create
// PATCH /api/admin/cup/prizes       — update by id (partial)
// DELETE /api/admin/cup/prizes      — by id
//
// Auth: admin OR moderator.

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const prizes = await prisma.cupPrize.findMany({
    orderBy: [{ status: 'asc' }, { rank: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true, title: true, description: true, imageUrl: true,
      rank: true, status: true, sponsorId: true,
      sponsor: { select: { id: true, name: true, logoUrl: true } },
      awardedTo: { select: { id: true, name: true } },
      awardedAt: true, createdAt: true, updatedAt: true,
    },
  })
  return NextResponse.json({ prizes })
}

function parsePayload(body: Record<string, unknown>) {
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : null
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : null
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim().slice(0, 500) : null
  const rank = body.rank === null ? null
    : typeof body.rank === 'number' && Number.isInteger(body.rank) && body.rank >= 1 && body.rank <= 3 ? body.rank
    : undefined
  const status = typeof body.status === 'string' && ['draft', 'active', 'awarded', 'archived'].includes(body.status) ? body.status : null
  const sponsorId = typeof body.sponsorId === 'string' && body.sponsorId.trim() ? body.sponsorId.trim() : (body.sponsorId === null ? null : undefined)
  const awardedToUserId = typeof body.awardedToUserId === 'string' && body.awardedToUserId.trim() ? body.awardedToUserId.trim() : (body.awardedToUserId === null ? null : undefined)
  return { title, description, imageUrl, rank, status, sponsorId, awardedToUserId }
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const p = parsePayload(body)
  if (!p.title) return NextResponse.json({ error: 'title required' }, { status: 400 })

  // Optional campaignId — when admin creates from the campaign-
  // detail Board panel, scoped to that campaign. Omitted from
  // legacy / global callers stays null; seed script backfills.
  const campaignId = typeof body.campaignId === 'string' && body.campaignId.trim() ? body.campaignId.trim() : null
  const prize = await prisma.cupPrize.create({
    data: {
      title:       p.title,
      description: p.description,
      imageUrl:    p.imageUrl,
      rank:        p.rank === undefined ? null : p.rank,
      status:      p.status ?? 'draft',
      sponsorId:   p.sponsorId === undefined ? null : p.sponsorId,
      campaignId,
    },
  })
  writeAudit(session.id, session.name, 'cup.prize_create', prize.id, 'cup_prize',
    { title: prize.title, status: prize.status, rank: prize.rank, sponsorId: prize.sponsorId },
    `Created prize "${prize.title}"`,
  )
  return NextResponse.json({ prize })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const before = await prisma.cupPrize.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const p = parsePayload(body)
  const data: Record<string, unknown> = {}
  if (p.title !== null)       data.title       = p.title
  if (p.description !== undefined) data.description = p.description
  if (p.imageUrl !== undefined)    data.imageUrl    = p.imageUrl
  if (p.rank !== undefined)        data.rank        = p.rank
  if (p.status !== null && p.status !== undefined) data.status = p.status
  if (p.sponsorId !== undefined)        data.sponsorId        = p.sponsorId
  if (p.awardedToUserId !== undefined) {
    data.awardedToUserId = p.awardedToUserId
    data.awardedAt       = p.awardedToUserId ? new Date() : null
  }

  const prize = await prisma.cupPrize.update({ where: { id }, data })

  writeAudit(session.id, session.name, 'cup.prize_update', id, 'cup_prize',
    { title: prize.title, changed: Object.keys(data) },
    `Updated prize "${prize.title}"`,
  )
  return NextResponse.json({ prize })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const prize = await prisma.cupPrize.findUnique({ where: { id }, select: { title: true } })
  if (!prize) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.cupPrize.delete({ where: { id } })
  writeAudit(session.id, session.name, 'cup.prize_delete', id, 'cup_prize',
    { title: prize.title },
    `Deleted prize "${prize.title}"`,
  )
  return NextResponse.json({ ok: true })
}
