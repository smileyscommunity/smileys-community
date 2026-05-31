import { canManageClubs } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { CLUB_CATEGORIES } from '@/lib/data'

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

    // Category must be one of the known options — the previous
    // `category || 'Social'` fallback silently filed unsubmitted
    // categories into Social, which was confusing both for admins
    // (form said "required" but submitted blank still worked) and
    // for the audit trail. Validate explicitly here.
    const cat = category?.trim()
    if (!cat || !(CLUB_CATEGORIES as readonly string[]).includes(cat)) {
      return NextResponse.json({ error: `Category must be one of: ${CLUB_CATEGORIES.join(', ')}` }, { status: 400 })
    }

    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

    // Default new clubs to the admin's own city. Multi-city UI for
    // creating clubs across cities is a later phase; for now the
    // creator's affiliation is the right behaviour.
    if (!session.cityId) {
      return NextResponse.json({ error: 'Your account has no city — contact a super-admin' }, { status: 400 })
    }

    const club = await prisma.club.create({
      data: {
        name:        name.trim(),
        slug,
        description: description?.trim() || 'A new Smileys club.',
        category:    cat,
        emoji:       emoji               || '🎉',
        color:       'text-amber-600',
        bgColor:     'bg-amber-50',
        memberCount: 0,
        cityId:      session.cityId,
      },
    })
    return NextResponse.json(club, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
