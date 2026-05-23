import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator } from '@/lib/access'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category') || undefined
  const status   = searchParams.get('status') || 'active'
  const search   = searchParams.get('search') || ''
  const offset   = parseInt(searchParams.get('offset') || '0', 10)
  const take     = 50

  const where: Record<string, unknown> = {
    ...(status !== 'all' ? { status } : {}),
    ...(category ? { category } : {}),
    ...(search ? {
      OR: [
        { title:       { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
      ],
    } : {}),
  }

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take,
      include: { user: { select: { id: true, name: true, email: true, color: true } } },
    }),
    prisma.listing.count({ where }),
  ])

  return NextResponse.json({ listings, total, hasMore: offset + take < total })
}
