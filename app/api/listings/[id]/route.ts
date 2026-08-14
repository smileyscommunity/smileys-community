import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { redactListingForGuest } from '@/lib/listingsPublic'
import { safeNeighborhoodFor } from '@/lib/neighborhoodsDb'

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

  const body = await req.json()
  const { status, renew, title, description, price, neighborhood, contact, contactEmail } = body

  if (renew) {
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30)
    const updated = await prisma.listing.update({ where: { id }, data: { expiresAt, status: 'active' } })
    return NextResponse.json(updated)
  }

  // Edit — there was previously no way to fix a typo or add contact info
  // after posting; owner (or admin) can update the same fields the create
  // form captures, minus category/photo, using the same validation as POST.
  const EDIT_KEYS = ['title', 'description', 'price', 'neighborhood', 'contact', 'contactEmail']
  if (EDIT_KEYS.some(k => k in body)) {
    const data: Record<string, unknown> = {}

    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim() || title.length > 120) {
        return NextResponse.json({ error: 'Title is required and must be under 120 characters' }, { status: 400 })
      }
      data.title = title.trim()
    }
    if (description !== undefined) {
      if (typeof description !== 'string' || !description.trim() || description.length > 2000) {
        return NextResponse.json({ error: 'Description is required and must be under 2000 characters' }, { status: 400 })
      }
      data.description = description.trim()
    }
    if (price !== undefined) {
      data.price = typeof price === 'string' && price.trim() ? price.trim() : null
    }
    if (neighborhood !== undefined) {
      data.neighborhood = await safeNeighborhoodFor(listing.cityId, neighborhood)
    }
    if (contact !== undefined) {
      data.contact = typeof contact === 'string' && contact.trim() && contact.length <= 200 ? contact.trim() : null
    }
    if (contactEmail !== undefined) {
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      data.contactEmail = typeof contactEmail === 'string' && contactEmail.trim().length <= 200 && EMAIL_RE.test(contactEmail.trim())
        ? contactEmail.trim().toLowerCase() : null
    }

    const updated = await prisma.listing.update({ where: { id }, data })
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
