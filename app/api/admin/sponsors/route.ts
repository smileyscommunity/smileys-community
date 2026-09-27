import { NextRequest, NextResponse } from 'next/server'
import { KNOWN_CURRENCIES } from '@/lib/data'
import { roundMoney } from '@/lib/money'
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

  const [leads, wonByCurrency] = await Promise.all([
    prisma.sponsorLead.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    // Per currency: a lira deal and a euro deal don't add up to a number.
    prisma.sponsorLead.groupBy({
      by:     ['currency'],
      where:  { status: 'won' },
      _sum:   { dealValue: true },
      _count: { _all: true },
    }),
  ])

  return NextResponse.json({
    leads,
    summary: {
      won: wonByCurrency
        .map(g => ({ currency: g.currency, value: roundMoney(g._sum.dealValue), count: g._count._all }))
        .sort((a, b) => b.value - a.value),
      wonCount: wonByCurrency.reduce((n, g) => n + g._count._all, 0),
    },
  })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { id, status, dealValue, currency, adminNotes } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const current = await prisma.sponsorLead.findUnique({ where: { id } })
  if (!current) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const data: { status?: string; dealValue?: number | null; currency?: string; adminNotes?: string | null } = {}

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
  // The deal's currency — never settable before, so every deal was stored
  // as lira whatever it was agreed in.
  if (currency !== undefined) {
    if (typeof currency !== 'string' || !KNOWN_CURRENCIES.includes(currency)) {
      return NextResponse.json({ error: 'Invalid currency' }, { status: 400 })
    }
    data.currency = currency
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
