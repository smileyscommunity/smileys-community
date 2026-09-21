import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, canActInCity } from '@/lib/access'
import { redactListingForGuest } from '@/lib/listingsPublic'
import { safeNeighborhoodFor } from '@/lib/neighborhoodsDb'
import { LIVE_BOARD_AUTHOR } from '@/lib/boardAccess'
import { isBlockedEitherWay } from '@/lib/memberPrivacy'
import { authorProjector } from '@/lib/authorProjection'
import { normalizeListingContact } from '@/lib/listingContact'
import { writeAudit } from '@/lib/audit'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Public read — paired with the public /listings browse page so Google can
  // crawl individual listings. Guests see a teaser (no contact, photo, full
  // description, or poster identity); members get the full record.
  const { id } = await params
  const [listing, session] = await Promise.all([
    prisma.listing.findUnique({
      // Live sellers only, the same rule the browse feed applies: a banned
      // or hidden member's listing kept serving their phone number.
      where: { id, status: 'active', expiresAt: { gte: new Date() }, user: LIVE_BOARD_AUTHOR },
      include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, profileVisibility: true } } },
    }),
    getSession(),
  ])
  if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // A blocked pair sees nothing of each other.
  if (session && listing.user && await isBlockedEitherWay(session.id, listing.user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!session) return NextResponse.json(redactListingForGuest(listing))
  // …and a connections-only seller is a first name here too.
  const show = await authorProjector(session, listing.user ? [listing.user] : [])
  return NextResponse.json({ ...listing, user: listing.user ? show(listing.user) : null })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const listing = await prisma.listing.findUnique({ where: { id } })
  if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Moderators get "Edit (staff)" on a listing (BoardHub) but this used to
  // allow only owner or admin, so every moderator save failed. They may edit
  // listings in their own city (canActInCity) — edit fields only; renew and
  // status stay owner/admin actions. A moderator elsewhere is told why.
  const isCityModerator = listing.userId !== session.id && !isAdmin(session) && canActInCity(session, listing.cityId)
  if (listing.userId !== session.id && !isAdmin(session) && !isCityModerator) {
    return NextResponse.json({ error: session.role === 'moderator' ? 'You can only edit listings in your own city' : 'Forbidden' }, { status: 403 })
  }

  // A deleted listing is terminal for the owner. Self-delete and moderator
  // removal both set status:'deleted', so without this guard an owner could
  // PATCH {status:'active'} or {renew:true} to resurrect a listing a mod
  // took down. Only admins can act on a deleted listing (e.g. to restore it).
  if (listing.status === 'deleted' && !isAdmin(session)) {
    return NextResponse.json({ error: 'This listing was removed and can no longer be changed' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { status, renew, title, description, price, neighborhood } = body
  // The edit form sends every field back, changed or not. Only a CHANGE to
  // the contact details is a change: re-validating a stored value locked an
  // owner out of a title fix when their number was saved before the rule
  // existed, and refused a moderator's every edit outright.
  const contactChanged      = 'contact'      in body && (body.contact      ?? null) !== (listing.contact      ?? null)
  const contactEmailChanged = 'contactEmail' in body && (body.contactEmail ?? null) !== (listing.contactEmail ?? null)
  const contact      = contactChanged      ? body.contact      : undefined
  const contactEmail = contactEmailChanged ? body.contactEmail : undefined

  if (isCityModerator && (renew || status !== undefined)) {
    return NextResponse.json({ error: 'Moderators can edit a listing, not renew it or change its status' }, { status: 403 })
  }
  // Nor the contact details: rewriting where the money goes is not a
  // moderation action, the owner is never told, and this route writes no
  // audit row. Staff fix a title or a neighbourhood; a seller owns how they
  // are reached.
  if (isCityModerator && (contactChanged || contactEmailChanged)) {
    return NextResponse.json({ error: "A listing's contact details are the seller's — ask them to change it" }, { status: 403 })
  }

  if (renew) {
    // Renewing an expired listing puts it back; renewing a SOLD one used to
    // relist it, so the three-day warning email for something already gone
    // brought it back with one tap.
    if (listing.status === 'filled') {
      return NextResponse.json({
        error: 'This listing is marked as done. Post it again if it\'s available once more.',
      }, { status: 400 })
    }
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
      // A number here used to throw inside the handler (500); anything long
      // was stored whole and rendered on every card.
      data.price = typeof price === 'string' && price.trim() ? price.trim().slice(0, 50) : null
    }
    if (neighborhood !== undefined) {
      data.neighborhood = await safeNeighborhoodFor(listing.cityId, neighborhood)
    }
    if (contact !== undefined) {
      const checked = normalizeListingContact(contact)
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
      data.contact = checked.value
    }
    if (contactEmail !== undefined) {
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      data.contactEmail = typeof contactEmail === 'string' && contactEmail.trim().length <= 200 && EMAIL_RE.test(contactEmail.trim())
        ? contactEmail.trim().toLowerCase() : null
    }

    const updated = await prisma.listing.update({ where: { id }, data })
    // A staff edit on someone else's listing leaves a trail — the admin twin
    // of this route has always audited, this one never did.
    if (isCityModerator) {
      await writeAudit(session.id, session.name, 'listing.staff_edit', id, 'listing',
        { fields: Object.keys(data), cityId: listing.cityId },
        `Edited ${Object.keys(data).join(', ')} on another member's listing`)
    }
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
