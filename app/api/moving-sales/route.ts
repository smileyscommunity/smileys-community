import { NextRequest, NextResponse } from 'next/server'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId, getCityTz } from '@/lib/city'
import { todayInTz } from '@/lib/cityTime'
import { getPublicCity } from '@/lib/cities'
import { resolvePostingCityId } from '@/lib/cityMembership'
import { rateLimit } from '@/lib/rateLimit'
import { safeNeighborhoodFor } from '@/lib/neighborhoodsDb'
import { sendListingAlertEmail, recordEmailFailure } from '@/lib/email'
import { createNotification } from '@/lib/notify'
import { authorProjector } from '@/lib/authorProjection'
import { redactBoardTextForGuest } from '@/lib/boardAccess'

// Moving Sales (plan §13). Publicly readable like listings. The seller is
// member content: guests get a first name and no photo, and no neighborhood
// — with the leaving date it says which home is about to be empty. Members
// see the seller per lib/authorProjection. No contact data exists on the
// model; the contact route handles reaching them. Expired sales (leavingOn
// past) drop out of the list automatically.
export async function GET(req: NextRequest) {
  const session = await getSession()
  // ?city=<slug>: the marketplace pins its city in the URL, and the listings
  // grid beside this list already honours it — without this the sales under a
  // shared İzmir link were the viewer's cookie city. Unknown slug falls back
  // to the viewer's city, same as app/api/listings.
  const citySlug = new URL(req.url).searchParams.get('city')?.trim()
  const cityId   = (citySlug ? (await getPublicCity(citySlug))?.id : undefined) ?? await resolveCityId(session)
  // "Expired" in the listed city's day, same floor POST/PATCH accept. The UTC
  // day hid a sale leaving today for the hours after midnight west of UTC and
  // kept yesterday's sales listed after midnight east of it.
  const today = todayInTz(await getCityTz(cityId))
  const sales = await prisma.movingSale.findMany({
    where:   { status: 'active', leavingOn: { gte: today }, cityId, user: { status: 'approved', hiddenFromMembers: false } },
    orderBy: { leavingOn: 'asc' },
    take:    30,
    select: {
      id: true, leavingOn: true, neighborhood: true, note: true, photo: true, createdAt: true,
      user:  { select: { id: true, name: true, color: true, profilePhoto: true, profileVisibility: true } },
      items: { select: { id: true, name: true, price: true, claimed: true }, orderBy: { claimed: 'asc' } },
    },
  })
  const project = await authorProjector(session, sales.map(s => s.user))
  return NextResponse.json({
    sales: sales.map(s => ({
      ...s,
      user: project(s.user),
      neighborhood: session ? s.neighborhood : null,
      // Withholding the neighbourhood from guests is pointless if the note
      // says "Cihangir, Akarsu Sok 12, leaving the 14th" — which is exactly
      // what a sale note tends to say. Same redaction the board applies to
      // its own text for guests.
      note: session ? s.note : (s.note ? redactBoardTextForGuest(s.note) : null),
      // Item names too: "IKEA sofa, call 0532…" is a note by another name.
      items: session ? s.items : s.items.map(i => ({ ...i, name: redactBoardTextForGuest(i.name) })),
    })),
  })
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
  // One resolution for the date floor, the neighborhood check and the row
  // itself, and it follows membership rather than the view-city cookie — same
  // reasoning as the listings route (resolvePostingCityId).
  const postingCityId = await resolvePostingCityId(session)
  // "Past" in the city the sale files to. The UTC day accepted a date that
  // had already ended in cities east of UTC for the hours after their
  // midnight (and refused today's date west of UTC in the evening).
  if (leavingOn < todayInTz(await getCityTz(postingCityId))) {
    return NextResponse.json({ error: 'Leaving date is in the past' }, { status: 400 })
  }
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
    where: {
      listingAlerts: { has: 'MOVING' }, id: { not: session.id }, cityId: sale.cityId, status: 'approved',
      blocksGiven: { none: { blockedId: session.id } }, blocksReceived: { none: { blockerId: session.id } },
    },
    select: { id: true, email: true, name: true },
  }).then(alertees => {
    for (const u of alertees) {
      sendListingAlertEmail(u.email, u.name, 'Moving sale', { title, description }, `/moving-sales/${sale.id}`)
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
