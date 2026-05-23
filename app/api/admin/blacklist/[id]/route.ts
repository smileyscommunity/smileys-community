import { canManageBlacklist } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

type Params = { params: Promise<{ id: string }> }

export async function DELETE(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageBlacklist(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    await prisma.blacklist.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
