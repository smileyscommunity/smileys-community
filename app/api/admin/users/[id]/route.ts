import { canManageUsers, canViewUserList, canSuspendUsers, canActInCity } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

export async function GET(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canViewUserList(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, role: true,
        color: true, emailVerified: true, joinedAt: true,
        bio: true, neighborhood: true, instagram: true,
        phone: true, profilePhoto: true, nationality: true,
        languages: true, interests: true,
        status: true, membershipType: true, lastActive: true,
        adminNotes: {
          orderBy: { createdAt: 'desc' },
        },
        joinedEvents: {
          include: { event: { select: { id: true, title: true, emoji: true, date: true, neighborhood: true, price: true } } },
          orderBy: { joinedAt: 'desc' },
        },
        clubMemberships: {
          where: { role: 'host', status: 'approved' },
          include: { club: { select: { id: true, name: true, emoji: true } } },
        },
      },
    })
    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const isAdmin = canManageUsers(session)
    let canSeePII = isAdmin

    // Moderators can see PII only if they are actively reviewing this user's application or report
    if (!canSeePII) {
      const [reviewedApplication, assignedReport] = await Promise.all([
        prisma.memberApplication.findFirst({ where: { email: user.email, reviewedBy: session.id } }),
        prisma.report.findFirst({ where: { reviewedBy: session.id, OR: [{ reporterId: id }, { reportedId: id }] } })
      ])
      if (reviewedApplication || assignedReport) {
        canSeePII = true
      }
    }

    if (!canSeePII) {
      user.email = user.email.split('@')[0].slice(0, 3) + '...@' + user.email.split('@')[1]
      if (user.phone) {
        user.phone = user.phone.slice(0, 4) + '...' + user.phone.slice(-2)
      }
    }

    // Host quality — aggregate post-event survey signal across every
    // event this user has hosted. The single most powerful host-
    // quality metric the platform has: an objective "would the room
    // come back?" number that's hard to game. Null when the user has
    // hosted zero events or no surveys have landed yet.
    const hostedEventIds = await prisma.event.findMany({
      where:  { hostId: id, status: { in: ['published', 'archived'] } },
      select: { id: true, title: true, date: true, emoji: true },
      orderBy: { date: 'desc' },
    })
    let hostQuality: {
      eventsHosted:    number
      surveyResponses: number
      wouldReturnRate: number | null
      anomalyCount:    number
      recent:          { id: string; title: string; emoji: string; date: string; wouldReturnRate: number | null; responses: number; anomalyCount: number }[]
    } | null = null

    if (hostedEventIds.length > 0) {
      const ids = hostedEventIds.map(e => e.id)
      // Three counts each (total + would-return + anomaly), once
      // platform-wide and once per-event. Prisma's typed API doesn't
      // expose _sum on Booleans so we reach for counts instead.
      const [respTotal, retTotal, anomTotal, perEventResp, perEventRet, perEventAnom] = await Promise.all([
        prisma.eventSurvey.count({ where: { eventId: { in: ids } } }),
        prisma.eventSurvey.count({ where: { eventId: { in: ids }, wouldReturn: true } }),
        prisma.eventSurvey.count({ where: { eventId: { in: ids }, anomaly: true } }),
        prisma.eventSurvey.groupBy({ by: ['eventId'], where: { eventId: { in: ids } },                          _count: { _all: true } }),
        prisma.eventSurvey.groupBy({ by: ['eventId'], where: { eventId: { in: ids }, wouldReturn: true },        _count: { _all: true } }),
        prisma.eventSurvey.groupBy({ by: ['eventId'], where: { eventId: { in: ids }, anomaly: true },            _count: { _all: true } }),
      ])

      const perRespMap = new Map(perEventResp.map(r => [r.eventId, r._count._all]))
      const perRetMap  = new Map(perEventRet.map(r  => [r.eventId, r._count._all]))
      const perAnomMap = new Map(perEventAnom.map(r => [r.eventId, r._count._all]))

      // Recent 6 hosted events, newest first — trendline at a glance.
      const recent = hostedEventIds.slice(0, 6).map(e => {
        const responses = perRespMap.get(e.id) ?? 0
        const wouldRet  = perRetMap.get(e.id)  ?? 0
        const anom      = perAnomMap.get(e.id) ?? 0
        return {
          id:              e.id,
          title:           e.title,
          emoji:           e.emoji,
          date:            e.date,
          responses,
          wouldReturnRate: responses > 0 ? Math.round((wouldRet / responses) * 100) : null,
          anomalyCount:    anom,
        }
      })

      hostQuality = {
        eventsHosted:    hostedEventIds.length,
        surveyResponses: respTotal,
        wouldReturnRate: respTotal > 0 ? Math.round((retTotal / respTotal) * 100) : null,
        anomalyCount:    anomTotal,
        recent,
      }
    }

    return NextResponse.json({ ...user, hostQuality })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params
    const body = await req.json()

    // Fetch the target's cityId early — every capability check below
    // needs it to verify cross-city moderator escalation isn't
    // happening. Bundles with the `before` snapshot we'd be fetching
    // for the audit log anyway so this isn't an extra round-trip.
    const target = await prisma.user.findUnique({
      where: { id },
      select: { role: true, status: true, name: true, email: true, phone: true, suspendedUntil: true, cityId: true },
    })
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Re-engagement notification shortcut
    if (body._reengage) {
      if (!canManageUsers(session) && !canSuspendUsers(session, target.cityId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const { createNotification } = await import('@/lib/notify')
      await createNotification(id, 'announcement', '👋 We miss you!', body._reengage, '/events')
      return NextResponse.json({ ok: true })
    }

    // Capability Checks — moderators are scoped to their own city so a
    // Berlin mod can't suspend an Istanbul user via a direct API call
    // even if they hold the id.
    const adminPrivilege = canManageUsers(session)
    const modPrivilege   = canSuspendUsers(session, target.cityId)

    if (!adminPrivilege && !modPrivilege) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Belt-and-braces: even an admin operating cross-city sees the
    // canActInCity result, so a future "admins can be city-scoped"
    // toggle would just work without rewiring this check.
    if (!canActInCity(session, target.cityId) && !adminPrivilege) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const whitelist = [
      'status', 'role', 'membershipType', 'banReason', 'bannedAt',
      'appealStatus', 'bio', 'neighborhood', 'instagram', 'phone', 'nationality',
      'languages', 'interests', 'color', 'name',
      'suspendedUntil', 'suspensionNote', 'partnerId'
    ] as const

    const allowed: Record<string, unknown> = {}
    for (const key of whitelist) {
      if (key in body) {
        if (key === 'partnerId' && body[key] === '') {
          allowed[key] = null
        } else {
          allowed[key] = body[key]
        }
      }
    }

    // Restriction: Moderators can ONLY suspend or warn, not change roles/status/etc
    if (!adminPrivilege && modPrivilege) {
      const modOnlyAllowed = ['suspendedUntil', 'suspensionNote']
      const attempted = Object.keys(allowed)
      if (attempted.some(k => !modOnlyAllowed.includes(k))) {
        return NextResponse.json({ error: 'Moderators can only manage suspensions' }, { status: 403 })
      }
    }

    if (Object.keys(allowed).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    // Validate enum values
    if (allowed.role !== undefined && !['admin', 'moderator', 'member'].includes(allowed.role as string)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }
    if (allowed.status !== undefined && !['approved', 'pending', 'banned'].includes(allowed.status as string)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    // Prevent demoting/banning/suspending yourself
    if (id === session.id) {
      if (allowed.status === 'banned' || allowed.role || allowed.suspendedUntil) {
        return NextResponse.json({ error: 'Cannot change your own role, status or suspension' }, { status: 400 })
      }
    }

    if (allowed.status === 'banned') {
      allowed.bannedAt = new Date()
    }

    if (allowed.suspendedUntil) {
      allowed.suspendedAt = new Date()
      allowed.suspendedBy = session.id
    }

    // Capture before state for richer audit descriptions — reuses
    // the earlier fetch since we already pulled the target row for
    // the city-scope check.
    const before = target

    // role is read from the JWT body (not refreshed from DB by getSession), so a
    // demoted admin would keep session.role === 'admin' until their next login
    // without this. Bumping tokenVersion forces them through getSession's revocation
    // path on their next request.
    if ((allowed.role !== undefined && allowed.role !== before?.role) ||
        (allowed.status !== undefined && allowed.status !== before?.status)) {
      allowed.tokenVersion = { increment: 1 }
    }

    const user = await prisma.user.update({ where: { id }, data: allowed })

    // Auto-add to blacklist on ban so they can't re-apply
    if (allowed.status === 'banned' && before?.email) {
      prisma.blacklist.upsert({
        where:  { email: before.email },
        create: {
          email:    before.email,
          phone:    before.phone    ?? undefined,
          name:     before.name     ?? undefined,
          reason:   typeof allowed.banReason === 'string' && allowed.banReason ? allowed.banReason : 'banned',
          bannedBy: session.name,
        },
        update: {},
      }).catch(() => {})
    }

    if (allowed.role === 'moderator') {
      createNotification(id, 'host_assigned', "You're now a moderator 🛡️", 'You can now review membership applications and suggest decisions.', '/admin/applications').catch(() => {})
    }

    if (allowed.role && allowed.role !== before?.role) {
      writeAudit(session.id, session.name, 'user.role_change', id, 'user',
        { from: before?.role, to: allowed.role, name: before?.name },
        `Role changed from ${before?.role ?? '?'} to ${allowed.role} for ${before?.name ?? id}`,
      )
    }

    if (allowed.suspendedUntil && allowed.suspendedUntil !== before?.suspendedUntil) {
      const until = new Date(allowed.suspendedUntil as string)
      const reason = (allowed.suspensionNote as string) || 'violation of community guidelines'
      createNotification(id, 'rsvp', 'Account temporarily suspended', `Your account is suspended until ${until.toLocaleDateString()} for: ${reason}`).catch(() => {})
      writeAudit(session.id, session.name, 'user.suspend', id, 'user',
        { until, reason, name: before?.name },
        `${before?.name ?? id} suspended until ${until.toLocaleDateString()} — ${reason}`,
      )
    }

    if (allowed.status && allowed.status !== before?.status) {
      if (allowed.status === 'banned') {
        const reason = typeof allowed.banReason === 'string' && allowed.banReason ? allowed.banReason : 'violation of community guidelines'
        createNotification(id, 'rsvp', 'Your account has been suspended', `Your account was suspended: ${reason}. Contact us if you believe this is a mistake.`).catch(() => {})
        writeAudit(session.id, session.name, 'user.ban', id, 'user',
          { reason, name: before?.name },
          `${before?.name ?? id} banned — ${reason}`,
        )
      } else {
        writeAudit(session.id, session.name, 'user.status_change', id, 'user',
          { from: before?.status, to: allowed.status, name: before?.name },
          `Status changed from ${before?.status ?? '?'} to ${allowed.status} for ${before?.name ?? id}`,
        )
      }
    }

    return NextResponse.json(user)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageUsers(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    if (id === session.id) return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 })

    const target = await prisma.user.findUnique({ where: { id }, select: { name: true, email: true } })

    await prisma.$transaction([
      prisma.eventAttendee.deleteMany({ where: { userId: id } }),
      prisma.clubMembership.deleteMany({ where: { userId: id } }),
      prisma.notification.deleteMany({ where: { userId: id } }),
      prisma.notificationPreference.deleteMany({ where: { userId: id } }),
      prisma.review.deleteMany({ where: { userId: id } }),
      prisma.payment.deleteMany({ where: { userId: id } }),
      prisma.eventMessage.deleteMany({ where: { userId: id } }),
      prisma.report.deleteMany({ where: { OR: [{ reporterId: id }, { reportedId: id }] } }),
      prisma.waitlistEntry.deleteMany({ where: { userId: id } }),
      prisma.emailVerificationToken.deleteMany({ where: { userId: id } }),
      prisma.passwordResetToken.deleteMany({ where: { userId: id } }),
      prisma.user.delete({ where: { id } }),
    ])

    writeAudit(session.id, session.name, 'user.remove', id, 'user',
      { name: target?.name, email: target?.email },
      `User ${target?.name ?? id} (${target?.email ?? ''}) permanently removed`,
    )

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
