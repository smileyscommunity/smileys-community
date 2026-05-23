import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManagePartners, isAdmin } from '@/lib/access'

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

  await prisma.partner.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
