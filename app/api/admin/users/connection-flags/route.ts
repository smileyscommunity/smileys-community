import { canManageUsers, canViewUserList, isAdmin as sessionIsAdmin, failClosedCityId } from '@/lib/access'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

// Read-only connection-request abuse report for moderators/admins.
//
// Surfaces members whose outbound MemberConnection volume in the last
// WINDOW_DAYS looks like directory-trawling rather than genuine networking
// (the July 2026 wave: 69 requests, 92% to women, 43 left pending — caught
// by word of mouth instead of tooling). Same heuristics as the weekly
// scripts/scan-connection-abuse.ts email scan, but live in the admin UI
// so a spree surfaces the day it happens, not on next Monday's cron.
//
// A member (role 'member' — hosts/mods legitimately fan out) is flagged
// when they sent at least MIN_SENT requests in the window AND at least
// one of:
//   - low acceptance:  accepted/sent <= LOW_ACCEPTANCE
//   - high ignore:     pending/sent >= HIGH_IGNORE — targets who ignore
//     rather than decline leave requests pending, inflating the accept
//     denominator and hiding the sender under the acceptance check (the
//     Zabdawi/Ntamen/Khristy variant, 2026-07-18), so a big unanswered
//     backlog flags on its own
//   - gender skew:     one gender is >= GENDER_SKEW of gender-known
//     receivers (needs MIN_GENDER_KNOWN known to avoid small-sample
//     false positives). Cross-gender only — same-gender skew (esp.
//     women->women) is normal friend-seeking, per the weekly scan.
//
// This endpoint reports; it never mutates. Any punishment stays a human
// decision on the existing warn/suspend/ban tools.
const WINDOW_DAYS = 60
const MIN_SENT = 20
const LOW_ACCEPTANCE = 0.3
const HIGH_IGNORE = 0.5
const GENDER_SKEW = 0.8
const MIN_GENDER_KNOWN = 10

export async function GET() {
  try {
    const session = await getSession()
    if (!session || !canViewUserList(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!await rateLimit(`admin-connection-flags:${session.id}`, 30, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const since = new Date(Date.now() - WINDOW_DAYS * 86400000)

    // Declined and withdrawn requests are hard-DELETED (api/connections/[id]),
    // so only pending + accepted rows survive — these counts understate the
    // true send volume. Thresholds are set with that in mind.
    // Gender is free text; normalize with lower+trim ('Male'/'MALE'/etc.).
    const rows = await prisma.$queryRaw<{
      requesterId: string
      requesterGender: string | null
      sent: number
      accepted: number
      pending: number
      toFemale: number
      toMale: number
    }[]>`
      SELECT mc."requesterId",
             lower(trim(qu.gender))                                          AS "requesterGender",
             COUNT(*)::int                                                   AS "sent",
             COUNT(*) FILTER (WHERE mc.status = 'accepted')::int             AS "accepted",
             COUNT(*) FILTER (WHERE mc.status = 'pending')::int              AS "pending",
             COUNT(*) FILTER (WHERE lower(trim(ru.gender)) = 'female')::int  AS "toFemale",
             COUNT(*) FILTER (WHERE lower(trim(ru.gender)) = 'male')::int    AS "toMale"
      FROM member_connections mc
      JOIN users ru ON ru.id = mc."receiverId"
      JOIN users qu ON qu.id = mc."requesterId" AND qu.role = 'member'
      WHERE mc."createdAt" >= ${since}
      GROUP BY mc."requesterId", qu.gender
      HAVING COUNT(*) >= ${MIN_SENT}
    `

    const candidates = rows.flatMap(({ requesterGender, ...r }) => {
      const genderKnown = r.toFemale + r.toMale
      const dominantGender = r.toFemale >= r.toMale ? 'female' : 'male'
      const lowAcceptance = r.accepted / r.sent <= LOW_ACCEPTANCE
      const highIgnore = r.pending / r.sent >= HIGH_IGNORE
      const genderSkew = genderKnown >= MIN_GENDER_KNOWN
        && Math.max(r.toFemale, r.toMale) / genderKnown >= GENDER_SKEW
        && requesterGender !== dominantGender  // cross-gender only
      if (!lowAcceptance && !highIgnore && !genderSkew) return []
      const reasons = [
        ...(lowAcceptance ? ['low-acceptance'] : []),
        ...(highIgnore ? ['high-ignore'] : []),
        ...(genderSkew ? ['gender-skew'] : []),
      ]
      return [{ ...r, reasons }]
    })
    if (candidates.length === 0) {
      return NextResponse.json({ windowDays: WINDOW_DAYS, minSent: MIN_SENT, flagged: [] })
    }

    // Moderators only see requesters in their own city (same fail-closed
    // scoping as the admin users list); admins see all, with the city
    // attached so the panel can render the usual CityBadge.
    const requesters = await prisma.user.findMany({
      where: {
        id: { in: candidates.map(c => c.requesterId) },
        ...(sessionIsAdmin(session) ? {} : { cityId: failClosedCityId(session) }),
      },
      select: {
        id: true, name: true, email: true, role: true, color: true,
        status: true, warningCount: true,
        city: { select: { name: true, slug: true } },
      },
    })
    const byId = new Map(requesters.map(u => [u.id, u]))

    const isAdmin = canManageUsers(session)
    const flagged = candidates
      .flatMap(({ requesterId, ...c }) => {
        const u = byId.get(requesterId)
        if (!u) return []  // outside the moderator's city
        // Same email masking rule as the users list for non-admin viewers.
        const email = isAdmin ? u.email : (u.email.split('@')[0].slice(0, 3) + '...@' + u.email.split('@')[1])
        return [{ ...u, email, ...c }]
      })
      .sort((a, b) => b.sent - a.sent)

    return NextResponse.json({ windowDays: WINDOW_DAYS, minSent: MIN_SENT, flagged })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
