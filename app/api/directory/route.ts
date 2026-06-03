import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { rateLimit } from '@/lib/rateLimit'
import { isSafeHref } from '@/lib/safeUrl'
import {
  BUSINESS_CATEGORY_SET,
  DIRECTORY_LIMITS,
  normalizeInstagramHandle,
  attributionDisplay,
} from '@/lib/directory'

const PAGE_SIZE = 200

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  return s.slice(0, max)
}

export async function GET(req: NextRequest) {
  try {
    // Public read — the directory is part of the marketing surface, like
    // /events and /clubs. No session required. The POST handler below
    // remains gated, so anonymous browsers can't submit.
    const session = await getSession()
    const { searchParams } = new URL(req.url)
    const category     = searchParams.get('category') || ''
    const type         = searchParams.get('type') || ''
    const neighborhood = searchParams.get('neighborhood') || ''

    const where: Record<string, unknown> = { isApproved: true, isActive: true }

    // Validate `category` against the allowlist before passing to Prisma.
    // Submitting a raw string here is harmless (Prisma parameterizes) but
    // an invalid value returns 0 rows silently — easier to surface here.
    if (category && category !== 'all') {
      if (!BUSINESS_CATEGORY_SET.has(category)) {
        return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
      }
      where.category = category
    }
    if (neighborhood) {
      // Bound the length so a 100KB neighborhood param can't pin the DB.
      where.neighborhood = neighborhood.slice(0, DIRECTORY_LIMITS.neighborhood)
    }
    if (type === 'expat-owned')    where.isExpatOwned    = true
    if (type === 'expat-friendly') where.isExpatFriendly = true

    // The previous implementation also accepted a `search` param and
    // server-filtered by it. The client never sent `search` — the
    // /directory page filters in-memory across the up-to-200 list — so
    // that branch was dead code. Removed: the client filter handles it.
    const businesses = await prisma.business.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      select: {
        id: true, name: true, category: true, description: true,
        neighborhood: true, address: true, phone: true,
        website: true, instagram: true, logo: true, coverImage: true,
        isExpatOwned: true, isExpatFriendly: true, languages: true,
        latitude: true, longitude: true,
        hours: true, memberDiscount: true, tags: true,
        // claimedById is exposed (truthy/falsy) so the public card can
        // show a "✓ Verified owner" badge; the owner's identity is NOT
        // included to avoid a PII leak on a public endpoint.
        claimedById: true,
        // Submitter name is exposed for the "Added by Sarah K." line.
        // attributionDisplay() truncates the surname to a single
        // letter before it leaves the server, so a public scraper
        // can't enumerate which full-name member added what.
        submittedBy: { select: { name: true } },
        createdAt: true,
      },
    })

    // Aggregate ratings, save counts, and per-caller save flags. All
    // computed via single groupBy / findMany passes — no N+1 over the
    // business list. Hidden reviews are excluded so the average
    // matches what the public sees on the detail card.
    const ids = businesses.map(b => b.id)
    const [ratingStats, saveCounts, mySaves] = await Promise.all([
      ids.length === 0 ? Promise.resolve([]) : prisma.businessReview.groupBy({
        by: ['businessId'],
        where: { businessId: { in: ids }, isHidden: false },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      ids.length === 0 ? Promise.resolve([]) : prisma.businessSave.groupBy({
        by: ['businessId'],
        where: { businessId: { in: ids } },
        _count: { _all: true },
      }),
      // Only query the caller's saves when there's a session — anonymous
      // viewers get isSaved=false for every row without a DB round-trip.
      ids.length === 0 || !session ? Promise.resolve([]) : prisma.businessSave.findMany({
        where:  { userId: session.id, businessId: { in: ids } },
        select: { businessId: true },
      }),
    ])
    const statsByBiz = new Map(
      ratingStats.map(s => [s.businessId, {
        avgRating:   s._avg.rating ?? null,
        reviewCount: s._count._all,
      }]),
    )
    const saveByBiz = new Map(saveCounts.map(s => [s.businessId, s._count._all]))
    const savedSet  = new Set(mySaves.map(s => s.businessId))

    // Strip the joined submittedBy row before returning — only the
    // truncated attribution string leaves the server.
    const enriched = businesses.map(b => {
      const { submittedBy, ...rest } = b
      return {
        ...rest,
        avgRating:   statsByBiz.get(b.id)?.avgRating   ?? null,
        reviewCount: statsByBiz.get(b.id)?.reviewCount ?? 0,
        saveCount:   saveByBiz.get(b.id)               ?? 0,
        isSaved:     savedSet.has(b.id),
        addedBy:     attributionDisplay(submittedBy?.name),
      }
    })

    return NextResponse.json(enriched)
  } catch (e) {
    console.error('Directory GET error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Replace the previous DB-count rate limit. That did a per-request
    // SELECT COUNT(*) on every POST, and counted rejected (isActive=false)
    // rows as if they were live submissions. The proper rateLimit() helper
    // uses Redis-style counters and is cheaper.
    if (!await rateLimit(`directory-submit:${session.id}`, 5, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many submissions this hour' }, { status: 429 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const name        = str(body.name,        DIRECTORY_LIMITS.name)
    const category    = str(body.category,    50)
    const description = str(body.description, DIRECTORY_LIMITS.description)
    if (!name || !category || !description) {
      return NextResponse.json({ error: 'Name, category, and description are required' }, { status: 400 })
    }
    if (!BUSINESS_CATEGORY_SET.has(category)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    }

    // Optional fields. Each goes through length-capped str(); URLs are
    // validated against the isSafeHref allowlist (https / mailto only)
    // so a malicious submission can't ship a javascript:/data: URL out
    // to every member who clicks "Website".
    const neighborhood = str(body.neighborhood, DIRECTORY_LIMITS.neighborhood)
    const address      = str(body.address,      DIRECTORY_LIMITS.address)
    const phone        = str(body.phone,        DIRECTORY_LIMITS.phone)
    const languages    = str(body.languages,    DIRECTORY_LIMITS.languages)

    const websiteRaw   = str(body.website, DIRECTORY_LIMITS.website)
    let website: string | null = null
    if (websiteRaw) {
      if (!isSafeHref(websiteRaw)) {
        return NextResponse.json({ error: 'Website must start with https://' }, { status: 400 })
      }
      website = websiteRaw
    }

    // Instagram comes in as a handle, but users paste full URLs and
    // admins may include the leading @. Normalize to bare handle and
    // reject anything that isn't a valid handle (letters/digits/_/.).
    let instagram: string | null = null
    if (typeof body.instagram === 'string' && body.instagram.trim()) {
      instagram = normalizeInstagramHandle(body.instagram)
      if (!instagram) {
        return NextResponse.json({ error: 'Invalid Instagram handle' }, { status: 400 })
      }
    }

    // Auto-approve only for admin role. Moderators submitting their own
    // listings still go through review — they're trusted enough to triage
    // but not to publish directly without a second pair of eyes.
    const autoApprove = session.role === 'admin'

    const business = await prisma.business.create({
      data: {
        name,
        category,
        description,
        neighborhood,
        address,
        phone,
        website,
        instagram,
        languages,
        isExpatOwned:    !!body.isExpatOwned,
        isExpatFriendly: !!body.isExpatFriendly,
        submittedById: session.id,
        isApproved: autoApprove,
      },
    })

    if (!autoApprove) {
      const admins = await prisma.user.findMany({
        where: { role: { in: ['admin', 'moderator'] } },
        select: { id: true },
      })
      await Promise.all(admins.map(a =>
        createNotification(
          a.id,
          'system',
          'New business submission',
          `${session.name} submitted "${business.name}" for directory approval`,
          '/admin/directory',
        ),
      ))
    }

    return NextResponse.json({ ok: true, id: business.id, approved: business.isApproved })
  } catch (e) {
    console.error('Directory POST error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
