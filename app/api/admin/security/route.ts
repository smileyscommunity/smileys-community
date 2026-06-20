import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

// GET /api/admin/security — overview payload for /admin/security. Bundles
// 2FA status + backup-codes-remaining + active-session count so the page
// only does one round-trip on load. The dedicated endpoints (sessions,
// backup-codes) still exist for the per-action views.
//
// Intentionally uses a raw role check instead of isAdmin/isAdminOrModerator:
// those helpers require totpEnabled, but this endpoint must be reachable by
// admins/mods who haven't enrolled yet so they can complete the 2FA setup flow.
export async function GET() {
  const session = await getSession()
  if (!session || (session.role !== 'admin' && session.role !== 'moderator')) {
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
