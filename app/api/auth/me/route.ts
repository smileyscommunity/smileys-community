import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getSession, createSession, deleteSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isClubHost } from '@/lib/access'
import { formatName } from '@/lib/data'

// Pull userAgent + IP from the inbound request when /me has no NextRequest
// argument (GET). Same shape as lib/rateLimit.ts getIp — kept inline to
// avoid pulling a hard import here.
async function fingerprint() {
  const h = await headers()
  return {
    userAgent: h.get('user-agent'),
    ip:        h.get('x-real-ip')
            ?? h.get('x-forwarded-for')?.split(',').pop()?.trim()
            ?? null,
  }
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json(null)
  try {
    const FIFTEEN_MINUTES = 15 * 60 * 1000
    const [user, clubHostCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.id },
        select: {
          id: true, name: true, email: true, role: true,
          color: true, emailVerified: true, joinedAt: true,
          bio: true, neighborhood: true, instagram: true, linkedin: true, lookingFor: true, profileVisibility: true,
          phone: true, gender: true, nationality: true, languages: true, interests: true, socialStyles: true,
          status: true, membershipType: true, profilePhoto: true, lastActive: true,
          partnerId: true, suspendedUntil: true, totpEnabled: true,
          openToCoffee: true, openToLanguage: true, openToHosting: true,
          industry: true, professionalRole: true, professionalStatus: true,
        },
      }),
      prisma.clubMembership.count({
        where: { userId: session.id, status: 'approved', role: 'host' },
      }),
    ])
    const stale = !user?.lastActive || (Date.now() - new Date(user.lastActive).getTime()) > FIFTEEN_MINUTES
    if (stale) {
      prisma.user.update({ where: { id: session.id }, data: { lastActive: new Date() } }).catch(() => {})
    }
    if (user?.status === 'banned') {
      await deleteSession()
      return NextResponse.json({ error: 'banned' }, { status: 403 })
    }
    if (user?.suspendedUntil && new Date(user.suspendedUntil) > new Date()) {
      await deleteSession()
      return NextResponse.json({ error: 'suspended' }, { status: 403 })
    }
    // Role changes are a privilege boundary — force re-login rather than silently
    // upgrading the JWT (defends against DB-side role tampering and stolen tokens).
    if (user && user.role !== session.role) {
      await deleteSession()
      return NextResponse.json({ error: 'role_changed' }, { status: 401 })
    }
    // partnerId is not a privilege boundary — safe to auto-update.
    if (user && user.partnerId !== session.partnerId) {
      // For tracked sessions (has sessionId from jti), keep the row.
      // For legacy sessions (no jti, pre-Session-table), pass userAgent+ip
      // so the freshly-created row in /settings looks like a real device
      // rather than an unidentifiable Unknown/Unknown row.
      const opts = session.sessionId
        ? { reuseSessionId: session.sessionId }
        : await fingerprint()
      await createSession(
        { ...session, partnerId: user.partnerId || undefined },
        opts,
      )
    }
    if (!user) { await deleteSession(); return NextResponse.json(null) }
    const isClubHost = clubHostCount > 0
    return NextResponse.json({ ...user, isClubHost })
  } catch {
    await deleteSession()
    return NextResponse.json(null)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const allowed = ['name', 'bio', 'neighborhood', 'instagram', 'linkedin', 'lookingFor', 'color',
                     'phone', 'gender', 'nationality', 'languages', 'interests', 'profileVisibility', 'socialStyles', 'emailMarketing',
                     'openToCoffee', 'openToLanguage', 'openToHosting',
                     'industry', 'professionalRole', 'professionalStatus']
    const data: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) data[key] = body[key]
    }

    // Normalise professional fields. Empty strings → null so members
    // can clear them cleanly; status validated against the closed set
    // so an attacker can't poison the value used downstream by the
    // Pro directory filter.
    const PRO_STATUSES = new Set(['social_only', 'open_to_networking', 'hiring', 'seeking_advice'])
    for (const key of ['industry', 'professionalRole']) {
      if (key in data) {
        const v = data[key]
        if (v === null || v === '') data[key] = null
        else if (typeof v !== 'string' || v.length > 60) return NextResponse.json({ error: `${key} invalid` }, { status: 400 })
        else data[key] = v.trim()
      }
    }
    if ('professionalStatus' in data) {
      const v = data.professionalStatus
      if (v === null || v === '') data.professionalStatus = null
      else if (typeof v !== 'string' || !PRO_STATUSES.has(v)) {
        return NextResponse.json({ error: 'professionalStatus invalid' }, { status: 400 })
      }
    }

    // Nationality is mandatory (it drives the profile flag) — members can
    // change it but never clear it.
    if ('nationality' in data) {
      const v = data.nationality
      if (typeof v !== 'string' || !v.trim() || v.length > 60) {
        return NextResponse.json({ error: 'Nationality is required' }, { status: 400 })
      }
      data.nationality = v.trim()
    }

    // profilePhoto must be a local upload path or empty
    if ('profilePhoto' in body) {
      const photo = body.profilePhoto
      if (photo === null || photo === '') {
        data.profilePhoto = null
      } else if (typeof photo === 'string' && /^\/app\/api\/files\/[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/.test(photo)) {
        data.profilePhoto = photo
      } else {
        return NextResponse.json({ error: 'Invalid photo URL' }, { status: 400 })
      }
    }

    // Length limits
    if (data.name && String(data.name).length > 100)
      return NextResponse.json({ error: 'Name too long' }, { status: 400 })
    if (typeof data.name === 'string') {
      const name = formatName(data.name)
      // formatName trims + collapses whitespace, so a blank/whitespace-only
      // submission normalises to '' — reject it rather than persist an empty
      // name that breaks initials/avatars downstream.
      if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
      // First AND last name are mandatory: the profile form merges them into
      // one field, so a single word means the last name was cleared.
      if (!name.includes(' ')) return NextResponse.json({ error: 'Last name is required' }, { status: 400 })
      data.name = name
    }
    if (data.bio && String(data.bio).length > 1000)
      return NextResponse.json({ error: 'Bio too long' }, { status: 400 })
    if (data.instagram && String(data.instagram).length > 100)
      return NextResponse.json({ error: 'Instagram handle too long' }, { status: 400 })
    if (data.linkedin && String(data.linkedin).length > 100)
      return NextResponse.json({ error: 'LinkedIn too long' }, { status: 400 })

    // Hosts can't go private — members must be able to find and view the
    // people running events/clubs. Silently force club hosts back to
    // 'everyone' if they try to set 'connections only'.
    if (data.profileVisibility === 'connections' && await isClubHost(session.id)) {
      data.profileVisibility = 'everyone'
    }

    const updated = await prisma.user.update({ where: { id: session.id }, data })

    // Same legacy-vs-tracked branch as the GET partner-refresh path.
    const opts = session.sessionId
      ? { reuseSessionId: session.sessionId }
      : {
          userAgent: req.headers.get('user-agent'),
          ip:        req.headers.get('x-real-ip')
                  ?? req.headers.get('x-forwarded-for')?.split(',').pop()?.trim()
                  ?? null,
        }
    await createSession(
      {
        ...session,
        name:  updated.name  ?? session.name,
        color: updated.color ?? session.color,
      },
      opts,
    )

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
