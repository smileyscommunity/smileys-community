import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

// A member's own stories: waiting, declined, or live. Submitting used to be
// a one-way door: nothing on the site showed a member that their story was
// received, still waiting, declined or live — the only read path that knew
// 'submitted' existed was the admin queue. Not 'draft': that is a staff
// state (a story being polished, or staff's own unfinished piece), and the
// Withdraw button next to each row deletes.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const stories = await prisma.post.findMany({
    where:   { authorId: session.id, kind: 'community', status: { in: ['submitted', 'declined', 'published'] } },
    orderBy: { createdAt: 'desc' },
    take:    50,
    select:  { id: true, title: true, slug: true, status: true, createdAt: true, publishedAt: true },
  })
  return NextResponse.json({ stories })
}
