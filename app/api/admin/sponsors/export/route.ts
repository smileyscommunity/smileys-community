import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

// CSV of every sponsor lead and partnership enquiry (archived included).
// Admin-only: rows carry contact details, stated budgets and deal values.
// Scrubbed rows export as stored ('[removed]'), never the original contact.

// Spreadsheet formulas: a cell starting with = + - @ is prefixed with a quote
// so a hostile enquiry cannot execute when the export is opened.
function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s = v instanceof Date ? v.toISOString() : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const COLUMNS = [
  'createdAt', 'source', 'status', 'name', 'email', 'company', 'format',
  'eventName', 'eventDate', 'eventVenue', 'eventWebsite', 'budgetRange',
  'dealValue', 'currency', 'archivedAt', 'adminNotes', 'message',
] as const

export async function GET() {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await prisma.sponsorLead.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  const csv = [COLUMNS.join(','), ...rows.map(r => COLUMNS.map(c => cell(r[c])).join(','))].join('\r\n')
  writeAudit(session.id, session.name, 'sponsor_lead.export', 'all', 'sponsor_lead', { rows: rows.length })

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="smileys-partnership-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
