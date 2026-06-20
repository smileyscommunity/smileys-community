// Server-only: this file imports Prisma and must never be imported by
// client components. Client components should import from lib/directory-constants.ts.
export * from './directory-constants'
import { attributionDisplay } from './directory-constants'

// ─── Query helpers ────────────────────────────────────────────────────────────

import { prisma } from './prisma'
import { getCached, setCached } from './analyticsCache'

export const PAGE_SIZE = 100
export type DirectorySort = 'recent' | 'trending'

export type DirectoryFilters = {
  category?:     string
  neighborhood?: string
  type?:         string
  sort?:         DirectorySort
  cursor?:       string   // last id of the previous page (keyset)
  callerId?:     string   // session.id for isSaved / isMine
}

export type DirectoryBusiness = {
  id:              string
  name:            string
  category:        string
  description:     string
  neighborhood:    string | null
  address:         string | null
  phone:           string | null
  website:         string | null
  instagram:       string | null
  logo:            string | null
  coverImage:      string | null
  isExpatOwned:    boolean
  isExpatFriendly: boolean
  languages:       string | null
  latitude:        number | null
  longitude:       number | null
  hours:           string | null
  memberDiscount:  string | null
  tags:            string[]
  createdAt:       Date
  avgRating:       number | null
  reviewCount:     number
  saveCount:       number
  isSaved:         boolean
  addedBy:         string
  hasClaimedOwner: boolean
  isMine:          boolean
  // The caller's own claim status against this business, computed
  // server-side so the directory grid doesn't have to fire one
  // /api/.../claim fetch per card on mount.
  myClaimStatus:   'none' | 'pending' | 'approved' | 'rejected'
}

export type DirectoryPage = {
  items:      DirectoryBusiness[]
  nextCursor: string | null
  total:      number
}

export async function queryDirectory(filters: DirectoryFilters): Promise<DirectoryPage> {
  const { category, neighborhood, type, sort = 'recent', cursor, callerId } = filters

  const where: Record<string, unknown> = { isApproved: true, isActive: true }
  if (category && category !== 'all') where.category     = category
  if (neighborhood)                   where.neighborhood = neighborhood
  if (type === 'expat-owned')         where.isExpatOwned    = true
  if (type === 'expat-friendly')      where.isExpatFriendly = true

  // Total count: cache per filter combination for 60s to avoid a COUNT(*)
  // on every request. The number doesn't need to be perfectly fresh — it's
  // only used for the "showing N of total" header.
  const countKey = `dir:count:${JSON.stringify(where)}`
  let total = getCached<number>(countKey)
  if (total === null) {
    total = await prisma.business.count({ where })
    setCached(countKey, total, 60_000)
  }

  const businesses = await prisma.business.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take:    PAGE_SIZE + 1,   // fetch one extra to determine if there's a next page
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true, name: true, category: true, description: true,
      neighborhood: true, address: true, phone: true,
      website: true, instagram: true, logo: true, coverImage: true,
      isExpatOwned: true, isExpatFriendly: true, languages: true,
      latitude: true, longitude: true,
      hours: true, memberDiscount: true, tags: true,
      claimedById: true,
      submittedBy: { select: { name: true } },
      createdAt: true,
    },
  })

  const hasMore    = businesses.length > PAGE_SIZE
  const page       = hasMore ? businesses.slice(0, PAGE_SIZE) : businesses
  const nextCursor = hasMore ? page[page.length - 1].id : null

  if (page.length === 0) return { items: [], nextCursor: null, total }

  const ids = page.map(b => b.id)
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000)

  const [ratingStats, saveCounts, mySaves, trendingStats, myClaims] = await Promise.all([
    prisma.businessReview.groupBy({
      by: ['businessId'],
      where: { businessId: { in: ids }, isHidden: false },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    prisma.businessSave.groupBy({
      by: ['businessId'],
      where: { businessId: { in: ids } },
      _count: { _all: true },
    }),
    callerId
      ? prisma.businessSave.findMany({ where: { userId: callerId, businessId: { in: ids } }, select: { businessId: true } })
      : Promise.resolve([]),
    sort === 'trending'
      ? prisma.businessSave.groupBy({ by: ['businessId'], where: { businessId: { in: ids }, createdAt: { gte: oneWeekAgo } }, _count: { _all: true } })
      : Promise.resolve([]),
    // Batch the caller's claim status across the whole page so each
    // BusinessCard renders with claim state already known — replaces
    // the per-card /api/.../claim fetch that fired N requests for an
    // N-business grid.
    callerId
      ? prisma.businessClaim.findMany({ where: { claimantId: callerId, businessId: { in: ids } }, select: { businessId: true, status: true } })
      : Promise.resolve([]),
  ])

  const statsByBiz   = new Map(ratingStats.map(s  => [s.businessId, { avgRating: s._avg.rating ?? null, reviewCount: s._count._all }]))
  const saveByBiz    = new Map(saveCounts.map(s   => [s.businessId, s._count._all]))
  const savedSet     = new Set(mySaves.map(s      => s.businessId))
  const trendingByBiz = new Map(trendingStats.map(s => [s.businessId, s._count._all]))
  const claimByBiz   = new Map(myClaims.map(c     => [c.businessId, c.status]))

  let items = page.map(b => {
    const { submittedBy, claimedById, ...rest } = b
    const rawStatus = claimByBiz.get(b.id)
    const myClaimStatus: DirectoryBusiness['myClaimStatus'] =
      rawStatus === 'pending' || rawStatus === 'approved' || rawStatus === 'rejected'
        ? rawStatus
        : 'none'
    return {
      ...rest,
      avgRating:       statsByBiz.get(b.id)?.avgRating   ?? null,
      reviewCount:     statsByBiz.get(b.id)?.reviewCount ?? 0,
      saveCount:       saveByBiz.get(b.id)               ?? 0,
      isSaved:         savedSet.has(b.id),
      addedBy:         attributionDisplay(submittedBy?.name),
      hasClaimedOwner: claimedById !== null,
      isMine:          callerId != null && claimedById === callerId,
      myClaimStatus,
    }
  })

  const sorted = sort === 'trending'
    ? [...items].sort((a, b) => (trendingByBiz.get(b.id) ?? 0) - (trendingByBiz.get(a.id) ?? 0))
    : items

  return { items: sorted as unknown as DirectoryBusiness[], nextCursor, total }
}

