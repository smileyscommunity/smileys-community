import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManagePartners } from '@/lib/access'
import { isSafeHref } from '@/lib/safeUrl'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

// PATCH — toggle/update partner fields (isActive, discount, etc.)
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !canManagePartners(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const allowed = ['name', 'category', 'discount', 'address', 'neighborhood', 'website', 'instagram', 'isActive']
  const data: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) data[key] = body[key]
  }

  // URL fields render as <a href> on /partner and /perks — reject
  // `javascript:` / `data:` schemes. Empty string is allowed (unset).
  for (const urlKey of ['website', 'instagram'] as const) {
    if (urlKey in data && data[urlKey] && !isSafeHref(String(data[urlKey]))) {
      return NextResponse.json({ error: `${urlKey} must be https:// or a /relative path` }, { status: 400 })
    }
  }

  const partner = await prisma.partner.update({ where: { id }, data })
  return NextResponse.json(partner)
}

// POST — assign a user to this partner
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !canManagePartners(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const partner = await prisma.partner.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })

  const user = await prisma.user.update({
    where: { id: userId },
    data: { partnerId: id, role: 'partner' },
    select: { id: true, name: true, email: true },
  })

  return NextResponse.json(user)
}

// DELETE — unassign a user from this partner
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !canManagePartners(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  // Snapshot the user + partner names for the audit row so the log
  // is self-documenting (the role demotion + partner-link removal
  // is a meaningful access-control change).
  const [user, partner] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, role: true } }),
    prisma.partner.findUnique({ where: { id }, select: { name: true } }),
  ])

  await prisma.user.update({
    where: { id: userId, partnerId: id },
    data: { partnerId: null, role: 'member' },
  })

  writeAudit(session.id, session.name, 'partner.unassign_user', userId, 'user',
    { partnerId: id, partnerName: partner?.name, previousRole: user?.role, userEmail: user?.email },
    `Unassigned ${user?.name ?? userId} (${user?.email ?? ''}) from partner "${partner?.name ?? id}" — role demoted to member`,
  )

  return NextResponse.json({ ok: true })
}
