import { canManageBlacklist } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

export async function DELETE(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageBlacklist(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params

    // AD1 fix: snapshot the entry before deletion + write a
    // global audit row. The blacklist is a security mechanism —
    // removing an entry means the previously-banned email/phone/
    // fingerprint can apply or register again. Without audit,
    // there's no trail of who removed which ban and when.
    // Compliance + investigation gap.
    const snapshot = await prisma.blacklist.findUnique({
      where: { id },
      select: { id: true, email: true, phone: true, name: true, fingerprint: true,
                ipAddress: true, reason: true, bannedBy: true, createdAt: true },
    })
    if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.blacklist.delete({ where: { id } })

    const identifier = snapshot.email ?? snapshot.phone ?? snapshot.fingerprint ?? snapshot.ipAddress ?? 'unknown'
    writeAudit(session.id, session.name, 'blacklist.remove', id, 'blacklist',
      {
        email:       snapshot.email,
        phone:       snapshot.phone,
        name:        snapshot.name,
        fingerprint: snapshot.fingerprint,
        ipAddress:   snapshot.ipAddress,
        reason:      snapshot.reason,
        bannedBy:    snapshot.bannedBy,
        createdAt:   snapshot.createdAt.toISOString(),
      },
      `Blacklist entry removed (${identifier} — was: ${snapshot.reason})`,
    )

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
