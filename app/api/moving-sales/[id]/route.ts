import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { safeNeighborhoodFor } from '@/lib/neighborhoodsDb'

type Params = { params: Promise<{ id: string }> }

const PHOTO_RE = /^\/app\/api\/files\/[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/

// Owner lifecycle: mark items claimed, close or remove the sale, or (owner/
// admin) edit the sale's own fields — date, neighborhood, note, photo, and
// the item list itself. Previously this only covered claim-toggling and
// status changes, so an admin catching a bad post (wrong neighborhood, a
// typo, an inappropriate photo) had no fix short of removing the whole
// thing outright.
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const sale = await prisma.movingSale.findUnique({ where: { id }, select: { userId: true, cityId: true } })
  if (!sale) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (sale.userId !== session.id && !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { itemId, claimed, status, leavingOn, neighborhood, note, photo, items } = body

  if (typeof itemId === 'string' && typeof claimed === 'boolean') {
    // updateMany scoped by saleId so an itemId from another sale is a no-op.
    await prisma.movingSaleItem.updateMany({ where: { id: itemId, saleId: id }, data: { claimed } })
    return NextResponse.json({ ok: true })
  }
  if (status === 'done' || status === 'removed') {
    await prisma.movingSale.update({ where: { id }, data: { status } })
    return NextResponse.json({ ok: true })
  }

  // Full edit — same validation as POST /api/moving-sales.
  if (leavingOn !== undefined || items !== undefined) {
    const data: Record<string, unknown> = {}

    if (leavingOn !== undefined) {
      if (typeof leavingOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(leavingOn)) {
        return NextResponse.json({ error: 'When are you leaving?' }, { status: 400 })
      }
      data.leavingOn = leavingOn
    }
    if (neighborhood !== undefined) {
      data.neighborhood = await safeNeighborhoodFor(sale.cityId, neighborhood)
    }
    if (note !== undefined) {
      data.note = typeof note === 'string' ? note.trim().slice(0, 500) || null : null
    }
    if (photo !== undefined) {
      data.photo = typeof photo === 'string' && PHOTO_RE.test(photo) ? photo : null
    }

    if (items !== undefined) {
      if (!Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ error: 'Add at least one item' }, { status: 400 })
      }
      // Items carrying an existing id are updated in place (preserves
      // `claimed`); anything else is a new row. Existing items whose id
      // isn't in the submitted list were removed by the editor.
      const safeItems = items.slice(0, 20).flatMap((it: unknown) => {
        if (!it || typeof it !== 'object') return []
        const name  = typeof (it as { name?: unknown }).name === 'string' ? (it as { name: string }).name.trim().slice(0, 80) : ''
        const price = typeof (it as { price?: unknown }).price === 'string' ? (it as { price: string }).price.trim().slice(0, 40) || null : null
        const existingId = typeof (it as { id?: unknown }).id === 'string' ? (it as { id: string }).id : null
        return name ? [{ id: existingId, name, price }] : []
      })
      if (safeItems.length === 0) return NextResponse.json({ error: 'Add at least one item' }, { status: 400 })

      const keepIds = safeItems.filter(it => it.id).map(it => it.id as string)
      await prisma.$transaction([
        prisma.movingSaleItem.deleteMany({ where: { saleId: id, id: { notIn: keepIds.length ? keepIds : ['__none__'] } } }),
        ...safeItems.map(it => it.id
          ? prisma.movingSaleItem.updateMany({ where: { id: it.id, saleId: id }, data: { name: it.name, price: it.price } })
          : prisma.movingSaleItem.create({ data: { saleId: id, name: it.name, price: it.price } })
        ),
      ])
    }

    if (Object.keys(data).length > 0) {
      await prisma.movingSale.update({ where: { id }, data })
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
}
