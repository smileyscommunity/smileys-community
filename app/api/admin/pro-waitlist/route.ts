import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

const STATUSES = ['waitlisted', 'invited', 'converted', 'declined']

// Admin view of the Smileys Pro waitlist. Sortable by createdAt asc
// so admins outreach in order. Position is computed for each row so
// the UI can show "founder #N" badges identically to the public page.
export async function GET() {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const entries = await prisma.proWaitlistEntry.findMany({
    orderBy: { createdAt: 'asc' },
    take: 500,
  })

  const summary = {
    total:      entries.length,
    founders:   entries.slice(0, 100).length,
    converted:  entries.filter(e => e.status === 'converted').length,
    invited:    entries.filter(e => e.status === 'invited').length,
  }

  // Position is just index+1 since we ordered by createdAt asc.
  return NextResponse.json({
    entries: entries.map((e, i) => ({ ...e, position: i + 1, isFounder: i < 100 })),
    summary,
  })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { id, status, adminNotes } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const current = await prisma.proWaitlistEntry.findUnique({ where: { id } })
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const data: { status?: string; adminNotes?: string | null } = {}
  if (status !== undefined) {
    if (!STATUSES.includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    data.status = status
  }
  if (adminNotes !== undefined) {
    if (adminNotes !== null && typeof adminNotes !== 'string') {
      return NextResponse.json({ error: 'Invalid notes' }, { status: 400 })
    }
    data.adminNotes = adminNotes === null ? null : adminNotes.slice(0, 2000)
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const updated = await prisma.proWaitlistEntry.update({ where: { id }, data })
  writeAudit(session.id, session.name, 'pro_waitlist.update', id, 'pro_waitlist_entry', {
    email: current.email,
    ...(data.status !== undefined && { fromStatus: current.status, toStatus: data.status }),
  })
  return NextResponse.json(updated)
}
