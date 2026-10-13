import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
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
const PAGE_SIZE = 50
const KINDS = ['all', 'sponsors', 'partnerships'] as const
type Kind = (typeof KINDS)[number]

// Partnership = /partner-with-us (source 'partners'); everything else —
// including every older row with a NULL source — is a sponsor lead. `not`
// alone would drop the NULLs, hence the explicit OR.
function kindWhere(kind: Kind): Prisma.SponsorLeadWhereInput {
  if (kind === 'partnerships') return { source: 'partners' }
  if (kind === 'sponsors')     return { OR: [{ source: null }, { source: { not: 'partners' } }] }
  return {}
}

// Pipeline backing /admin/sponsors. Admin-only (Finance section, like
// /api/admin/payments) — leads carry deal values and company contact details.
// Filters, search and paging are server-side so the list is correct beyond the
// first page: ?kind=&status=&archived=1&q=&cursor=<lead id>
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const kind = (KINDS as readonly string[]).includes(sp.get('kind') ?? '') ? (sp.get('kind') as Kind) : 'all'
  const status = STATUSES.includes(sp.get('status') ?? '') ? sp.get('status')! : null
  const archived = sp.get('archived') === '1'
  const q = (sp.get('q') ?? '').trim().slice(0, 100)
  const cursor = sp.get('cursor')

  const scope: Prisma.SponsorLeadWhereInput = { archivedAt: archived ? { not: null } : null, AND: [kindWhere(kind)] }
  const where: Prisma.SponsorLeadWhereInput = {
    ...scope,
    ...(status ? { status } : {}),
    ...(q ? { OR: ['name', 'email', 'company', 'eventName', 'message'].map(f => ({ [f]: { contains: q, mode: 'insensitive' as const } })) } : {}),
  }

  const [rows, wonByCurrency, statusCounts, kindCounts] = await Promise.all([
    prisma.sponsorLead.findMany({
      where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    // Per currency: a lira deal and a euro deal don't add up to a number.
    // Revenue is sponsors only (partnership collaborations are mostly unpaid),
    // and counts archived deals too — archiving must not erase closed revenue.
    prisma.sponsorLead.groupBy({
      by:     ['currency'],
      where: { status: 'won', ...kindWhere('sponsors') },
      _sum:   { dealValue: true },
      _count: { _all: true },
    }),
    prisma.sponsorLead.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
    prisma.sponsorLead.groupBy({ by: ['source'], where: { archivedAt: archived ? { not: null } : null }, _count: { _all: true } }),
  ])

  const hasMore = rows.length > PAGE_SIZE
  const leads = hasMore ? rows.slice(0, PAGE_SIZE) : rows

  // Repeat enquiries: how many OTHER leads (any state) share this email.
  const emails = [...new Set(leads.map(l => l.email.toLowerCase()))]
  const sameEmail = emails.length
    ? await prisma.sponsorLead.groupBy({ by: ['email'], where: { email: { in: emails, mode: 'insensitive' } }, _count: { _all: true } })
    : []
  const dupByEmail = new Map(sameEmail.map(g => [g.email.toLowerCase(), g._count._all]))

  const partnerships = kindCounts.filter(k => k.source === 'partners').reduce((n, k) => n + k._count._all, 0)
  const total = kindCounts.reduce((n, k) => n + k._count._all, 0)

  return NextResponse.json({
    leads: leads.map(l => ({ ...l, otherFromSameEmail: Math.max(0, (dupByEmail.get(l.email.toLowerCase()) ?? 1) - 1) })),
    nextCursor: hasMore ? leads[leads.length - 1].id : null,
    counts: {
      byStatus: Object.fromEntries(statusCounts.map(c => [c.status, c._count._all])),
      byKind: { all: total, sponsors: total - partnerships, partnerships },
    },
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
  const { id, status, dealValue, currency, adminNotes, archived } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const current = await prisma.sponsorLead.findUnique({ where: { id } })
  if (!current) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const data: { status?: string; dealValue?: number | null; currency?: string; adminNotes?: string | null; archivedAt?: Date | null } = {}

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
  if (archived !== undefined) {
    if (typeof archived !== 'boolean') return NextResponse.json({ error: 'Invalid archived flag' }, { status: 400 })
    data.archivedAt = archived ? new Date() : null
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const updated = await prisma.sponsorLead.update({ where: { id }, data })

  writeAudit(session.id, session.name, 'sponsor_lead.update', id, 'sponsor_lead', {
    company: current.company,
    ...(data.status !== undefined && { fromStatus: current.status, toStatus: data.status }),
    ...(data.dealValue !== undefined && { fromValue: current.dealValue, toValue: data.dealValue }),
    ...(data.archivedAt !== undefined && { archived: data.archivedAt !== null }),
  })

  return NextResponse.json(updated)
}

// Permanent delete — for spam and test rows. Admin-only and audited with the
// company name only (the contact details go with the row). A won deal can't be
// deleted: archive it instead, so the revenue record survives.
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const lead = await prisma.sponsorLead.findUnique({ where: { id }, select: { company: true, status: true } })
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  if (lead.status === 'won') return NextResponse.json({ error: 'A won deal can\'t be deleted — archive it instead.' }, { status: 409 })
  await prisma.sponsorLead.delete({ where: { id } })
  writeAudit(session.id, session.name, 'sponsor_lead.delete', id, 'sponsor_lead', { company: lead.company, status: lead.status })
  return NextResponse.json({ ok: true })
}
