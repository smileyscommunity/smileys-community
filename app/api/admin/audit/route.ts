import { canViewAuditLog, canManageUsers, isAdmin, failClosedCityId } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import type { Prisma } from '@prisma/client'
import { maskContactsIn } from '@/lib/admin/maskContact'

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
  // Admins may narrow to one city; moderators are narrowed for them below.
  const city   = searchParams.get('city')   ?? ''
  const take   = Math.min(Math.max(parseInt(searchParams.get('take') ?? '100', 10) || 100, 1), 200)

  const createdAt: Prisma.DateTimeFilter = {}
  if (from)   createdAt.gte = new Date(from)
  if (to)     createdAt.lte = new Date(to)
  if (before) createdAt.lt  = new Date(before)

  const where: Prisma.AuditLogWhereInput = {}
  if (action) where.action = { contains: action }
  // The dashboard's "recent activity" strip asks for the last eight rows.
  // Since every door tap is audited (member-card review), a forty-person
  // event would fill all eight with "checked in a member at the door" and
  // push out the things that strip exists to surface. They stay on the full
  // audit page; `exclude=checkin.` is how the strip asks for the rest.
  const excludePrefixes: string[] = []
  const exclude = searchParams.get('exclude')
  if (exclude) excludePrefixes.push(exclude)
  // City scope. Rows carry the target's city since 2026-09-03; earlier rows
  // and platform-wide actions are null. A moderator sees their own city's
  // rows plus the city-less ones — the null arm is what keeps the history
  // they could always read from vanishing the day the column arrived.
  // Admins see everything unless they pick a city.
  if (!isAdmin(session)) {
    where.OR = [{ cityId: failClosedCityId(session) }, { cityId: null }]
    // Blacklist entries are an admin's (the blacklist itself is admin-only):
    // city-less, they reached every city's moderators, email and all.
    excludePrefixes.push('blacklist.')
  } else if (city) {
    where.cityId = city
  }
  // NOT takes a list, so the two reasons to hide a row (the caller's
  // `exclude`, and the blacklist rows a moderator may not read) can't
  // overwrite each other.
  if (excludePrefixes.length) where.NOT = excludePrefixes.map(p => ({ action: { startsWith: p } }))
  if (Object.keys(createdAt).length) where.createdAt = createdAt
  if (search) {
    // Free-text search across the fields a moderator would actually type:
    // who did it, what it said, and the target id (so they can grep an
    // event/user id from elsewhere and find every action against it).
    // ANDed with the city scope above (which may already own `OR`).
    // A moderator can't search the text for an email or a phone number:
    // the rows come back masked, but a hit would still confirm whose it was.
    const contactSearch = !isAdmin(session) && (/@/.test(search) || search.replace(/\D/g, '').length >= 7)
    const text: Prisma.AuditLogWhereInput = { OR: [
      { adminName:   { contains: search, mode: 'insensitive' } },
      ...(contactSearch ? [] : [{ description: { contains: search, mode: 'insensitive' as const } }]),
      { targetId:    { contains: search, mode: 'insensitive' } },
    ] }
    if (where.OR) { where.AND = [{ OR: where.OR }, text]; delete where.OR }
    else Object.assign(where, text)
  }

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
  })

  // `meta` is the PII carrier: account.self_delete stores the deleted member's
  // name/email/phone, and user.remove / email_change / partner.assign_user
  // carry full emails — data the users routes deliberately withhold from
  // moderators. Rows are city-scoped for them now, but meta is still stripped:
  // the city column says whose row it is, not whether its payload is safe. who/what/when (adminName, action, description, targetId,
  // createdAt) stays — that's the accountability a moderator needs.
  const full = canManageUsers(session)
  // The description can carry the same contact details — masked for them.
  const safe = full ? logs : logs.map(l => ({ ...l, meta: null, description: maskContactsIn(session, l.description) }))
  return NextResponse.json(safe)
}
