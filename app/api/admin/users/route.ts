import { canManageUsers, canViewUserList } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !canViewUserList(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

    const users = await prisma.user.findMany({
      where: {
        ...(status && { status }),
        ...searchClause,
      },
      orderBy: { joinedAt: 'desc' },
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
      },
    })

    const isAdmin = canManageUsers(session)
    const mapped = users.map(({ email, phone, password, ...u }) => {
      const displayEmail = isAdmin ? email : (email.split('@')[0].slice(0, 3) + '...@' + email.split('@')[1])
      const displayPhone = isAdmin ? phone : (phone ? phone.slice(0, 4) + '...' + phone.slice(-2) : null)
      return { ...u, email: displayEmail, phone: displayPhone, hasPassword: !!password }
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

