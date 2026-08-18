import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, type SessionUser } from '@/lib/session'
import { canManagePartners, canManageUsers } from '@/lib/access'
import { isSafeHref } from '@/lib/safeUrl'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

// Assigning and unassigning a partner account WRITES `role` on the target
// user, and `canManagePartners` admits moderators — so this route was a side
// door around the rule /api/admin/users/[id] states outright: moderators may
// suspend and warn, never change roles. A moderator could POST the admin's id
// here and overwrite `role: 'admin'` with `'partner'`. There is one admin
// account and four moderators, so that was a one-request lockout of every
// admin surface, and POST wrote no audit row to say who did it.
//
// It was never an escalation — `partner` sits below `moderator`, so nobody
// gains anything by assigning themselves — which is why the demotion is the
// whole risk. Moderators keep the partner workflow for ordinary members; a
// target who already holds an elevated role is admin-only, so the one thing
// that was reachable no longer is.
const ELEVATED_ROLES = ['admin', 'moderator']

function mayRebindRole(session: SessionUser, targetRole: string | null | undefined): boolean {
  return !ELEVATED_ROLES.includes(targetRole ?? '') || canManageUsers(session)
}

// PATCH — toggle/update partner fields (isActive, discount, etc.)
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !canManagePartners(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const allowed = ['name', 'category', 'discount', 'address', 'neighborhood', 'website', 'instagram', 'isActive']
  const data: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) data[key] = body[key]
  }

  // URL fields render as <a href> on /partner and /perks — reject
  // `javascript:` / `data:` schemes. Empty string is allowed (unset).
  for (const urlKey of ['website', 'instagram'] as const) {
    if (urlKey in data && data[urlKey] && !isSafeHref(String(data[urlKey]))) {
      return NextResponse.json({ error: `${urlKey} must be https:// or a /relative path` }, { status: 400 })
    }
  }

  const partner = await prisma.partner.update({ where: { id }, data })
  return NextResponse.json(partner)
}

// POST — assign a user to this partner
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !canManagePartners(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const [partner, target] = await Promise.all([
    prisma.partner.findUnique({ where: { id }, select: { id: true, name: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, name: true, email: true } }),
  ])
  if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
  // Previously an unknown id reached prisma.user.update and surfaced as a 500.
  if (!target)  return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if (!mayRebindRole(session, target.role)) {
    return NextResponse.json(
      { error: `${target.name} is a ${target.role} — only an admin can reassign an admin or moderator account.` },
      { status: 403 },
    )
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { partnerId: id, role: 'partner' },
    select: { id: true, name: true, email: true },
  })

  // Mirrors the unassign audit below: this is a role change, so the log has to
  // name who made it and what the account used to be.
  writeAudit(session.id, session.name, 'partner.assign_user', userId, 'user',
    { partnerId: id, partnerName: partner.name, previousRole: target.role, userEmail: target.email },
    `Assigned ${target.name ?? userId} (${target.email ?? ''}) to partner "${partner.name}" — role changed from ${target.role} to partner`,
  )

  return NextResponse.json(user)
}

// DELETE — unassign a user from this partner
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !canManagePartners(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  // Snapshot the user + partner names for the audit row so the log
  // is self-documenting (the role demotion + partner-link removal
  // is a meaningful access-control change).
  const [user, partner] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, role: true, partnerId: true } }),
    prisma.partner.findUnique({ where: { id }, select: { name: true } }),
  ])
  if (!user || user.partnerId !== id) {
    return NextResponse.json({ error: 'That account is not assigned to this partner' }, { status: 404 })
  }

  // The partnerId guard already means the target is normally a partner, so
  // this is belt-and-braces — but it costs one comparison and keeps both role
  // writes on this route under the same rule.
  if (!mayRebindRole(session, user.role)) {
    return NextResponse.json(
      { error: `${user.name} is a ${user.role} — only an admin can reassign an admin or moderator account.` },
      { status: 403 },
    )
  }

  await prisma.user.update({
    where: { id: userId, partnerId: id },
    data: { partnerId: null, role: 'member' },
  })

  writeAudit(session.id, session.name, 'partner.unassign_user', userId, 'user',
    { partnerId: id, partnerName: partner?.name, previousRole: user?.role, userEmail: user?.email },
    `Unassigned ${user?.name ?? userId} (${user?.email ?? ''}) from partner "${partner?.name ?? id}" — role demoted to member`,
  )

  return NextResponse.json({ ok: true })
}
