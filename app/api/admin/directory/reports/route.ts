import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

// GET /api/admin/directory/reports?status=pending|resolved|dismissed
export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'pending'
    const where: Record<string, unknown> = {}
    if (status === 'pending' || status === 'resolved' || status === 'dismissed') {
      where.status = status
    }
    const reports = await prisma.businessReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        business: { select: { id: true, name: true, category: true, neighborhood: true, isApproved: true, isActive: true } },
        reporter: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    })
    return NextResponse.json(reports)
  } catch (e) {
    console.error('Admin reports GET error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
