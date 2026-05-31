import { canManageClubs } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

// POST /api/admin/clubs/[id]/recount
//
// Recovery hatch when Club.memberCount drifts from the actual
// count of approved memberships. The fixed POST/PATCH/DELETE flow
// on the memberships route keeps the invariant going forward; this
// endpoint reconciles any pre-fix drift sitting in prod data.
//
// Returns { memberCount, drift } where `drift` is the delta we
// just corrected — a non-zero value here means the historical row
// was wrong. Useful for spotting which clubs had been getting
// silently miscounted.
//
// Auth: same as the rest of the club admin surface.

type Params = { params: Promise<{ id: string }> }

export async function POST(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageClubs(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params

    const club = await prisma.club.findUnique({ where: { id }, select: { memberCount: true } })
    if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const trueCount = await prisma.clubMembership.count({
      where: { clubId: id, status: 'approved' },
    })

    const drift = trueCount - club.memberCount
    if (drift === 0) {
      return NextResponse.json({ memberCount: trueCount, drift: 0 })
    }

    await prisma.club.update({ where: { id }, data: { memberCount: trueCount } })
    return NextResponse.json({ memberCount: trueCount, drift })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
