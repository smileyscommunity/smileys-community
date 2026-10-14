import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { summarize } from '@/lib/campaignReport'

// CSV of campaign results. Default = one row per partnership (summary);
// ?entries=1 = the full ledger, one row per reported figure with its source and
// reporting date. Money is per currency and never netted. Admin-only.
function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s = v instanceof Date ? v.toISOString() : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csv = (cols: string[], rows: unknown[][]) => [cols.join(','), ...rows.map(r => r.map(cell).join(','))].join('\r\n')

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ledger = req.nextUrl.searchParams.get('entries') === '1'
  const [partnerships, entries] = await Promise.all([
    prisma.partnership.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.campaignReportEntry.findMany({ orderBy: [{ reportedAt: 'desc' }, { createdAt: 'desc' }] }),
  ])
  const name = new Map(partnerships.map(p => [p.id, p.organizer]))
  let body: string
  if (ledger) {
    body = csv(['partnership', 'kind', 'quantity', 'amount', 'currency', 'source', 'reportedAt', 'periodStart', 'periodEnd', 'note'],
      entries.map(e => [name.get(e.partnershipId) ?? e.partnershipId, e.kind, e.quantity, e.amount, e.currency, e.source, e.reportedAt, e.periodStart, e.periodEnd, e.note]))
  } else {
    const postIds = partnerships.map(p => p.postId).filter((x): x is string => !!x)
    const posts = postIds.length ? await prisma.post.findMany({ where: { id: { in: postIds } }, select: { id: true, views: true } }) : []
    const views = new Map(posts.map(p => [p.id, p.views]))
    const tags = partnerships.map(p => p.sourceTag).filter((x): x is string => !!x)
    const enq = tags.length ? await prisma.sponsorLead.groupBy({ by: ['campaignSource'], where: { campaignSource: { in: tags } }, _count: { _all: true } }) : []
    const enqBy = new Map(enq.map(g => [g.campaignSource, g._count._all]))
    body = csv(
      ['organizer', 'campaign', 'stage', 'sourceTag', 'agreedFee', 'feeCurrency', 'articleViewsCumulative', 'enquiries', 'ticketsSold_reported', 'discountRedemptions_reported', 'ticketClicks_manual', 'received_by_currency', 'expenses_by_currency', 'latestReportedAt'],
      partnerships.map(p => {
        const s = summarize(entries.filter(e => e.partnershipId === p.id))
        return [p.organizer, p.campaignName, p.stage, p.sourceTag, p.feeAmount, p.feeCurrency,
          p.postId ? views.get(p.postId) ?? '' : '', p.sourceTag ? enqBy.get(p.sourceTag) ?? 0 : '',
          s.ticketsSold ?? '', s.discountRedemptions ?? '', s.manualTicketClicks ?? '',
          s.received.map(r => `${r.currency}: fee ${r.fee}, commission ${r.commission}`).join('; '),
          s.expenses.map(x => `${x.currency}: ${x.amount}`).join('; '), s.latestReportedAt]
      }))
  }
  writeAudit(session.id, session.name, 'campaign_report.export', ledger ? 'ledger' : 'summary', 'campaign_report_entry', { rows: ledger ? entries.length : partnerships.length })
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="smileys-campaign-${ledger ? 'ledger' : 'summary'}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
