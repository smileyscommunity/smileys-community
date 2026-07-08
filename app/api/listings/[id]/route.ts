import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { redactListingForGuest } from '@/lib/listingsPublic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Public read — paired with the public /listings browse page so Google can
  // crawl individual listings. Guests see a teaser (no contact, photo, full
  // description, or poster identity); members get the full record.
  const { id } = await params
  const [listing, session] = await Promise.all([
    prisma.listing.findUnique({
      where: { id, status: 'active' },
      include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
    }),
    getSession(),
  ])
  if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(session ? listing : redactListingForGuest(listing))
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const listing = await prisma.listing.findUnique({ where: { id } })
  if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (listing.userId !== session.id && !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // A deleted listing is terminal for the owner. Self-delete and moderator
  // removal both set status:'deleted', so without this guard an owner could
  // PATCH {status:'active'} or {renew:true} to resurrect a listing a mod
  // took down. Only admins can act on a deleted listing (e.g. to restore it).
  if (listing.status === 'deleted' && !isAdmin(session)) {
    return NextResponse.json({ error: 'This listing was removed and can no longer be changed' }, { status: 403 })
  }

  const { status, renew } = await req.json()

  if (renew) {
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30)
    const updated = await prisma.listing.update({ where: { id }, data: { expiresAt, status: 'active' } })
    return NextResponse.json(updated)
  }

  const ALLOWED = listing.userId === session.id ? ['filled', 'active'] : ['filled', 'active', 'deleted']
  if (!status || !ALLOWED.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const updated = await prisma.listing.update({ where: { id }, data: { status } })
  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const listing = await prisma.listing.findUnique({ where: { id } })
  if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (listing.userId !== session.id && !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.listing.update({ where: { id }, data: { status: 'deleted' } })
  return NextResponse.json({ ok: true })
}
