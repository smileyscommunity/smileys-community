import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { attributionDisplay } from '@/lib/directory'

// GET /api/directory/saved — the caller's saved businesses, ordered
// by save recency. Same row shape as /api/directory so the /directory/
// saved page can render the existing BusinessCard without translation.
export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const saves = await prisma.businessSave.findMany({
      where:   { userId: session.id },
      orderBy: { createdAt: 'desc' },
      take:    200,
      include: {
        business: {
          select: {
            id: true, name: true, category: true, description: true,
            neighborhood: true, address: true, phone: true,
            website: true, instagram: true, logo: true, coverImage: true,
            isExpatOwned: true, isExpatFriendly: true, languages: true,
            latitude: true, longitude: true,
            hours: true, memberDiscount: true, tags: true,
            claimedById: true, isApproved: true, isActive: true,
            submittedBy: { select: { name: true } },
            createdAt: true,
          },
        },
      },
    })

    // Drop any rows pointing at unapproved or deactivated businesses —
    // a previously-saved entry that gets moderated should silently fall
    // out of the saved list rather than 404 on click.
    const visible = saves
      .map(s => s.business)
      .filter(b => b && b.isApproved && b.isActive)

    const ids = visible.map(b => b.id)
    const [ratingStats, saveCounts] = await Promise.all([
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
    ])
    const statsByBiz = new Map(
      ratingStats.map(s => [s.businessId, { avgRating: s._avg.rating ?? null, reviewCount: s._count._all }]),
    )
    const saveByBiz = new Map(saveCounts.map(s => [s.businessId, s._count._all]))

    const enriched = visible.map(b => {
      const { submittedBy, claimedById, isApproved: _ia, isActive: _is, ...rest } = b
      return {
        ...rest,
        avgRating:        statsByBiz.get(b.id)?.avgRating   ?? null,
        reviewCount:      statsByBiz.get(b.id)?.reviewCount ?? 0,
        saveCount:        saveByBiz.get(b.id)               ?? 0,
        isSaved:          true,
        addedBy:          attributionDisplay(submittedBy?.name),
        // Same projection as the main directory endpoint — never leak
        // the raw owner CUID to the client.
        hasClaimedOwner:  claimedById !== null,
        isMine:           claimedById === session.id,
      }
    })

    return NextResponse.json(enriched)
  } catch (e) {
    console.error('Directory saved GET error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
