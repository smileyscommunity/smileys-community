import { canManageClubs } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { writeAudit } from '@/lib/audit'

// Club-membership admin endpoints. Two invariants the API must hold:
//
//   1. Club.memberCount === count of memberships with status='approved'
//      for that club. Every status transition that crosses the
//      approved/not-approved boundary updates memberCount by ±1.
//
//   2. The membership write and the memberCount update are atomic.
//      Sequential write-then-update could otherwise drift the count
//      on a mid-stream failure (Postgres restart, deploy mid-call,
//      etc.) — wrap both in prisma.$transaction so either both land
//      or neither does.
//
// The matrix of transitions and their count deltas:
//
//     prior     →  next        delta
//     —             approved     +1     (create)
//     —             pending      0      (create as pending)
//     pending      → approved    +1
//     pending      → rejected    0
//     approved     → pending     -1
//     approved     → rejected    -1
//     rejected     → approved    +1
//     approved     → (deleted)   -1
//     pending      → (deleted)   0
//     rejected     → (deleted)   0
//
// /recount is the recovery hatch when historical drift sneaks
// through (see app/api/admin/clubs/[id]/recount/route.ts).

type Params = { params: Promise<{ id: string }> }

function countDelta(prior: string | null, next: string | null): number {
  const wasApproved = prior === 'approved'
  const isApproved  = next  === 'approved'
  return (isApproved ? 1 : 0) - (wasApproved ? 1 : 0)
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageClubs(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const { userId, role = 'member' } = await req.json()

    // Adding via this endpoint always creates as approved (the
    // admin-curated add path, not a join-request flow). Single
    // transaction so the count change can't outlive a failed
    // membership insert.
    const delta = countDelta(null, 'approved')
    const ops: Promise<unknown>[] = [
      prisma.clubMembership.create({
        data: { userId, clubId: id, role, status: 'approved' },
        include: { user: { select: { id: true, name: true, email: true, color: true, role: true } } },
      }),
    ]
    if (delta !== 0) {
      ops.push(prisma.club.update({ where: { id }, data: { memberCount: { increment: delta } } }))
    }
    const [membership] = await prisma.$transaction(ops as never) as [{ user: { name: string } }]

    // Audit — fire-and-forget so a transient audit-write failure
    // never rolls back the membership. Same pattern as the rest of
    // the admin surfaces.
    const club = await prisma.club.findUnique({ where: { id }, select: { name: true } })
    writeAudit(session.id, session.name, 'club.member_added', id, 'club',
      { userId, role, status: 'approved', userName: membership.user.name, clubName: club?.name ?? id },
      `Added ${membership.user.name} to "${club?.name ?? id}" as ${role}`,
    )

    return NextResponse.json(membership)
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') return NextResponse.json({ error: 'Already a member' }, { status: 409 })
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function GET(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageClubs(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const memberships = await prisma.clubMembership.findMany({
      where: { clubId: id },
      include: { user: { select: { id: true, name: true, email: true, color: true, role: true } } },
      orderBy: { joinedAt: 'asc' },
    })
    return NextResponse.json(memberships)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageClubs(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const { userId, status, role } = await req.json()

    // Read prior status + role so we can compute the count delta
    // accurately AND describe the change for the audit log. Without
    // this, "approved → pending" demotions silently inflate
    // memberCount and "rejected → approved" promotions silently
    // double-count.
    const prior = await prisma.clubMembership.findUnique({
      where:  { userId_clubId: { userId, clubId: id } },
      select: { status: true, role: true },
    })
    if (!prior) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const data: Record<string, string> = {}
    if (status) data.status = status
    if (role)   data.role   = role

    const nextStatus = status ?? prior.status
    const delta      = countDelta(prior.status, nextStatus)

    const ops: Promise<unknown>[] = [
      prisma.clubMembership.update({ where: { userId_clubId: { userId, clubId: id } }, data }),
    ]
    if (delta !== 0) {
      ops.push(prisma.club.update({ where: { id }, data: { memberCount: { increment: delta } } }))
    }
    const [membership] = await prisma.$transaction(ops as never)

    // Notifications + audit are fire-and-forget (no rollback needed
    // if they fail). The club + user lookups run out of the
    // transaction since they only feed notification copy + audit
    // descriptions.
    const [club, user] = await Promise.all([
      prisma.club.findUnique({ where: { id }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    ])
    const userName = user?.name ?? userId
    const clubName = club?.name ?? id

    if (status && status !== prior.status) {
      writeAudit(session.id, session.name, 'club.member_status_change', id, 'club',
        { userId, userName, clubName, from: prior.status, to: status },
        `${status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Changed status of'} ${userName} for "${clubName}" (${prior.status} → ${status})`,
      )
    }
    if (role && role !== prior.role) {
      writeAudit(session.id, session.name, 'club.member_role_change', id, 'club',
        { userId, userName, clubName, from: prior.role, to: role },
        `Changed ${userName}'s role in "${clubName}" from ${prior.role} to ${role}`,
      )
    }

    if (status === 'approved' && prior.status !== 'approved') {
      createNotification(userId, 'club_approved', 'Membership approved! 🎉', `Your request to join ${club?.name} has been approved`, `/clubs`)
    } else if (status === 'rejected' && prior.status !== 'rejected') {
      createNotification(userId, 'club_rejected', 'Membership request declined', `Your request to join ${club?.name} was not approved`, `/clubs`)
    }
    if (role === 'host') {
      createNotification(userId, 'host_assigned', 'You\'re now a host 🎖️', `You've been made a host of ${club?.name ?? 'a club'}. You can now create and manage events.`, `/host`)
    }

    return NextResponse.json(membership)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageClubs(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const { userId } = await req.json()

    // Same reasoning as PATCH — we need the prior status to know
    // whether to decrement memberCount. Doing this inside the
    // transaction (via findUnique then delete) would race against
    // another concurrent admin's write; reading outside is fine
    // because the unique key on (userId, clubId) prevents the
    // membership from being recreated under us.
    const prior = await prisma.clubMembership.findUnique({
      where:  { userId_clubId: { userId, clubId: id } },
      select: { status: true, role: true },
    })
    if (!prior) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const delta = countDelta(prior.status, null)
    const ops: Promise<unknown>[] = [
      prisma.clubMembership.delete({ where: { userId_clubId: { userId, clubId: id } } }),
    ]
    if (delta !== 0) {
      ops.push(prisma.club.update({ where: { id }, data: { memberCount: { increment: delta } } }))
    }
    await prisma.$transaction(ops as never)

    // Audit — out-of-transaction lookups for name resolution.
    const [club, user] = await Promise.all([
      prisma.club.findUnique({ where: { id }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    ])
    writeAudit(session.id, session.name, 'club.member_removed', id, 'club',
      { userId, userName: user?.name ?? userId, clubName: club?.name ?? id, priorStatus: prior.status, priorRole: prior.role },
      `Removed ${user?.name ?? userId} from "${club?.name ?? id}" (was ${prior.role}, ${prior.status})`,
    )

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
