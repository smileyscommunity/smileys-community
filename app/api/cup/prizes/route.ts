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
  const prizes = await prisma.cupPrize.findMany({
    where:   { status: 'active' },
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
