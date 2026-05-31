import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

// GET /api/admin/campaigns/[id]/prizes — prizes scoped to this
// campaign. Mutating verbs (POST/PATCH/DELETE) reuse the existing
// /api/admin/cup/prizes endpoints; they take ids in the body.

type Params = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'

export async function GET(_: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id: campaignId } = await params

  const prizes = await prisma.cupPrize.findMany({
    where:   { campaignId },
    orderBy: [{ status: 'asc' }, { rank: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true, title: true, description: true, imageUrl: true,
      rank: true, status: true, sponsorId: true,
      sponsor:    { select: { id: true, name: true, logoUrl: true } },
      awardedTo:  { select: { id: true, name: true } },
      awardedAt:  true, createdAt: true, updatedAt: true,
    },
  })
  return NextResponse.json({ prizes })
}
