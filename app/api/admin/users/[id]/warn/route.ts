import { canManageUsers } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { writeAudit } from '@/lib/audit'

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

    const user = await prisma.user.update({
      where: { id },
      data: { warningCount: { increment: 1 } },
      select: { name: true, warningCount: true }
    })

    // Create a persistent admin note about the warning
    await prisma.adminNote.create({
      data: {
        userId:    id,
        adminId:   session.id,
        adminName: session.name,
        text:      `⚠️ Formal Warning #${user.warningCount}: ${reason.trim()}`,
      }
    })

    // Notify the user
    await createNotification(
      id,
      'rsvp', // Using rsvp type as a general alert type for now
      'Official Warning ⚠️',
      `You have received a formal warning: ${reason.trim()}. Repeated violations may lead to account suspension.`,
    )

    // Audit log
    await writeAudit(session.id, session.name, 'user.warn', id, 'user',
      { reason: reason.trim(), warningCount: user.warningCount, name: user.name },
      `Issued formal warning #${user.warningCount} to ${user.name} — ${reason.trim()}`
    )

    return NextResponse.json({ ok: true, warningCount: user.warningCount })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
