import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { summarize, validateEntryInput } from '@/lib/campaignReport'
import { ticketClicksFor } from '@/lib/posthogQuery'

// Campaign results behind /admin/partnerships/reports. Admin-only.
//
// Measured here (never typed): article views (Post.views — cumulative since
// publication, one bump per browser session) and enquiries tagged with the
// partnership's source tag. Reported by someone and entered with a source and a
// date: ticket sales, redemptions, fees/commission received, expenses. Ticket
// clicks come from PostHog only if it is connected; otherwise "not connected".
async function requireAdmin() {
  const session = await getSession()
  return session && isAdmin(session) ? session : null
}

const today = () => new Date().toISOString().slice(0, 10)

async function measured(p: { postId: string | null; sourceTag: string | null }) {
  const post = p.postId ? await prisma.post.findUnique({ where: { id: p.postId }, select: { slug: true, title: true, views: true } }) : null
  const enquiries = p.sourceTag ? await prisma.sponsorLead.count({ where: { campaignSource: p.sourceTag } }) : null
  return { post, enquiries }
}

export async function GET(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = req.nextUrl.searchParams.get('id')

  if (id) {
    const p = await prisma.partnership.findUnique({ where: { id } })
    if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const [entries, m] = await Promise.all([
      prisma.campaignReportEntry.findMany({ where: { partnershipId: id }, orderBy: [{ reportedAt: 'desc' }, { createdAt: 'desc' }] }),
      measured(p),
    ])
    const posthogClicks = m.post ? await ticketClicksFor(m.post.slug) : null
    return NextResponse.json({
      partnership: { id: p.id, organizer: p.organizer, campaignName: p.campaignName, stage: p.stage, sourceTag: p.sourceTag, feeAmount: p.feeAmount, feeCurrency: p.feeCurrency, commissionType: p.commissionType, commissionRate: p.commissionRate },
      entries,
      summary: summarize(entries),
      measured: { articleTitle: m.post?.title ?? null, articleViews: m.post?.views ?? null, enquiries: m.enquiries, ticketClicksPostHog: posthogClicks, posthogConnected: !!(process.env.POSTHOG_PERSONAL_API_KEY && process.env.POSTHOG_PROJECT_ID) },
    })
  }

  const partnerships = await prisma.partnership.findMany({ where: { archivedAt: null }, orderBy: [{ updatedAt: 'desc' }], take: 200 })
  const ids = partnerships.map(p => p.id)
  const all = ids.length ? await prisma.campaignReportEntry.findMany({ where: { partnershipId: { in: ids } } }) : []
  const rows = await Promise.all(partnerships.map(async p => {
    const m = await measured(p)
    return {
      id: p.id, organizer: p.organizer, campaignName: p.campaignName, stage: p.stage, sourceTag: p.sourceTag,
      feeAmount: p.feeAmount, feeCurrency: p.feeCurrency,
      articleViews: m.post?.views ?? null, enquiries: m.enquiries,
      summary: summarize(all.filter(e => e.partnershipId === p.id)),
    }
  }))
  return NextResponse.json({ rows })
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const partnershipId = typeof body.partnershipId === 'string' ? body.partnershipId : ''
  const p = partnershipId ? await prisma.partnership.findUnique({ where: { id: partnershipId }, select: { id: true, organizer: true } }) : null
  if (!p) return NextResponse.json({ error: 'Partnership not found' }, { status: 404 })
  const v = validateEntryInput(body, today())
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
  const row = await prisma.campaignReportEntry.create({ data: { ...v.data, partnershipId: p.id, createdById: session.id } })
  writeAudit(session.id, session.name, 'campaign_report.add', row.id, 'campaign_report_entry', { partnershipId: p.id, organizer: p.organizer, kind: row.kind, source: row.source })
  return NextResponse.json(row, { status: 201 })
}

// A wrong figure is removed and re-entered; the removal is audited with what it was.
export async function DELETE(req: NextRequest) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const e = await prisma.campaignReportEntry.findUnique({ where: { id } })
  if (!e) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await prisma.campaignReportEntry.delete({ where: { id } })
  writeAudit(session.id, session.name, 'campaign_report.delete', id, 'campaign_report_entry', { partnershipId: e.partnershipId, kind: e.kind, quantity: e.quantity, amount: e.amount, currency: e.currency, source: e.source, reportedAt: e.reportedAt })
  return NextResponse.json({ ok: true })
}
