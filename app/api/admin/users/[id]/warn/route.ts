import { canManageUsers } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { writeAudit } from '@/lib/audit'
import { warnMember } from '@/lib/memberDiscipline'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageUsers(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const { reason } = await req.json()

    if (!reason?.trim()) {
      return NextResponse.json({ error: 'Warning reason is required' }, { status: 400 })
    }

    // lib/memberDiscipline — the same warning the moderation queue gives.
    const user = await warnMember({ userId: id, reason: reason.trim(), actor: { id: session.id, name: session.name } })

    return NextResponse.json({ ok: true, warningCount: user.warningCount })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
