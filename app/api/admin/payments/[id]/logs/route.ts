import { canManagePayments } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

type Params = { params: Promise<{ id: string }> }

export async function GET(_: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !canManagePayments(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const logs = await prisma.paymentLog.findMany({
    where: { paymentId: id },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(logs)
}
