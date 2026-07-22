import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator } from '@/lib/access'

type Params = { params: Promise<{ id: string }> }

// POST /api/admin/cities/[id]/hosts — grant a member city-host status by email.
// Re-activates a previously revoked grant rather than erroring on the unique
// (userId, cityId) constraint.
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: cityId } = await params
  // Granting city-host status confers event-hosting authority in that city;
  // a moderator may only do it for their own city, admins for any.
  if (!isAdmin(session) && session.cityId !== cityId) {
    return NextResponse.json({ error: 'Cross-city host management is admin-only' }, { status: 403 })
  }
  const { email } = await req.json()
  if (typeof email !== 'string' || !email.trim()) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  const [city, user] = await Promise.all([
    prisma.city.findUnique({ where: { id: cityId }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true, name: true, email: true } }),
  ])
  if (!city) return NextResponse.json({ error: 'City not found' }, { status: 404 })
  if (!user) return NextResponse.json({ error: `No member found with email "${email.trim()}"` }, { status: 404 })

  const host = await prisma.cityHost.upsert({
    where:  { userId_cityId: { userId: user.id, cityId } },
    update: { status: 'approved', revokedAt: null, grantedBy: session.id, grantedAt: new Date() },
    create: { userId: user.id, cityId, status: 'approved', grantedBy: session.id },
    select: { id: true },
  })

  return NextResponse.json({ cityHostId: host.id, id: user.id, name: user.name, email: user.email }, { status: 201 })
}

// DELETE /api/admin/cities/[id]/hosts?cityHostId=... — revoke a city-host grant.
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await params // params resolved for symmetry; revoke targets the host row directly.
  const cityHostId = req.nextUrl.searchParams.get('cityHostId')
  if (!cityHostId) return NextResponse.json({ error: 'cityHostId is required' }, { status: 400 })

  // Load the grant's city first so a moderator can't revoke another city's host
  // by guessing/enumerating cityHostIds.
  const target = await prisma.cityHost.findUnique({ where: { id: cityHostId }, select: { cityId: true } })
  if (!target) return NextResponse.json({ error: 'Host grant not found' }, { status: 404 })
  if (!isAdmin(session) && session.cityId !== target.cityId) {
    return NextResponse.json({ error: 'Cross-city host management is admin-only' }, { status: 403 })
  }

  await prisma.cityHost.update({
    where: { id: cityHostId },
    data:  { revokedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
