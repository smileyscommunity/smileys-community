import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

// The viewer's own Guide rows — powers the "My Istanbul" section on the
// guide homepage. Member-only; the homepage island skips the fetch for
// guests entirely.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await prisma.guideSave.findMany({
    where:  { userId: session.id, OR: [{ saved: true }, { recommended: true }, { done: true }] },
    select: { slug: true, saved: true, recommended: true, done: true },
  })
  return NextResponse.json({ saves: rows })
}
