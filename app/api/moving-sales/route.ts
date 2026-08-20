import { NextRequest, NextResponse } from 'next/server'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId } from '@/lib/city'
import { resolvePostingCityId } from '@/lib/cityMembership'
import { rateLimit } from '@/lib/rateLimit'
import { safeNeighborhoodFor } from '@/lib/neighborhoodsDb'
import { sendListingAlertEmail, recordEmailFailure } from '@/lib/email'
import { createNotification } from '@/lib/notify'

// Moving Sales (plan §13). Publicly readable like listings — seller shown as
// name + neighborhood only, no contact data exists on the model at all; the
// contact route handles reaching them. Expired sales (leavingOn past) drop
// out of the list automatically.
export async function GET() {
  const today = new Date().toISOString().slice(0, 10)
  const session = await getSession()
  const sales = await prisma.movingSale.findMany({
    where:   { status: 'active', leavingOn: { gte: today }, cityId: await resolveCityId(session) },
    orderBy: { leavingOn: 'asc' },
    take:    30,
    select: {
      id: true, leavingOn: true, neighborhood: true, note: true, photo: true, createdAt: true,
      user:  { select: { id: true, name: true, color: true, profilePhoto: true } },
      items: { select: { id: true, name: true, price: true, claimed: true }, orderBy: { claimed: 'asc' } },
    },
  })
  return NextResponse.json({ sales })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // One departure per person is the honest cardinality — 2/day allows a
  // fix-and-repost without opening a spam channel.
  if (!await rateLimit(`moving-sale:${session.id}`, 2, 24 * 60 * 60_000)) {
    return NextResponse.json({ error: 'Daily limit reached' }, { status: 429 })
  }

  const { leavingOn, neighborhood, note, items, photo } = await req.json()
  if (typeof leavingOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(leavingOn)) {
    return NextResponse.json({ error: 'When are you leaving?' }, { status: 400 })
  }
  if (leavingOn < new Date().toISOString().slice(0, 10)) {
    return NextResponse.json({ error: 'Leaving date is in the past' }, { status: 400 })
  }
  // One resolution for the neighborhood check and the row itself, and it
  // follows membership rather than the view-city cookie — same reasoning as
  // the listings route (resolvePostingCityId).
  const postingCityId = await resolvePostingCityId(session)
  const safeNeighborhood = await safeNeighborhoodFor(postingCityId, neighborhood)
  const safeNote = typeof note === 'string' ? note.trim().slice(0, 500) || null : null
  // Matches the Listing route's PHOTO_RE — only accept a URL our own
  // upload route produced, never an arbitrary external string.
  const safePhoto = typeof photo === 'string' && isUploadedImageUrl(photo) ? photo : null

  // Items: 1–20, name required, price free text (matches Listing.price) or
  // empty = FREE.
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'Add at least one item' }, { status: 400 })
  }
  const safeItems = items.slice(0, 20).flatMap((it: unknown) => {
    if (!it || typeof it !== 'object') return []
    const name  = typeof (it as { name?: unknown }).name === 'string' ? (it as { name: string }).name.trim().slice(0, 80) : ''
    const price = typeof (it as { price?: unknown }).price === 'string' ? (it as { price: string }).price.trim().slice(0, 40) || null : null
    return name ? [{ name, price }] : []
  })
  if (safeItems.length === 0) return NextResponse.json({ error: 'Add at least one item' }, { status: 400 })

  const sale = await prisma.movingSale.create({
    data: {
      userId: session.id, cityId: postingCityId, leavingOn, neighborhood: safeNeighborhood, note: safeNote, photo: safePhoto,
      items: { create: safeItems },
    },
    select: { id: true, cityId: true },
  })

  // Fire alert emails + push in background — same pattern as the Listing
  // POST route (listingAlerts, 'MOVING' category). Previously missing
  // entirely, so nobody subscribed to moving-sale alerts ever heard about
  // a new one.
  const title = `Moving sale: ${safeItems.length} item${safeItems.length !== 1 ? 's' : ''}${safeNeighborhood ? ` in ${safeNeighborhood}` : ''}`
  const description = safeNote || safeItems.map(it => it.name).join(', ')
  prisma.user.findMany({
    where: { listingAlerts: { has: 'MOVING' }, id: { not: session.id }, cityId: sale.cityId },
    select: { id: true, email: true, name: true },
  }).then(alertees => {
    for (const u of alertees) {
      sendListingAlertEmail(u.email, u.name, 'Moving sale', { title, description })
        .catch(async err => {
          console.error('[moving-sales POST] sendListingAlertEmail failed', { saleId: sale.id, userId: u.id, err: String(err) })
          await recordEmailFailure({ helper: 'sendListingAlertEmail', recipient: u.email, error: err, context: { saleId: sale.id, userId: u.id, category: 'MOVING' } })
        })
      createNotification(
        u.id,
        'listing_new',
        'New moving sale',
        title,
        '/board?tab=MOVING',
      ).catch(err => console.error('[moving-sales POST] createNotification failed', { saleId: sale.id, userId: u.id, err: String(err) }))
    }
  }).catch(err => console.error('[moving-sales POST] alert fan-out failed', { saleId: sale.id, err: String(err) }))

  return NextResponse.json({ id: sale.id }, { status: 201 })
}
