import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator, isAdmin, failClosedCityId } from '@/lib/access'

// Read-only oversight list for the admin Hangouts page. Editing and
// cancelling a hangout reuse the member endpoints (PATCH/DELETE
// /api/hangouts/[id]) — those already authorize admin/moderator — so
// this route only needs a GET. Hangouts are ephemeral (≤24h, auto-swept
// to 'expired'), which is why they never had an admin CRUD surface; this
// gives staff a way to find and kill a bad one without scrolling the feed.
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || 'active'
  const search = searchParams.get('search') || ''
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0)
  const cityParam = searchParams.get('city')
  const take   = 50

  // Oversight is city work: a moderator sees only their own city's hangouts
  // (fail-closed, like every sibling list), admins see all or one via ?city=.
  // Without this the list — and each creator's email — spanned every city.
  const cityScope = isAdmin(session)
    ? (cityParam ? { cityId: cityParam } : {})
    : { cityId: failClosedCityId(session) }

  const where: Record<string, unknown> = {
    ...cityScope,
    ...(status !== 'all' ? { status } : {}),
    ...(search ? {
      OR: [
        { title:    { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
      ],
    } : {}),
  }

  // Live and upcoming first, soonest start at the top — the ones an admin is
  // most likely to act on — then past ones, most recent first. Two ordered
  // reads stitched at the boundary, since one orderBy can't sort the two
  // halves in opposite directions; offset paging runs across the join. The
  // single orderBy here used to be newest-start-first, which put next week's
  // plan above the one starting in ten minutes.
  const now = new Date()
  const liveWhere = { ...where, endsAt: { gte: now } }
  const pastWhere = { ...where, endsAt: { lt: now } }
  const include = {
    user:   { select: { id: true, name: true, email: true, color: true } },
    city:   { select: { name: true, slug: true } },
    _count: { select: { joins: true, messages: true } },
  }
  const [liveTotal, pastTotal] = await Promise.all([
    prisma.hangout.count({ where: liveWhere }),
    prisma.hangout.count({ where: pastWhere }),
  ])
  const total    = liveTotal + pastTotal
  const liveTake = Math.max(Math.min(take, liveTotal - offset), 0)
  const pastSkip = Math.max(offset - liveTotal, 0)
  const [live, past] = await Promise.all([
    liveTake > 0
      ? prisma.hangout.findMany({ where: liveWhere, orderBy: { startsAt: 'asc' }, skip: offset, take: liveTake, include })
      : [],
    take - liveTake > 0
      ? prisma.hangout.findMany({ where: pastWhere, orderBy: { startsAt: 'desc' }, skip: pastSkip, take: take - liveTake, include })
      : [],
  ])
  const hangouts = [...live, ...past]

  // Moderators don't get raw member emails elsewhere (the users list masks
  // them); keep that consistent here rather than leaking them through the
  // hangout creator field.
  const safe = isAdmin(session)
    ? hangouts
    : hangouts.map(h => ({ ...h, user: { ...h.user, email: '' } }))

  return NextResponse.json({ hangouts: safe, total, hasMore: offset + take < total })
}
