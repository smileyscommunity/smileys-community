import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

// GET /api/admin/directory/claims?status=pending|approved|rejected
// Powers the Claims tab on /admin/directory.
export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'pending'
    const where: Record<string, unknown> = {}
    if (status === 'pending' || status === 'approved' || status === 'rejected') {
      where.status = status
    }

    const claims = await prisma.businessClaim.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        business: { select: { id: true, name: true, category: true, neighborhood: true, claimedById: true } },
        claimant: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json(claims)
  } catch (e) {
    console.error('Admin claims GET error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
