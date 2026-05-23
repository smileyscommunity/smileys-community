import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManagePartners } from '@/lib/access'

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

  await prisma.user.update({
    where: { id: userId, partnerId: id },
    data: { partnerId: null, role: 'member' },
  })

  return NextResponse.json({ ok: true })
}
