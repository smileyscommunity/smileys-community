import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

// GET /api/admin/campaigns/[id]/audit — recent admin actions
// relevant to this campaign. Two filters merged client-side:
//   (a) campaign.* actions where targetId === campaignId
//   (b) cup.* actions globally (today we have one cup campaign,
//       so this is fine; once a second tournament lands we'd
//       store campaignId in audit.meta and filter there)
//
// Capped at 100 rows — admin can scroll the page list directly
// from /admin/audit-log for a full archive.

type Params = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'

export async function GET(_: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id: campaignId } = await params

  const entries = await prisma.auditLog.findMany({
    where:   {
      OR: [
        { AND: [{ action: { startsWith: 'campaign.' } }, { targetId: campaignId }] },
        { action: { startsWith: 'cup.' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take:    100,
    select: {
      id: true, adminName: true, action: true,
      description: true, targetType: true, targetId: true,
      meta: true, createdAt: true,
    },
  })
  return NextResponse.json({ entries })
}
