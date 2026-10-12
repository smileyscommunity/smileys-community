import { NextRequest, NextResponse } from 'next/server'
import { COMMUNITY_MEMBER_WHERE, NOT_ACTIVATED_MEMBER_WHERE, MEMBER_ROLE_FILTER } from '@/lib/memberCount'
import { getCityTz } from '@/lib/city'
import { dayInTz, DEFAULT_TZ } from '@/lib/cityTime'
import { emailFor } from '@/lib/admin/maskContact'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator, isAdmin, failClosedCityId } from '@/lib/access'
import { lastCallWhere, LAST_CALL_AFTER_DAYS, LAST_CALL_BATCH } from '@/lib/activationLastCall'

const LIST_LIMIT = 50

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // This returns names + emails + neighborhoods, so it must be city-scoped
  // like every other moderator roster (users/route.ts fails closed for the
  // same reason). Moderators: their own city only, fail-closed. Admins: all,
  // or one via ?city=. NULL means "no city predicate" (admin, all cities).
  const cityParam = new URL(req.url).searchParams.get('city')
  const cityId = isAdmin(session)
    ? (cityParam || null)
    : (failClosedCityId(session))

  const now       = new Date()
  const day7ago   = new Date(now.getTime() - 7  * 86400000)
  const day60ago  = new Date(now.getTime() - 60 * 86400000)
  // Event.date is the city's day; a UTC cutoff was a day off around midnight.
  const day60Str  = dayInTz(day60ago, cityId ? await getCityTz(cityId) : DEFAULT_TZ)

  // Never attended: approved members > 7 days old with 0 approved attendances
  // Activated community members only (lib/memberCount): approved alone took in
  // admins, moderators' own partner logins and accounts that never set a
  // password — people a nudge can't reach, inflating both lists.
  const neverWhere = {
    ...COMMUNITY_MEMBER_WHERE,
    joinedAt: { lt: day7ago },
    joinedEvents: { none: { status: 'approved' } },
    ...(cityId ? { cityId } : {}),
  }
  const [neverAttended, neverAttendedCount] = await Promise.all([
    prisma.user.findMany({
      where: neverWhere,
      select: {
        id: true, name: true, email: true, color: true, profilePhoto: true,
        neighborhood: true, interests: true, joinedAt: true,
      },
      orderBy: { joinedAt: 'desc' },
      take: LIST_LIMIT,
    }),
    prisma.user.count({ where: neverWhere }),
  ])

  // Dormant: attended at least once, but last event > 60 days ago
  const dormant = await prisma.$queryRaw<{
    id: string; name: string; email: string; color: string;
    neighborhood: string | null; lastEventDate: string; eventCount: number
  }[]>`
    SELECT u.id, u.name, u.email, u.color, u.neighborhood,
           MAX(e.date) as "lastEventDate",
           COUNT(ea.id)::int as "eventCount"
    FROM users u
    JOIN event_attendees ea ON ea."userId" = u.id AND ea.status = 'approved'
    JOIN events e ON e.id = ea."eventId"
    WHERE u.status = 'approved' AND u.password IS NOT NULL AND u.role NOT IN ('admin', 'partner')
      AND (${cityId}::text IS NULL OR u."cityId" = ${cityId})
    GROUP BY u.id, u.name, u.email, u.color, u.neighborhood
    HAVING MAX(e.date) < ${day60Str}
    ORDER BY MAX(e.date) ASC
    LIMIT ${LIST_LIMIT}
  `
  const [{ total: dormantCount }] = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COUNT(*)::int AS total FROM (
      SELECT u.id
      FROM users u
      JOIN event_attendees ea ON ea."userId" = u.id AND ea.status = 'approved'
      JOIN events e ON e.id = ea."eventId"
      WHERE u.status = 'approved' AND u.password IS NOT NULL AND u.role NOT IN ('admin', 'partner')
        AND (${cityId}::text IS NULL OR u."cityId" = ${cityId})
      GROUP BY u.id
      HAVING MAX(e.date) < ${day60Str}
    ) d
  `

  // Not activated: approved but never set a password, so they have never seen
  // the site and nothing above can reach them. No age cut-off: the login-nudge
  // email stops at 60 days, so the older ones are the ones nobody chases any
  // more (222 of them on 2026-10-13, back to May). Unmessaged first, newest
  // approval first, so the likeliest activations lead.
  //
  // Admin-only: the action on this list is a WhatsApp message, and moderators
  // never see a member's phone number (lib/admin/maskContact). The number
  // itself is not returned either, only whether there is one; the link is
  // built server-side on click (./whatsapp/route.ts).
  let notActivated: {
    id: string; name: string; color: string; neighborhood: string | null
    joinedAt: Date; nudgesSent: number; whatsappNudgedAt: Date | null; hasPhone: boolean
  }[] = []
  let notActivatedCount = 0
  // The one-time last-call email's queue (lib/activationLastCall). Not city
  // scoped: the send button works through everyone, so the count must too.
  let lastCallRemaining = 0
  if (isAdmin(session)) {
    lastCallRemaining = await prisma.user.count({ where: lastCallWhere(now) })
    const notActivatedWhere = {
      ...NOT_ACTIVATED_MEMBER_WHERE,
      role: MEMBER_ROLE_FILTER,
      ...(cityId ? { cityId } : {}),
    }
    const [rows, count] = await Promise.all([
      prisma.user.findMany({
        where: notActivatedWhere,
        select: {
          id: true, name: true, color: true, neighborhood: true, joinedAt: true,
          nudgesSent: true, whatsappNudgedAt: true, phone: true,
        },
        // Not yet messaged first, newest approvals first within each group,
        // so the queue reads top-down and a sent row sinks.
        orderBy: [{ whatsappNudgedAt: { sort: 'asc', nulls: 'first' } }, { joinedAt: 'desc' }],
        take: LIST_LIMIT,
      }),
      prisma.user.count({ where: notActivatedWhere }),
    ])
    notActivated = rows.map(({ phone, ...r }) => ({ ...r, hasPhone: !!phone?.replace(/\D/g, '') }))
    notActivatedCount = count
  }

  // Names + neighborhoods are the roster; the address is not (see lib/admin/maskContact).
  const mask = <T extends { email: string }>(rows: T[]) => rows.map(r => ({ ...r, email: emailFor(session, r.email) }))
  return NextResponse.json({
    neverAttended: mask(neverAttended),
    dormant:       mask(dormant),
    // Absent (not empty) for moderators, so the page knows not to show the tab.
    ...(isAdmin(session) ? { notActivated } : {}),
    // The counts were `rows.length` of a LIMIT 50 list, so a city with 300
    // dormant members showed "50" as if that were the total. Real totals now;
    // `listLimit` lets the page say "showing first 50 of 300".
    stats: {
      neverAttendedCount,
      dormantCount,
      ...(isAdmin(session) ? { notActivatedCount, lastCall: { remaining: lastCallRemaining, afterDays: LAST_CALL_AFTER_DAYS, batch: LAST_CALL_BATCH } } : {}),
      listLimit: LIST_LIMIT,
    },
  })
}
