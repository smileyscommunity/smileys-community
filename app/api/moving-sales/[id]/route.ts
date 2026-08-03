import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

type Params = { params: Promise<{ id: string }> }

// Owner lifecycle: mark items claimed, close or remove the sale.
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const sale = await prisma.movingSale.findUnique({ where: { id }, select: { userId: true } })
  if (!sale) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (sale.userId !== session.id && !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { itemId, claimed, status } = await req.json()
  if (typeof itemId === 'string' && typeof claimed === 'boolean') {
    // updateMany scoped by saleId so an itemId from another sale is a no-op.
    await prisma.movingSaleItem.updateMany({ where: { id: itemId, saleId: id }, data: { claimed } })
    return NextResponse.json({ ok: true })
  }
  if (status === 'done' || status === 'removed') {
    await prisma.movingSale.update({ where: { id }, data: { status } })
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
}
