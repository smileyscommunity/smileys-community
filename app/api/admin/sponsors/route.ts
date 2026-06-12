import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

const STATUSES = ['new', 'contacted', 'negotiating', 'won', 'lost']

// Sponsor-lead pipeline backing /admin/sponsors. Admin-only (Finance
// section, like /api/admin/payments) — leads carry deal values and
// company contact details.
export async function GET() {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [leads, wonAgg] = await Promise.all([
    prisma.sponsorLead.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.sponsorLead.aggregate({
      where: { status: 'won' },
      _sum: { dealValue: true },
      _count: true,
    }),
  ])

  return NextResponse.json({
    leads,
    summary: {
      wonValue: wonAgg._sum.dealValue ?? 0,
      wonCount: wonAgg._count,
    },
  })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { id, status, dealValue, adminNotes } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const current = await prisma.sponsorLead.findUnique({ where: { id } })
  if (!current) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const data: { status?: string; dealValue?: number | null; adminNotes?: string | null } = {}

  if (status !== undefined) {
    if (!STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    data.status = status
  }
  if (dealValue !== undefined) {
    if (dealValue !== null && (typeof dealValue !== 'number' || !Number.isFinite(dealValue) || dealValue < 0)) {
      return NextResponse.json({ error: 'Invalid deal value' }, { status: 400 })
    }
    data.dealValue = dealValue
  }
  if (adminNotes !== undefined) {
    if (adminNotes !== null && typeof adminNotes !== 'string') {
      return NextResponse.json({ error: 'Invalid notes' }, { status: 400 })
    }
    data.adminNotes = adminNotes === null ? null : adminNotes.slice(0, 2000)
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const updated = await prisma.sponsorLead.update({ where: { id }, data })

  writeAudit(session.id, session.name, 'sponsor_lead.update', id, 'sponsor_lead', {
    company: current.company,
    ...(data.status !== undefined && { fromStatus: current.status, toStatus: data.status }),
    ...(data.dealValue !== undefined && { fromValue: current.dealValue, toValue: data.dealValue }),
  })

  return NextResponse.json(updated)
}
