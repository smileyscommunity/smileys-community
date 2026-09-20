import { canManageUsers, canViewUserList, isAdmin as sessionIsAdmin, failClosedCityId } from '@/lib/access'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import {
  thresholds, cutoffFor, DEFAULT_WINDOW_DAYS, requestScanSql, dmScanSql,
  requestReasons, dmReasons, type RequestRow, type DmRow,
} from '@/lib/connectionAbuse'

// Read-only connection-request and DM fan-out report for moderators/admins.
//
// Surfaces members whose outbound volume in the window looks like
// directory-trawling rather than genuine networking (the July 2026 wave: 69
// requests, 92% to women, 43 left pending — caught by word of mouth instead
// of tooling). Same detector as the weekly scripts/scan-connection-abuse.ts
// email, and that is now true rather than merely claimed: both import the
// thresholds and the flag rules from lib/connectionAbuse, which is where the
// reasoning for each lives. This endpoint exists so a spree surfaces the day
// it happens, not on next Monday's cron.
//
// This endpoint reports; it never mutates. Any punishment stays a human
// decision on the existing warn/suspend/ban tools.
const WINDOW_DAYS = DEFAULT_WINDOW_DAYS

export async function GET() {
  try {
    const session = await getSession()
    if (!session || !canViewUserList(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!await rateLimit(`admin-connection-flags:${session.id}`, 30, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const since = cutoffFor(WINDOW_DAYS)
    const t     = thresholds(WINDOW_DAYS)

    const [requestRows, dmRows] = await Promise.all([
      prisma.$queryRaw<RequestRow[]>(requestScanSql(since, t.MIN_REQUESTS)),
      prisma.$queryRaw<DmRow[]>(dmScanSql(since, t.MIN_DM_PARTNERS)),
    ])

    const reqCandidates = requestRows.flatMap(r => {
      const reasons = requestReasons(r, t)
      return reasons.length ? [{ ...r, reasons }] : []
    })
    const dmCandidates = dmRows.flatMap(r => {
      const reasons = dmReasons(r, t)
      return reasons.length ? [{ ...r, reasons }] : []
    })

    const ids = [...new Set([...reqCandidates, ...dmCandidates].map(c => c.userId))]
    if (ids.length === 0) {
      return NextResponse.json({ windowDays: WINDOW_DAYS, minSent: t.MIN_REQUESTS, minDmPartners: t.MIN_DM_PARTNERS, flagged: [], dmFlagged: [] })
    }

    // Moderators only see members in their own city (same fail-closed scoping
    // as the admin users list); admins see all, with the city attached so the
    // panel can render the usual CityBadge.
    const users = await prisma.user.findMany({
      where: {
        id: { in: ids },
        ...(sessionIsAdmin(session) ? {} : { cityId: failClosedCityId(session) }),
      },
      select: {
        id: true, name: true, email: true, role: true, color: true,
        status: true, warningCount: true,
        city: { select: { name: true, slug: true } },
      },
    })
    const byId = new Map(users.map(u => [u.id, u]))

    const isAdmin = canManageUsers(session)
    // Same email masking rule as the users list for non-admin viewers.
    const mask = (email: string) =>
      isAdmin ? email : (email.split('@')[0].slice(0, 3) + '...@' + email.split('@')[1])

    const flagged = reqCandidates
      .flatMap(({ userId, name: _n, gender: _g, suspended: _s, ...c }) => {
        const u = byId.get(userId)
        if (!u) return []  // outside the moderator's city
        return [{ ...u, email: mask(u.email), ...c }]
      })
      .sort((a, b) => b.sent - a.sent)

    const dmFlagged = dmCandidates
      .flatMap(({ userId, name: _n, gender: _g, suspended: _s, ...c }) => {
        const u = byId.get(userId)
        if (!u) return []
        return [{ ...u, email: mask(u.email), ...c }]
      })
      .sort((a, b) => b.partners - a.partners)

    return NextResponse.json({
      windowDays:    WINDOW_DAYS,
      minSent:       t.MIN_REQUESTS,
      minDmPartners: t.MIN_DM_PARTNERS,
      flagged,
      dmFlagged,
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
