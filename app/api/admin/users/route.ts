import { canManageUsers, canViewUserList, isAdmin as sessionIsAdmin } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !canViewUserList(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!await rateLimit(`admin-users:${session.id}`, 30, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const params = new URL(req.url).searchParams
    const search = params.get('search') ?? ''
    const status = params.get('status') ?? ''

    // Search clause — exact match on lastFingerprint short-circuits the
    // substring lookups when the search box receives a 16+ char hex string
    // (a FingerprintJS visitorId). Lets admins do the cross-account grep
    // ("show me everyone who ever logged in from this device") by pasting
    // the fp from one user's record into the search.
    const searchClause = search
      ? (/^[a-f0-9]{16,}$/i.test(search)
          ? { lastFingerprint: search }
          : { OR: [
              { name:  { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ] })
      : {}

    // Moderators see only their own city's users. Admins see all.
    // Admins can override the view per-city via `?city=<id>` to drill
    // into one city's roster (useful for multi-city audits).
    const cityFilter: { cityId?: string } = (() => {
      // Fail CLOSED for a city-less moderator — an empty filter used to fall
      // through to `{}` (all cities), exposing the full cross-city roster
      // (incl. banReason/appealNote/lastFingerprint). Match nothing instead.
      if (!sessionIsAdmin(session)) return { cityId: session.cityId ?? '__no_city__' }
      const cityId = params.get('city')
      return cityId ? { cityId } : {}
    })()

    const users = await prisma.user.findMany({
      where: {
        ...(status && { status }),
        ...searchClause,
        ...cityFilter,
      },
      orderBy: { joinedAt: 'desc' },
      // Cap is a payload guard, not pagination — it must stay comfortably
      // above the real member count or the OLDEST members silently vanish
      // from every admin tab (at 1000 with 1179 users, the first ~180
      // joiners — including 3 of the 13 suspended in the 2026-07 abuse
      // wave — were invisible unless searched for by name).
      take: 5000,
      select: {
        id: true, name: true, email: true, role: true,
        color: true, emailVerified: true, joinedAt: true,
        status: true, banReason: true, bannedAt: true, warningCount: true,
        appealNote: true, appealStatus: true, appealedAt: true,
        // suspendedUntil drives the "suspended" UI bucket — the DB status
        // enum is only approved/pending/banned, so the admin list page
        // computes `isSuspended = suspendedUntil > now()` from this field.
        // Without it the Suspended tab was permanently empty on reload.
        suspendedUntil: true,
        // nationality is needed by the admin users page to decide whether
        // a phone number with a leading 0 should get the Turkey country
        // code (+90) prepended for the WhatsApp link, or be left as-is
        // (non-Turkish users with local-format numbers were getting their
        // links mangled to '90xxx' before this).
        lastActive: true, phone: true, password: true, lastFingerprint: true, nationality: true,
        hiddenFromMembers: true,
      },
    })

    // No-show count: approved attendees where checkedIn=false and event date is past.
    // NO_SHOW_TRACKING_SINCE: update this date to reset all counts (only events on/after this date are counted).
    const NO_SHOW_TRACKING_SINCE = '2026-06-18'
    const today = new Date().toISOString().slice(0, 10)
    const noShowRows = await prisma.$queryRaw<{ userId: string; count: bigint }[]>`
      SELECT ea."userId", COUNT(*) AS count
      FROM event_attendees ea
      JOIN events e ON e.id = ea."eventId"
      WHERE ea."checkedIn" = false
        AND ea.status = 'approved'
        AND e.date >= ${NO_SHOW_TRACKING_SINCE}
        AND e.date < ${today}
      GROUP BY ea."userId"
    `
    const noShowMap = new Map(noShowRows.map(r => [r.userId, Number(r.count)]))

    const isAdmin = canManageUsers(session)

    // Self-deleted ("Deleted Member") accounts: attach the retained, admin-only
    // identity snapshot from the account.self_delete audit entry, so an admin
    // can trace who a deleted account was for safety. Full admins only; never
    // exposed to non-admin staff or any member-facing surface.
    const deletedIds = users.filter(u => u.email.endsWith('@deleted.smileys')).map(u => u.id)
    const identityMap = new Map<string, { name?: string; email?: string; phone?: string }>()
    if (isAdmin && deletedIds.length) {
      const snaps = await prisma.auditLog.findMany({
        where:  { action: 'account.self_delete', targetId: { in: deletedIds } },
        select: { targetId: true, meta: true },
      })
      for (const s of snaps) {
        if (s.targetId && s.meta && typeof s.meta === 'object') {
          identityMap.set(s.targetId, s.meta as { name?: string; email?: string; phone?: string })
        }
      }
    }

    const mapped = users.map(({ email, phone, password, ...u }) => {
      const displayEmail = isAdmin ? email : (email.split('@')[0].slice(0, 3) + '...@' + email.split('@')[1])
      const displayPhone = isAdmin ? phone : (phone ? phone.slice(0, 4) + '...' + phone.slice(-2) : null)
      return { ...u, email: displayEmail, phone: displayPhone, hasPassword: !!password, noShowCount: noShowMap.get(u.id) ?? 0, deletedIdentity: identityMap.get(u.id) ?? null }
    })
    return NextResponse.json(mapped)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// PATCH at this route was dead — accepted { id, role } in the body and
// duplicated the role-change logic that already lives in [id]/route.ts
// PATCH (which the admin users page actually calls via
// /api/admin/users/{id}). Removed to stop two routes drifting apart.

