import { canManageClubs } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { writeAudit, getDiff } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageClubs(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const whitelist = ['name', 'description', 'category', 'emoji', 'color', 'bgColor',
                       'whatsappUrl', 'instagramUrl', 'rules', 'isPrivate', 'coverImage', 'coverImagePosition',
                       'location', 'foundedAt', 'isActive']

    const before = await prisma.club.findUnique({
      where: { id },
      select: Object.fromEntries(whitelist.map(k => [k, true]))
    })
    if (!before) return NextResponse.json({ error: 'Club not found' }, { status: 404 })

    const body = await req.json()
    const allowed: Record<string, unknown> = {}
    for (const key of whitelist) { if (key in body) allowed[key] = body[key] }

    const club = await prisma.club.update({ where: { id }, data: allowed })

    const diff = getDiff(before, allowed)
    if (diff) {
      writeAudit(session.id, session.name, 'club.update', id, 'club',
        { diff, name: String(before.name ?? '') },
        `Updated club "${before.name}"`
      )
    }

    return NextResponse.json(club)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageClubs(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    await prisma.club.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
