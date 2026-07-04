import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

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

  await prisma.cityHost.update({
    where: { id: cityHostId },
    data:  { revokedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
