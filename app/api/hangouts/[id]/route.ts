import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

// Cancel a hangout. Host or staff only.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const hangout = await prisma.hangout.findUnique({ where: { id } })
  if (!hangout) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (hangout.userId !== session.id && !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.hangout.update({ where: { id }, data: { status: 'cancelled' } })
  return NextResponse.json({ ok: true })
}
