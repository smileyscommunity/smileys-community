import { canManageClubs } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

export async function GET() {
  try {
    const session = await getSession()
    if (!session || !canManageClubs(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const clubs = await prisma.club.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { events: true } } },
    })
    return NextResponse.json(clubs)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !canManageClubs(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = await req.json()
    const { name, description, category, emoji } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const club = await prisma.club.create({
      data: {
        name:        name.trim(),
        slug,
        description: description?.trim() || 'A new Smileys club.',
        category:    category?.trim()    || 'Social',
        emoji:       emoji               || '🎉',
        color:       'text-amber-600',
        bgColor:     'bg-amber-50',
        memberCount: 0,
      },
    })
    return NextResponse.json(club, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
