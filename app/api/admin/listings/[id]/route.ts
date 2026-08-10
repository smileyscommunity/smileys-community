import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { normalizeContactEmail } from '@/lib/contactEmail'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const listing = await prisma.listing.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, email: true, color: true, profilePhoto: true } } },
  })
  if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(listing)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const listing = await prisma.listing.findUnique({ where: { id } })
  if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.listing.update({ where: { id }, data: { status: 'deleted' } })

  // Soft-delete still warrants an audit row — listings are member-
  // created content and a moderation dispute would otherwise have
  // no record of who flagged + removed which post.
  writeAudit(session.id, session.name, 'listing.delete', id, 'listing',
    { title: listing.title, userId: listing.userId, previousStatus: listing.status, category: listing.category },
    `Soft-deleted listing "${listing.title}" by ${listing.userId}`,
  )

  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const data: Record<string, unknown> = {}

  if ('status' in body) {
    const ALLOWED = ['active', 'deleted', 'expired', 'filled']
    if (!ALLOWED.includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    data.status = body.status

    // Reactivating a listing whose expiresAt is already in the past is a
    // no-op in disguise: the hourly cron (auto-expire sweep in
    // /api/admin/cron/reminders) immediately flips it back to 'expired'
    // since expiresAt never moved. Mirror the member-facing renew flow
    // (30 more days) whenever admin activates a past-due listing.
    if (body.status === 'active') {
      const current = await prisma.listing.findUnique({ where: { id }, select: { expiresAt: true } })
      if (current && current.expiresAt < new Date()) {
        data.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    }
  }
  if ('title' in body && typeof body.title === 'string' && body.title.trim()) {
    data.title = body.title.trim().slice(0, 120)
  }
  if ('description' in body && typeof body.description === 'string' && body.description.trim()) {
    data.description = body.description.trim().slice(0, 2000)
  }
  if ('price' in body) {
    data.price = body.price ? String(body.price).slice(0, 50) : null
  }
  if ('contact' in body) {
    data.contact = body.contact ? String(body.contact).slice(0, 200) : null
  }
  if ('contactEmail' in body) {
    data.contactEmail = normalizeContactEmail(body.contactEmail)
  }
  if ('neighborhood' in body) {
    data.neighborhood = body.neighborhood ? String(body.neighborhood).slice(0, 100) : null
  }
  if ('category' in body && typeof body.category === 'string' && body.category.trim()) {
    const VALID = ['ROOMS','JOBS','SERVICES','BUY_SELL','FREE','LOST_FOUND','RECO','EXPERIENCES','PETS']
    if (!VALID.includes(body.category)) return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    data.category = body.category
  }
  if ('photo' in body) {
    data.photo = body.photo ? String(body.photo).slice(0, 500) : null
  }
  if ('photoPosition' in body && typeof body.photoPosition === 'number') {
    data.photoPosition = Math.min(100, Math.max(0, Math.round(body.photoPosition)))
  }

  const updated = await prisma.listing.update({ where: { id }, data })
  return NextResponse.json(updated)
}
