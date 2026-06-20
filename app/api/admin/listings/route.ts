import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator } from '@/lib/access'

const VALID_CATEGORIES = ['ROOMS','JOBS','SERVICES','BUY_SELL','FREE','LOST_FOUND','RECO','EXPERIENCES','PETS']

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

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { userId, category, title, description, price, photo, photoPosition, contact, neighborhood, expiryDays } = body

  if (!userId || typeof userId !== 'string') return NextResponse.json({ error: 'userId required' }, { status: 400 })
  if (!category || !VALID_CATEGORIES.includes(category)) return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  if (!title?.trim()) return NextResponse.json({ error: 'Title required' }, { status: 400 })
  if (!description?.trim()) return NextResponse.json({ error: 'Description required' }, { status: 400 })

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const days = Math.min(Math.max(parseInt(expiryDays) || 30, 1), 365)
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)

  const listing = await prisma.listing.create({
    data: {
      userId,
      category,
      title:        title.trim().slice(0, 120),
      description:  description.trim().slice(0, 2000),
      price:        price ? String(price).slice(0, 50) : null,
      photo:         photo ? String(photo).slice(0, 500) : null,
      photoPosition: typeof photoPosition === 'number' && photoPosition >= 0 && photoPosition <= 100 ? Math.round(photoPosition) : 50,
      contact:      contact ? String(contact).slice(0, 200) : null,
      neighborhood: neighborhood || null,
      status:       'active',
      expiresAt,
    },
  })

  return NextResponse.json(listing, { status: 201 })
}
