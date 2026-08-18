import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId } from '@/lib/city'

// The viewer's own Guide rows — powers the saved panel on the guide homepage.
// Member-only; the homepage island skips the fetch for guests entirely.
//
// Scoped to one city. It used to return every row the member had anywhere and
// leave the filtering to the client, which counted completions from other
// cities under the city being viewed.
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ?city=<id> from the guide page (it has already resolved one); otherwise the
  // viewer's own city, so a direct call is scoped too rather than unbounded.
  const wanted = new URL(req.url).searchParams.get('cityId')?.trim()
  const cityId = wanted || await resolveCityId(session)

  const rows = await prisma.guideSave.findMany({
    where:  { userId: session.id, cityId, OR: [{ saved: true }, { recommended: true }, { done: true }] },
    select: { slug: true, saved: true, recommended: true, done: true },
  })
  return NextResponse.json({ saves: rows, cityId })
}
