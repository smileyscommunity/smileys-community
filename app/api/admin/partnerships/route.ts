import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { STAGE_VALUES, validatePartnershipInput } from '@/lib/partnerships'

// Partnership records behind /admin/partnerships. Admin-only: rows carry
// contact details, fees, commission terms and internal notes. Nothing here
// (or anywhere that reads these rows) sends email — moving a record to
// "Email Sent" only records that a person sent one.
const PAGE_SIZE = 100

async function requireAdmin() {
  const session = await getSession()
  return session && isAdmin(session) ? session : null
}

export async function GET(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sp = req.nextUrl.searchParams
  const stage = STAGE_VALUES.includes(sp.get('stage') ?? '') ? sp.get('stage')! : null
  const archived = sp.get('archived') === '1'
  const due = sp.get('due') === '1'
  const q = (sp.get('q') ?? '').trim().slice(0, 100)
  const today = new Date().toISOString().slice(0, 10)

  const scope: Prisma.PartnershipWhereInput = { archivedAt: archived ? { not: null } : null }
  const where: Prisma.PartnershipWhereInput = {
    ...scope,
    ...(stage ? { stage } : {}),
    ...(due ? { followUpDate: { lte: today }, stage: { notIn: ['closed', 'active_partner'] } } : {}),
    ...(q ? { OR: ['organizer', 'contactName', 'contactEmail', 'campaignName'].map(f => ({ [f]: { contains: q, mode: 'insensitive' as const } })) } : {}),
  }
  const [rows, byStage, dueCount] = await Promise.all([
    prisma.partnership.findMany({ where, orderBy: [{ followUpDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }], take: PAGE_SIZE }),
    prisma.partnership.groupBy({ by: ['stage'], where: scope, _count: { _all: true } }),
    prisma.partnership.count({ where: { archivedAt: null, followUpDate: { lte: today }, stage: { notIn: ['closed', 'active_partner'] } } }),
  ])
  return NextResponse.json({
    partnerships: rows,
    counts: { byStage: Object.fromEntries(byStage.map(c => [c.stage, c._count._all])), dueFollowUps: dueCount },
    today,
  })
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  // "Start from an enquiry": copy the organizer and contact from the lead the
  // admin already received. A scrubbed lead has no contact left to copy.
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  let seed: Record<string, unknown> = {}
  if (typeof b.leadId === 'string' && b.leadId) {
    const lead = await prisma.sponsorLead.findUnique({ where: { id: b.leadId } })
    if (!lead) return NextResponse.json({ error: 'Enquiry not found' }, { status: 404 })
    const existing = await prisma.partnership.findFirst({ where: { leadId: lead.id }, select: { id: true } })
    if (existing) return NextResponse.json({ error: 'A partnership record already exists for this enquiry.', id: existing.id }, { status: 409 })
    seed = {
      leadId: lead.id, organizer: lead.company, stage: 'replied',
      ...(lead.scrubbedAt ? {} : { contactName: lead.name, contactEmail: lead.email }),
      campaignName: lead.eventName ?? undefined,
      website: lead.eventWebsite && /^https:\/\//i.test(lead.eventWebsite) ? lead.eventWebsite : undefined,
      startDate: lead.eventDate ?? undefined,
    }
  }
  const v = validatePartnershipInput({ ...seed, ...b }, false)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

  const row = await prisma.partnership.create({ data: { ...(v.data as Prisma.PartnershipUncheckedCreateInput), organizer: v.data.organizer as string, createdById: session.id } })
  writeAudit(session.id, session.name, 'partnership.create', row.id, 'partnership', { organizer: row.organizer, stage: row.stage })
  return NextResponse.json(row, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const current = await prisma.partnership.findUnique({ where: { id } })
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const v = validatePartnershipInput(Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'id' && k !== 'archived')), true)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
  const data: Prisma.PartnershipUncheckedUpdateInput = { ...(v.data as Prisma.PartnershipUncheckedUpdateInput) }
  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean') return NextResponse.json({ error: 'Invalid archived flag' }, { status: 400 })
    data.archivedAt = body.archived ? new Date() : null
  }
  // Cross-field check against the stored row: a rate typed alone must still fit the stored type.
  const type = (v.data.commissionType ?? current.commissionType) as string | null
  const rate = (v.data.commissionRate ?? current.commissionRate) as number | null
  if (type === 'percentage' && rate !== null && rate > 100) return NextResponse.json({ error: 'A percentage commission cannot exceed 100.' }, { status: 400 })
  const sd = (v.data.startDate ?? current.startDate) as string | null, ed = (v.data.endDate ?? current.endDate) as string | null
  if (sd && ed && ed < sd) return NextResponse.json({ error: 'End date is before the start date.' }, { status: 400 })
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const updated = await prisma.partnership.update({ where: { id }, data })
  writeAudit(session.id, session.name, 'partnership.update', id, 'partnership', {
    organizer: current.organizer,
    fields: Object.keys(data),
    ...(data.stage !== undefined && { fromStage: current.stage, toStage: data.stage }),
    ...(data.paymentStatus !== undefined && { fromPayment: current.paymentStatus, toPayment: data.paymentStatus }),
  })
  return NextResponse.json(updated)
}
