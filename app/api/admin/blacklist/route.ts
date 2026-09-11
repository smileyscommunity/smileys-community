import { canManageBlacklist } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

export async function GET() {
  try {
    const session = await getSession()
    if (!session || !canManageBlacklist(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const list = await prisma.blacklist.findMany({ orderBy: { createdAt: 'desc' } })
    return NextResponse.json(list)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !canManageBlacklist(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { email, phone, name, reason, fingerprint, ipAddress } = await req.json()
    if (!reason) return NextResponse.json({ error: 'Reason required' }, { status: 400 })
    const entry = await prisma.blacklist.create({
      data: { email: email || null, phone: phone || null, name: name || null, fingerprint: fingerprint || null, ipAddress: ipAddress || null, reason, bannedBy: session.id },
    })
    // Removal was audited; adding — the more consequential act — was not.
    writeAudit(session.id, session.name, 'blacklist.add', entry.id, 'blacklist',
      { email: entry.email, phone: entry.phone, name: entry.name, reason },
      `Blacklisted ${entry.email ?? entry.phone ?? entry.name ?? entry.id} — ${reason}`,
    )
    return NextResponse.json(entry)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
