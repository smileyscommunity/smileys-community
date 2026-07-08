import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

// GET  — returns the full list of saved member IDs for the current user.
// POST — body { memberId } — toggles save on/off, returns { saved: boolean }.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const saves = await prisma.memberSave.findMany({
    where:  { userId: session.id },
    select: { savedId: true },
  })

  return NextResponse.json({ savedIds: saves.map(s => s.savedId) })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`member-save:${session.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { memberId } = await req.json()
  if (!memberId || typeof memberId !== 'string') {
    return NextResponse.json({ error: 'memberId required' }, { status: 400 })
  }
  if (memberId === session.id) {
    return NextResponse.json({ error: 'Cannot save yourself' }, { status: 400 })
  }

  // Verify the target is an approved member (not banned / pending).
  const target = await prisma.user.findUnique({
    where:  { id: memberId },
    select: { status: true },
  })
  if (!target || target.status !== 'approved') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const existing = await prisma.memberSave.findUnique({
    where: { userId_savedId: { userId: session.id, savedId: memberId } },
  })

  if (existing) {
    await prisma.memberSave.delete({
      where: { userId_savedId: { userId: session.id, savedId: memberId } },
    })
    return NextResponse.json({ saved: false })
  } else {
    try {
      await prisma.memberSave.create({
        data: { userId: session.id, savedId: memberId },
      })
    } catch (e) {
      // P2002 (unique violation) = a concurrent double-tap already created the
      // save. The toggle is idempotent, so swallow it and report saved.
      if (!(e && typeof e === 'object' && (e as { code?: string }).code === 'P2002')) throw e
    }
    return NextResponse.json({ saved: true })
  }
}
