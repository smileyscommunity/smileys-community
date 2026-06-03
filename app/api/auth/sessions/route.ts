import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

// GET /api/auth/sessions — list every active session for the caller.
// Powers the "Active devices" section in /settings so users can spot a
// rogue device (cookie theft, shared computer, etc.) and revoke it.

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await prisma.session.findMany({
    where: {
      userId:    session.id,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { lastUsedAt: 'desc' },
    select: {
      id:         true,
      userAgent:  true,
      ip:         true,
      createdAt:  true,
      lastUsedAt: true,
      expiresAt:  true,
    },
  })

  const out = rows.map(r => ({
    id:         r.id,
    userAgent:  r.userAgent,
    ip:         r.ip,
    createdAt:  r.createdAt,
    lastUsedAt: r.lastUsedAt,
    expiresAt:  r.expiresAt,
    // Mark which row corresponds to the device making this request — the
    // UI dims the "Revoke" button on this one because revoking the
    // current session is what /logout does.
    current:    r.id === session.sessionId,
  }))

  return NextResponse.json({ sessions: out })
}
