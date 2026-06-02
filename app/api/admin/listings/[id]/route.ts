import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

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
    const ALLOWED = ['active', 'deleted', 'expired']
    if (!ALLOWED.includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    data.status = body.status
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

  const updated = await prisma.listing.update({ where: { id }, data })
  return NextResponse.json(updated)
}
