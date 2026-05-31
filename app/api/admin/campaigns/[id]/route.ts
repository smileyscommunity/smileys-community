import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

// GET /api/admin/campaigns/[id] — single campaign + counts
//
// Previously the campaign-detail admin page fetched the full
// /api/admin/campaigns list and ran Array.find() in JS to locate
// the one it needed. Wasteful and stale-prone — adding this
// dedicated endpoint lets the page fetch exactly the row it
// renders (plus the same _count chips the list shows).
//
// Mutating verbs (PATCH/DELETE) still live on the collection
// route at /api/admin/campaigns since they accept the id in the
// body. Splitting them out would be cleaner long-term but isn't
// part of this change.

type Params = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'

export async function GET(_: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  const campaign = await prisma.campaign.findUnique({
    where:  { id },
    select: {
      id: true, slug: true, name: true, emoji: true, tagline: true, description: true,
      coverImage: true, status: true, routeSlug: true, hasFixtures: true,
      startsAt: true, endsAt: true, createdAt: true, updatedAt: true,
      _count: { select: { sponsors: true, prizes: true, donations: true } },
    },
  })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ campaign })
}
