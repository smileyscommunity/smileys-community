import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

// PATCH /api/admin/directory/reports/[id]
// body: { action: 'resolve' | 'dismiss' }
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const body = await req.json().catch(() => null) as { action?: string } | null
    const action = body?.action
    if (action !== 'resolve' && action !== 'dismiss') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
    const report = await prisma.businessReport.findUnique({
      where:  { id },
      select: { id: true, businessId: true, reason: true },
    })
    if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.businessReport.update({
      where: { id },
      data:  {
        status:       action === 'resolve' ? 'resolved' : 'dismissed',
        reviewedById: session.id,
        reviewedAt:   new Date(),
      },
    })
    await writeAudit(
      session.id, session.name,
      action === 'resolve' ? 'directory.report_resolve' : 'directory.report_dismiss',
      report.id, 'business_report',
      { businessId: report.businessId, reason: report.reason },
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Admin report PATCH error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
