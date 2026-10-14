import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

// CSV of every partnership record (archived included). Admin-only; fees,
// commission terms and internal notes are in it. Amounts are exported as the
// AGREED figures only — received payments are a separate record.
function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s = v instanceof Date ? v.toISOString() : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const COLUMNS = [
  'createdAt', 'organizer', 'contactName', 'contactEmail', 'website', 'stage', 'type', 'campaignName', 'eventId', 'postId',
  'deliverables', 'startDate', 'endDate', 'feeAmount', 'feeCurrency', 'commissionType', 'commissionRate', 'commissionCurrency',
  'commissionBasis', 'reportingTerms', 'paymentTerms', 'paymentStatus', 'followUpDate', 'archivedAt', 'internalNotes',
] as const

export async function GET() {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const rows = await prisma.partnership.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  const csv = [COLUMNS.join(','), ...rows.map(r => COLUMNS.map(c => cell(r[c])).join(','))].join('\r\n')
  writeAudit(session.id, session.name, 'partnership.export', 'all', 'partnership', { rows: rows.length })
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="smileys-partnerships-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
