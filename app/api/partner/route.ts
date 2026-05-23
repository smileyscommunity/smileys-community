import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManagePartner } from '@/lib/access'

export async function GET() {
  const session = await getSession()
  if (!session || !session.partnerId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const partner = await prisma.partner.findUnique({
    where: { id: session.partnerId },
  })

  if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })

  return NextResponse.json(partner)
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !session.partnerId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const whitelist = ['name', 'category', 'discount', 'address', 'neighborhood', 'website', 'instagram', 'logo', 'coverImage']
  const data: Record<string, any> = {}
  
  for (const key of whitelist) {
    if (key in body) data[key] = body[key]
  }

  const updated = await prisma.partner.update({
    where: { id: session.partnerId },
    data,
  })

  return NextResponse.json(updated)
}
