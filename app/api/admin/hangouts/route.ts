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
  const offset = parseInt(searchParams.get('offset') || '0', 10)
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

  const [hangouts, total] = await Promise.all([
    prisma.hangout.findMany({
      where,
      // Soonest-starting first so the live/upcoming ones an admin is most
      // likely to act on sit at the top; past ones fall to the bottom.
      orderBy: { startsAt: 'desc' },
      skip: offset,
      take,
      include: {
        user:   { select: { id: true, name: true, email: true, color: true } },
        city:   { select: { name: true, slug: true } },
        _count: { select: { joins: true, messages: true } },
      },
    }),
    prisma.hangout.count({ where }),
  ])

  // Moderators don't get raw member emails elsewhere (the users list masks
  // them); keep that consistent here rather than leaking them through the
  // hangout creator field.
  const safe = isAdmin(session)
    ? hangouts
    : hangouts.map(h => ({ ...h, user: { ...h.user, email: '' } }))

  return NextResponse.json({ hangouts: safe, total, hasMore: offset + take < total })
}
