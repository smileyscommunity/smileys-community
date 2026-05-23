import { canManagePayments } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { writeAudit } from '@/lib/audit'
import { sendRefundEmail } from '@/lib/email'

async function requireAdmin() {
  const session = await getSession()
  if (!session || !canManagePayments(session)) return null
  return session
}

export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const payments = await prisma.payment.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      user:  { select: { name: true, email: true } },
      event: { select: { title: true, emoji: true } },
    },
  })
  return NextResponse.json(payments)
}

export async function PATCH(req: NextRequest) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id, status, notes } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const current = await prisma.payment.findUnique({
    where: { id },
    select: { status: true, amount: true, currency: true },
  })

  const updated = await prisma.payment.update({
    where: { id },
    data: {
      ...(status !== undefined && { status }),
      ...(notes  !== undefined && { notes }),
    },
    include: {
      user:  { select: { name: true, email: true } },
      event: { select: { title: true, emoji: true } },
    },
  })

  if (status !== undefined && current?.status !== status) {
    await prisma.paymentLog.create({
      data: {
        paymentId: id,
        adminId:   session.id,
        adminName: session.name,
        fromStatus: current?.status ?? null,
        toStatus:   status,
        note:       notes ?? null,
      },
    })
    writeAudit(session.id, session.name, 'payment.status', id, 'payment',
      { from: current?.status, to: status },
      `Payment status changed from ${current?.status ?? '?'} to ${status}${notes ? ` — ${notes}` : ''}`,
    )

    // Email member when refunded
    if (status === 'refunded') {
      sendRefundEmail(
        updated.user.email,
        updated.user.name ?? 'Member',
        updated.event.title,
        current?.amount ?? updated.amount,
        current?.currency ?? updated.currency ?? 'TRY',
        notes,
      ).catch(() => {})
    }
  }

  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  await prisma.payment.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
