import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveTargetCityId } from '@/lib/city'
import { canManagePartners, isAdmin, failClosedCityId } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { requireStepUp } from '@/lib/stepUp'

export async function GET() {
  const session = await getSession()
  if (!session || !canManagePartners(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const partners = await prisma.partner.findMany({
    // Moderators: their own city's partners. Admins: all.
    where:   isAdmin(session) ? {} : { cityId: failClosedCityId(session) },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      users: {
        select: { id: true, name: true, email: true }
      },
      city: { select: { name: true, slug: true } },
    }
  })
  return NextResponse.json(partners)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canManagePartners(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { name, category, discount, address, neighborhood, cityId: requestedCityId } = body

  if (!name || !category || !discount || !address || !neighborhood) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Explicit cityId wins (validated + canActInCity-gated); omitted keeps the
  // old behaviour — the creator's own context via resolveCityId.
  const target = await resolveTargetCityId(session, requestedCityId)
  if ('error' in target) {
    return NextResponse.json({ error: target.error }, { status: target.status })
  }

  const partner = await prisma.partner.create({
    data: {
      name,
      cityId: target.cityId,
      category,
      discount,
      address,
      neighborhood,
      isActive: true,
    },
  })

  return NextResponse.json(partner)
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // A destructive account change, like deleting a club: step-up where 2FA applies.
  const stepUp = requireStepUp(session)
  if (stepUp) return stepUp

  const { id } = await req.json().catch(() => ({}))
  if (!id || typeof id !== 'string') return NextResponse.json({ error: 'ID required' }, { status: 400 })

  // Snapshot the partner + linked users before delete so the audit row
  // records the business record and how many accounts were demoted.
  const snapshot = await prisma.partner.findUnique({
    where: { id },
    select: { id: true, name: true, category: true, discount: true, isActive: true,
              createdAt: true, _count: { select: { users: true } } },
  })
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The confirm promised "assigned users will revert to member role"; the
  // delete only removed the partner row. The foreign key nulled partnerId and
  // left role 'partner', and nothing bumped tokenVersion, so those accounts
  // kept a partner session with no partner behind it. Demote, unlink, end the
  // sessions and delete in one transaction.
  const [demoted] = await prisma.$transaction([
    prisma.user.updateMany({
      where: { partnerId: id, role: 'partner' },
      data:  { role: 'member', partnerId: null, tokenVersion: { increment: 1 } },
    }),
    prisma.user.updateMany({ where: { partnerId: id }, data: { partnerId: null } }),
    prisma.partner.delete({ where: { id } }),
  ])

  writeAudit(session.id, session.name, 'partner.delete', id, 'partner',
    { name: snapshot.name, category: snapshot.category, discount: snapshot.discount,
      isActive: snapshot.isActive, createdAt: snapshot.createdAt.toISOString(),
      linkedUserCount: snapshot._count.users, demotedToMember: demoted.count },
    `Deleted partner "${snapshot.name}" (${snapshot.category}${demoted.count ? ` — ${demoted.count} account${demoted.count === 1 ? '' : 's'} moved back to member`: ''})`,
  )

  return NextResponse.json({ ok: true })
}
