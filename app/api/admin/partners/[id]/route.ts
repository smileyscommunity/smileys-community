import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, type SessionUser } from '@/lib/session'
import { canManagePartners, canManageUsers, canActInCity } from '@/lib/access'
import { isSafeHref } from '@/lib/safeUrl'
import { normalizeInstagramHandle } from '@/lib/directory-constants'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'
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
  // A moderator edits partners in their own city only.
  const current = await prisma.partner.findUnique({ where: { id } })
  if (!current) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
  if (!canActInCity(session, current.cityId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  // The edit panel shows Logo URL and Cover Image URL, but this list omitted
  // them — the save toasted "Saved ✓" and the images never changed. Instagram
  // was run through isSafeHref, so the form's own "@username" placeholder 400'd.
  // Each field is now typed the way the partner self-edit route types it.
  const data: Record<string, string | boolean | null> = {}
  const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : v == null ? null : undefined
  // Only a value that differs from the row is validated and written. The panel
  // used to echo the whole row, and a legacy http:// logo or "instagram.com/foo"
  // stored before these rules 400'd every save, even one changing only the
  // discount. Unchanged legacy values pass through untouched.
  const norm = (v: unknown) => typeof v === 'string' ? (v.trim() || null) : v ?? null
  const row = current as unknown as Record<string, unknown>
  const unchanged = (key: string) => norm(body[key]) === norm(row[key])
  // Required columns: null or blank would 500 on the NOT NULL constraint.
  for (const [key, max] of [['name', 120], ['category', 60], ['discount', 200], ['address', 300], ['neighborhood', 80]] as const) {
    if (!(key in body) || unchanged(key)) continue
    const v = str(body[key], max)
    if (typeof v !== 'string') return NextResponse.json({ error: `${key} must be text` }, { status: 400 })
    if (key === 'name' && !v) return NextResponse.json({ error: 'name is required' }, { status: 400 })
    data[key] = v
  }
  // URL fields render as <a href> on /partner and /perks — reject
  // `javascript:` / `data:` schemes. Empty string unsets.
  if ('website' in body && !unchanged('website')) {
    const v = str(body.website, 300)
    if (v === undefined || (v && !isSafeHref(v))) return NextResponse.json({ error: 'website must be https:// or a /relative path' }, { status: 400 })
    data.website = v || null
  }
  if ('instagram' in body && !unchanged('instagram')) {
    const v = str(body.instagram, 60)
    const handle = v ? normalizeInstagramHandle(v) : null
    if (v === undefined || (v && !handle)) return NextResponse.json({ error: 'Invalid Instagram handle' }, { status: 400 })
    // "@foo" typed over a stored "foo" is not an edit.
    if (handle !== current.instagram) data.instagram = handle
  }
  // Rendered as <img> to every member. Staff may paste an https image URL (the
  // panel has no uploader) or an uploads path; nothing else (data:, javascript:).
  for (const key of ['logo', 'coverImage'] as const) {
    if (!(key in body) || unchanged(key)) continue
    const v = str(body[key], 500)
    if (v === undefined || (v && !isUploadedImageUrl(v) && !/^https:\/\/[^\s"'<>]+$/.test(v))) {
      return NextResponse.json({ error: `${key} must be an https:// image URL or an uploaded image` }, { status: 400 })
    }
    data[key] = v || null
  }
  if ('isActive' in body) {
    if (typeof body.isActive !== 'boolean') return NextResponse.json({ error: 'isActive must be true or false' }, { status: 400 })
    if (body.isActive !== current.isActive) data.isActive = body.isActive
  }

  // Nothing differs: answer with the row rather than issue an empty UPDATE.
  if (Object.keys(data).length === 0) return NextResponse.json(current)
  const partner = await prisma.partner.update({ where: { id }, data })
  writeAudit(session.id, session.name, 'partner.update', id, 'partner',
    { cityId: current.cityId, fields: Object.keys(data) }, `Edited partner "${partner.name}" (${Object.keys(data).join(', ')})`)
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
    prisma.partner.findUnique({ where: { id }, select: { id: true, name: true, cityId: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, name: true, email: true, cityId: true } }),
  ])
  if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
  // Previously an unknown id reached prisma.user.update and surfaced as a 500.
  if (!target)  return NextResponse.json({ error: 'User not found' }, { status: 404 })
  // Both ends of the binding must be in the moderator's city: the partner
  // being assigned to, and the member whose role is about to change.
  if (!canActInCity(session, partner.cityId) || !canActInCity(session, target.cityId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!mayRebindRole(session, target.role)) {
    return NextResponse.json(
      { error: `${target.name} is a ${target.role} — only an admin can reassign an admin or moderator account.` },
      { status: 403 },
    )
  }

  const user = await prisma.user.update({
    where: { id: userId },
    // getSession never re-reads role/partnerId from the DB; the bump is what
    // makes the old cookie stop working (same as the users route).
    data: { partnerId: id, role: 'partner', tokenVersion: { increment: 1 } },
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
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, role: true, partnerId: true, cityId: true } }),
    prisma.partner.findUnique({ where: { id }, select: { name: true, cityId: true } }),
  ])
  if (!user || user.partnerId !== id) {
    return NextResponse.json({ error: 'That account is not assigned to this partner' }, { status: 404 })
  }
  if (!canActInCity(session, partner?.cityId) || !canActInCity(session, user.cityId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
    data: { partnerId: null, role: 'member', tokenVersion: { increment: 1 } },
  })

  writeAudit(session.id, session.name, 'partner.unassign_user', userId, 'user',
    { partnerId: id, partnerName: partner?.name, previousRole: user?.role, userEmail: user?.email },
    `Unassigned ${user?.name ?? userId} (${user?.email ?? ''}) from partner "${partner?.name ?? id}" — role demoted to member`,
  )

  return NextResponse.json({ ok: true })
}
