import { canViewAuditLog, canManageUsers } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import type { Prisma } from '@prisma/client'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !canViewAuditLog(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') ?? ''
  const search = searchParams.get('search') ?? ''
  const from   = searchParams.get('from')   ?? ''
  const to     = searchParams.get('to')     ?? ''
  // Cursor for "load more" — server returns entries strictly older than
  // this ISO timestamp. Client passes the last-visible entry's createdAt.
  const before = searchParams.get('before') ?? ''
  const take   = Math.min(parseInt(searchParams.get('take') ?? '100'), 200)

  const createdAt: Prisma.DateTimeFilter = {}
  if (from)   createdAt.gte = new Date(from)
  if (to)     createdAt.lte = new Date(to)
  if (before) createdAt.lt  = new Date(before)

  const where: Prisma.AuditLogWhereInput = {}
  if (action) where.action = { contains: action }
  if (Object.keys(createdAt).length) where.createdAt = createdAt
  if (search) {
    // Free-text search across the fields a moderator would actually type:
    // who did it, what it said, and the target id (so they can grep an
    // event/user id from elsewhere and find every action against it).
    where.OR = [
      { adminName:   { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { targetId:    { contains: search, mode: 'insensitive' } },
    ]
  }

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
  })

  // `meta` is the PII carrier: account.self_delete stores the deleted member's
  // name/email/phone, and user.remove / email_change / partner.assign_user
  // carry full emails — data the users routes deliberately withhold from
  // moderators. The audit table has no city column to scope by, so strip meta
  // for non-admins. who/what/when (adminName, action, description, targetId,
  // createdAt) stays — that's the accountability a moderator needs.
  const full = canManageUsers(session)
  const safe = full ? logs : logs.map(l => ({ ...l, meta: null }))
  return NextResponse.json(safe)
}
