import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/cup/prizes
//
// Returns the public prize board: active prizes ordered by rank
// ASC (nulls last so spot prizes follow the podium), each with
// its sponsor when one is set. No auth — the page is public and
// the prize list is part of the visitor pitch.
//
// Lightweight (one query, ~tens of rows max) — no pagination
// needed for v1.

export const dynamic = 'force-dynamic'

export async function GET() {
  // Scope to the world-cup-2026 campaign. Routing through campaign
  // means future tournaments don't accidentally show their prizes
  // on /cup (and vice versa). The campaign lookup is one query; if
  // it doesn't exist yet (fresh DB pre-seed), return empty.
  const campaign = await prisma.campaign.findUnique({
    where:  { slug: 'world-cup-2026' },
    select: { id: true },
  })
  if (!campaign) return NextResponse.json({ prizes: [] })

  const prizes = await prisma.cupPrize.findMany({
    where:   { status: 'active', campaignId: campaign.id },
    orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],  // null ranks sort to bottom in Postgres ASC by default
    select: {
      id: true, title: true, description: true, imageUrl: true,
      rank: true, status: true,
      sponsor: { select: {
        id: true, slug: true, name: true, blurb: true,
        logoUrl: true, websiteUrl: true, instagramUrl: true,
      } },
    },
  })
  return NextResponse.json({ prizes })
}
