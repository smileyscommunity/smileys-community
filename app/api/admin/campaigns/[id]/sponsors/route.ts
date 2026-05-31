import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

// GET /api/admin/campaigns/[id]/sponsors — sponsors scoped to this
// campaign. Mirror of /api/admin/cup/sponsors but filtered by
// campaignId so the campaign-detail Board panel stays clean as we
// add more campaigns. Mutating verbs (POST/PATCH/DELETE) live on
// the existing global routes — they take ids in the body so
// scoping there isn't necessary.

type Params = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'

export async function GET(_: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id: campaignId } = await params

  const sponsors = await prisma.cupSponsor.findMany({
    where:   { campaignId },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    select: {
      id: true, slug: true, name: true, blurb: true,
      logoUrl: true, websiteUrl: true, instagramUrl: true,
      status: true, createdAt: true, updatedAt: true,
      addedBy: { select: { id: true, name: true } },
      _count:  { select: { prizes: true } },
    },
  })
  return NextResponse.json({ sponsors })
}
