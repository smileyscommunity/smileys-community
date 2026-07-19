import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

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
  const take   = 50

  const where: Record<string, unknown> = {
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
        _count: { select: { joins: true, messages: true } },
      },
    }),
    prisma.hangout.count({ where }),
  ])

  return NextResponse.json({ hangouts, total, hasMore: offset + take < total })
}
