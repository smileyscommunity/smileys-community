import { canManageUsers, canViewUserList, isAdmin as sessionIsAdmin, failClosedCityId } from '@/lib/access'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import {
  THRESHOLDS, requestScanSql, dmScanSql, requestReasons, dmReasons,
  type RequestRow, type DmRow,
} from '@/lib/connectionAbuse'

// Read-only abuse report for moderators/admins: connection-request and DM
// fan-out that looks like directory-trawling rather than networking (the July
// 2026 wave — 69 requests, 92% to women, 43 left pending — caught by word of
// mouth instead of tooling).
//
// Lifetime, deliberately. This ran on a 60-day window and an offender who
// stopped vanished from it, which is how the case the scan was built for had
// aged out of its own report by September. Nothing ages out now; `lastAt`
// tells a live spree from settled history instead.
//
// Same detector as the weekly scripts/scan-connection-abuse.ts email — both
// import lib/connectionAbuse, so a threshold moves in one place or not at
// all. This endpoint reports; it never mutates. Every sanction stays a human
// decision on the existing warn/suspend/ban tools.

export async function GET() {
  try {
    const session = await getSession()
    if (!session || !canViewUserList(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!await rateLimit(`admin-abuse:${session.id}`, 30, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    // Sequentially: two raw queries on one pg client in parallel trips a
    // pg deprecation warning and is removed outright in pg@9.
    const requestRows = await prisma.$queryRaw<RequestRow[]>(requestScanSql())
    const dmRows      = await prisma.$queryRaw<DmRow[]>(dmScanSql())

    const reqCandidates = requestRows.flatMap(r => {
      const reasons = requestReasons(r)
      return reasons.length ? [{ ...r, reasons }] : []
    })
    const dmCandidates = dmRows.flatMap(r => {
      const reasons = dmReasons(r)
      return reasons.length ? [{ ...r, reasons }] : []
    })

    const ids = [...new Set([...reqCandidates, ...dmCandidates].map(c => c.userId))]
    if (ids.length === 0) {
      return NextResponse.json({ thresholds: THRESHOLDS, requests: [], dms: [] })
    }

    // Moderators only see members in their own city (same fail-closed scoping
    // as the admin users list); admins see all, with the city attached so the
    // page can render the usual CityBadge.
    const users = await prisma.user.findMany({
      where: {
        id: { in: ids },
        ...(sessionIsAdmin(session) ? {} : { cityId: failClosedCityId(session) }),
      },
      select: {
        id: true, name: true, email: true, role: true, color: true,
        status: true, warningCount: true, suspendedUntil: true,
        city: { select: { name: true, slug: true } },
      },
    })
    const byId = new Map(users.map(u => [u.id, u]))

    const isAdmin = canManageUsers(session)
    // Same email masking rule as the users list for non-admin viewers.
    const mask = (email: string) =>
      isAdmin ? email : (email.split('@')[0].slice(0, 3) + '...@' + email.split('@')[1])

    const attach = <T extends { userId: string; name: string; gender: string | null }>(c: T) => {
      const u = byId.get(c.userId)
      if (!u) return []  // outside the moderator's city
      const { name: _n, gender: _g, ...rest } = c
      return [{ ...u, email: mask(u.email), ...rest }]
    }

    return NextResponse.json({
      thresholds: THRESHOLDS,
      requests: reqCandidates.flatMap(attach).sort((a, b) => b.sent - a.sent),
      dms:      dmCandidates.flatMap(attach).sort((a, b) => b.partners - a.partners),
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
