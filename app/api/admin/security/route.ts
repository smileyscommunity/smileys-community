import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'

// GET /api/admin/security — overview payload for /admin/security. Bundles
// 2FA status + backup-codes-remaining + active-session count so the page
// only does one round-trip on load. The dedicated endpoints (sessions,
// backup-codes) still exist for the per-action views.
export async function GET() {
  const session = await getSession()
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [user, backupCodesRemaining, activeSessions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.id },
      select: { totpEnabled: true },
    }),
    prisma.totpBackupCode.count({
      where: { userId: session.id, used: false },
    }),
    prisma.session.count({
      where: {
        userId:    session.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    }),
  ])

  return NextResponse.json({
    totpEnabled:          user?.totpEnabled ?? false,
    backupCodesRemaining: user?.totpEnabled ? backupCodesRemaining : 0,
    activeSessions,
  })
}
