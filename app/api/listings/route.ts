import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { sendListingAlertEmail, recordEmailFailure } from '@/lib/email'
import { createNotification } from '@/lib/notify'
import { rateLimit } from '@/lib/rateLimit'
import { ISTANBUL_NEIGHBORHOODS } from '@/lib/data'
import { redactListingForGuest } from '@/lib/listingsPublic'

const PAGE_SIZE = 20

const CAT_LABELS: Record<string, string> = {
  ROOMS: 'Room', JOBS: 'Job', BUY_SELL: 'Buy/Sell',
  SERVICES: 'Service', FREE: 'Free stuff', RECO: 'Recommendation',
  LOST_FOUND: 'Lost & Found', EXPERIENCES: 'Experience', PETS: 'Adopt a Pet',
}

export async function GET(req: NextRequest) {
  try {
    // Public read — anonymous browsing is the whole point (SEO + "what's in
    // the marketplace" pull for prospects). Session-only features
    // (?saved=true, savedIds) just no-op for anonymous users.
    const session = await getSession()

    const { searchParams } = new URL(req.url)
    const category     = searchParams.get('category') || undefined
    const neighborhood = searchParams.get('neighborhood') || undefined
    const saved        = searchParams.get('saved') === 'true'
    const mine         = searchParams.get('mine') === 'true'
    const q            = searchParams.get('q')?.trim() || undefined
    const offset       = parseInt(searchParams.get('offset') || '0', 10)

    // ?saved=true requires a logged-in user; for anonymous, force the filter
    // to match nothing instead of querying without it (which would return everything).
    const savedFilter = saved
      ? session
        ? { savedBy: { some: { userId: session.id } } }
        : { id: '__never__' }
      : {}

    // ?mine=true — show the current user's own listings including expired/filled
    // so they can see and manage everything they've posted. Both guards must
    // require a session: an anonymous ?mine=true previously dropped the status
    // filter (mine) AND the owner scope (no session), returning every listing
    // of every status — incl. deleted/expired — to a logged-out visitor.
    const mineFilter = mine && session ? { userId: session.id } : {}
    const statusFilter = mine && session ? {} : { status: 'active' }

    const where = {
      ...statusFilter,
      ...(category ? { category } : {}),
      ...(neighborhood ? { neighborhood } : {}),
      ...savedFilter,
      ...mineFilter,
      ...(q ? { OR: [
        { title:       { contains: q, mode: 'insensitive' as const } },
        { description: { contains: q, mode: 'insensitive' as const } },
      ]} : {}),
    }

    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: PAGE_SIZE,
        include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
      }),
      prisma.listing.count({ where }),
    ])

    const listingIds = listings.map(l => l.id)
    const savedRows = session && listingIds.length > 0
      ? await prisma.savedListing.findMany({
          where: { userId: session.id, listingId: { in: listingIds } },
          select: { listingId: true },
        })
      : []
    const savedIds = savedRows.map(r => r.listingId)

    // Guests see a teaser projection — no contact, no photo, truncated
    // description, anonymized poster. The page itself is public for SEO,
    // but the details are member-only.
    const projected = session ? listings : listings.map(redactListingForGuest)

    return NextResponse.json({ listings: projected, total, hasMore: offset + PAGE_SIZE < total, savedIds })
  } catch (e) {
    console.error('Listings GET error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Rate limit. Without this, a member could spam-create listings
  // (and trigger the alert-email fan-out below) at script speed.
  // 5/min is generous for legit posting; abusers hit the wall fast.
  if (!await rateLimit(`listings-create:${session.id}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many listings. Try again in a minute.' }, { status: 429 })
  }

  const { category, title, description, price, photo, photoPosition, contact, neighborhood, photos, attrs } = await req.json()

  // RECO / LOST_FOUND / EXPERIENCES retired from posting (legacy rows
  // still render) — their jobs moved to Board posts.
  const VALID_CATEGORIES = ['ROOMS', 'JOBS', 'BUY_SELL', 'SERVICES', 'FREE', 'WANTED', 'PETS']
  if (!category || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }
  if (!title?.trim() || !description?.trim()) {
    return NextResponse.json({ error: 'Title and description are required' }, { status: 400 })
  }
  if (title.length > 120) return NextResponse.json({ error: 'Title too long' }, { status: 400 })
  if (description.length > 2000) return NextResponse.json({ error: 'Description too long' }, { status: 400 })

  const PHOTO_RE = /^\/app\/api\/files\/[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/
  const safePhoto = typeof photo === 'string' && PHOTO_RE.test(photo) ? photo : null
  // Gallery: up to 4 more shots, each held to the same upload-URL shape as
  // the cover so nothing external can be embedded.
  const safePhotos = Array.isArray(photos)
    ? [...new Set(photos.filter((u): u is string => typeof u === 'string' && PHOTO_RE.test(u)))].slice(0, 4)
    : []

  // Category-specific attributes — one JSON column, but only allowlisted
  // keys with allowlisted values ever reach it; everything else is dropped
  // silently so a stale client can't poison the filters built on these.
  const ATTR_RULES: Record<string, Record<string, (v: unknown) => boolean>> = {
    ROOMS: {
      housingType:   v => typeof v === 'string' && ['room', 'apartment', 'roommate', 'sublet'].includes(v),
      availableFrom: v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
      furnished:     v => typeof v === 'boolean',
    },
    JOBS: {
      jobType: v => typeof v === 'string' && ['full_time', 'part_time', 'freelance', 'gig'].includes(v),
      remote:  v => typeof v === 'string' && ['remote', 'in_person', 'hybrid'].includes(v),
    },
    SERVICES: {
      rateUnit: v => typeof v === 'string' && ['hour', 'session', 'day', 'fixed'].includes(v),
      online:   v => typeof v === 'boolean',
    },
    PETS: {
      petGoal: v => typeof v === 'string' && ['adoption', 'foster'].includes(v),
    },
  }
  let safeAttrs: Record<string, unknown> | null = null
  if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
    const rules = ATTR_RULES[category] ?? {}
    const kept = Object.fromEntries(Object.entries(attrs).filter(([k, v]) => rules[k]?.(v)))
    if (Object.keys(kept).length > 0) safeAttrs = kept
  }
  const safeContact = typeof contact === 'string' && contact.length <= 200 ? contact : null
  // Validate against the canonical neighborhood list so we don't store typos that
  // would never match the filter dropdown on the browse page.
  const safeNeighborhood = typeof neighborhood === 'string'
    && (ISTANBUL_NEIGHBORHOODS as readonly string[]).includes(neighborhood)
    ? neighborhood : null

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 30)

  const listing = await prisma.listing.create({
    data: {
      userId: session.id,
      category,
      title: title.trim(),
      description: description.trim(),
      price: price?.trim() || null,
      photo: safePhoto,
      photos: safePhotos,
      attrs: safeAttrs === null ? undefined : (safeAttrs as object),
      photoPosition: typeof photoPosition === 'number' && photoPosition >= 0 && photoPosition <= 100 ? Math.round(photoPosition) : 50,
      contact: safeContact,
      neighborhood: safeNeighborhood,
      expiresAt,
    },
  })

  // Fire alert emails + push in background — don't await. Each
  // delivery failure now lands in email_failures (via #4's
  // recordEmailFailure) so a flapping SMTP shows up on the
  // dashboard tile, instead of silently dropping listing
  // alerts to dozens of subscribed members.
  const categoryLabel = CAT_LABELS[category] ?? category
  prisma.user.findMany({
    where: { listingAlerts: { has: category }, id: { not: session.id } },
    select: { id: true, email: true, name: true },
  }).then(alertees => {
    for (const u of alertees) {
      sendListingAlertEmail(u.email, u.name, categoryLabel, { title: listing.title, description: listing.description })
        .catch(async err => {
          console.error('[listings POST] sendListingAlertEmail failed', { listingId: listing.id, userId: u.id, err: String(err) })
          await recordEmailFailure({ helper: 'sendListingAlertEmail', recipient: u.email, error: err, context: { listingId: listing.id, userId: u.id, category } })
        })
      createNotification(
        u.id,
        'listing_new',
        `New ${categoryLabel.toLowerCase()} listing`,
        listing.title,
        `/board/${listing.id}`,
      ).catch(err => console.error('[listings POST] createNotification failed', { listingId: listing.id, userId: u.id, err: String(err) }))
    }
  }).catch(err => console.error('[listings POST] alert fan-out failed', { listingId: listing.id, err: String(err) }))

  return NextResponse.json(listing, { status: 201 })
}
