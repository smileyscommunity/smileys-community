import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/cup/trending
//
// Aggregates the championPick + semifinalist picks across every
// CupBracketPick row and returns the top picks as %s of the
// total. Drives the "trending picks" tile on /cup — social proof
// for visitors and FOMO for members on the fence.
//
// Public read. No userId ever leaves the server; only the
// aggregate counts.

export const dynamic = 'force-dynamic'

export async function GET() {
  const brackets = await prisma.cupBracketPick.findMany({
    select: { championPick: true, semifinalists: true },
  })
  const total = brackets.length

  if (total === 0) {
    return NextResponse.json({
      total: 0,
      champions: [],
      semifinalists: [],
      lastUpdated: new Date().toISOString(),
    })
  }

  // Tally champions
  const championCounts = new Map<string, number>()
  for (const b of brackets) {
    championCounts.set(b.championPick, (championCounts.get(b.championPick) ?? 0) + 1)
  }

  // Tally semifinalists (each bracket contributes 4)
  const sfCounts = new Map<string, number>()
  for (const b of brackets) {
    for (const code of b.semifinalists) {
      sfCounts.set(code, (sfCounts.get(code) ?? 0) + 1)
    }
  }

  function toRanked(map: Map<string, number>, take: number) {
    return Array.from(map.entries())
      .map(([code, count]) => ({ code, count, pct: Math.round((count / total) * 100) }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
      .slice(0, take)
  }

  return NextResponse.json({
    total,
    champions:     toRanked(championCounts, 5),
    semifinalists: toRanked(sfCounts, 8),
    lastUpdated:   new Date().toISOString(),
  })
}
