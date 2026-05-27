import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { sendListingAlertEmail } from '@/lib/email'
import { createNotification } from '@/lib/notify'
import { ISTANBUL_NEIGHBORHOODS } from '@/lib/data'

const PAGE_SIZE = 20

const CAT_LABELS: Record<string, string> = {
  ROOMS: 'Room', JOBS: 'Job', BUY_SELL: 'Buy/Sell',
  SERVICES: 'Service', FREE: 'Free stuff', RECO: 'Recommendation',
}

export async function GET(req: NextRequest) {
  // Public read — anonymous browsing is the whole point (SEO + "what's in the
  // marketplace" pull for prospects). Session-only features (?saved=true,
  // savedIds) just no-op for anonymous users.
  const session = await getSession()

  const { searchParams } = new URL(req.url)
  const category     = searchParams.get('category') || undefined
  const neighborhood = searchParams.get('neighborhood') || undefined
  const saved        = searchParams.get('saved') === 'true'
  const q            = searchParams.get('q')?.trim() || undefined
  const offset       = parseInt(searchParams.get('offset') || '0', 10)

  // ?saved=true requires a logged-in user; for anonymous, force the filter to
  // match nothing instead of querying without it (which would return everything).
  const savedFilter = saved
    ? session
      ? { savedBy: { some: { userId: session.id } } }
      : { id: '__never__' }
    : {}

  const where = {
    status: 'active',
    ...(category ? { category } : {}),
    ...(neighborhood ? { neighborhood } : {}),
    ...savedFilter,
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

  return NextResponse.json({ listings, total, hasMore: offset + PAGE_SIZE < total, savedIds })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { category, title, description, price, photo, contact, neighborhood } = await req.json()

  const VALID_CATEGORIES = ['ROOMS', 'JOBS', 'BUY_SELL', 'SERVICES', 'FREE', 'RECO']
  if (!category || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }
  if (!title?.trim() || !description?.trim()) {
    return NextResponse.json({ error: 'Title and description are required' }, { status: 400 })
  }
  if (title.length > 120) return NextResponse.json({ error: 'Title too long' }, { status: 400 })
  if (description.length > 2000) return NextResponse.json({ error: 'Description too long' }, { status: 400 })

  const safePhoto = typeof photo === 'string' && /^\/app\/api\/files\/[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/.test(photo) ? photo : null
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
      contact: safeContact,
      neighborhood: safeNeighborhood,
      expiresAt,
    },
  })

  // Fire alert emails + push in background — don't await
  const categoryLabel = CAT_LABELS[category] ?? category
  prisma.user.findMany({
    where: { listingAlerts: { has: category }, id: { not: session.id } },
    select: { id: true, email: true, name: true },
  }).then(alertees => {
    for (const u of alertees) {
      sendListingAlertEmail(u.email, u.name, categoryLabel, { title: listing.title, description: listing.description })
        .catch(() => {})
      createNotification(
        u.id,
        'listing_new',
        `New ${categoryLabel.toLowerCase()} listing`,
        listing.title,
        `/listings/${listing.id}`,
      ).catch(() => {})
    }
  }).catch(() => {})

  return NextResponse.json(listing, { status: 201 })
}
