import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId } from '@/lib/city'
import { canManagePartners, isAdmin } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

export async function GET() {
  const session = await getSession()
  if (!session || !canManagePartners(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const partners = await prisma.partner.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      users: {
        select: { id: true, name: true, email: true }
      }
    }
  })
  return NextResponse.json(partners)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canManagePartners(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { name, category, discount, address, neighborhood } = body

  if (!name || !category || !discount || !address || !neighborhood) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const partner = await prisma.partner.create({
    data: {
      name,
      cityId: await resolveCityId(session),
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

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

  // Snapshot the partner + linked users before delete so the audit
  // row records both the business record and any role demotions
  // that cascaded (partner-linked users won't auto-revert their
  // role on this hard delete — flagging the count helps follow-up
  // cleanup if needed).
  const snapshot = await prisma.partner.findUnique({
    where: { id },
    select: { id: true, name: true, category: true, discount: true, isActive: true,
              createdAt: true, _count: { select: { users: true } } },
  })
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.partner.delete({ where: { id } })

  writeAudit(session.id, session.name, 'partner.delete', id, 'partner',
    { name: snapshot.name, category: snapshot.category, discount: snapshot.discount,
      isActive: snapshot.isActive, createdAt: snapshot.createdAt.toISOString(),
      linkedUserCount: snapshot._count.users },
    `Deleted partner "${snapshot.name}" (${snapshot.category}${snapshot._count.users ? ` — ${snapshot._count.users} linked user${snapshot._count.users === 1 ? '' : 's'} now orphaned`: ''})`,
  )

  return NextResponse.json({ ok: true })
}
