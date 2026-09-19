import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getSession, createSession, deleteSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isClubHost, hostCityIds } from '@/lib/access'
import { formatName } from '@/lib/data'
import { getDefaultCityId } from '@/lib/city'
import { normalizeNeighborhoodInput } from '@/lib/neighborhoodsDb'
import { validateProfileField } from '@/lib/profileFields'
import { rateLimit } from '@/lib/rateLimit'
import { writeAudit } from '@/lib/audit'
import { todayInCity } from '@/lib/city'

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

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json(null)
  try {
    const FIFTEEN_MINUTES = 15 * 60 * 1000
    const [user, clubHostCount, cityIds, cohostCount, stats] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.id },
        select: {
          id: true, name: true, email: true, role: true,
          color: true, emailVerified: true, joinedAt: true,
          bio: true, neighborhood: true, instagram: true, linkedin: true, lookingFor: true, profileVisibility: true,
          phone: true, gender: true, nationality: true, languages: true, interests: true, socialStyles: true,
          status: true, membershipType: true, profilePhoto: true, lastActive: true,
          partnerId: true, suspendedUntil: true, totpEnabled: true,
          openToCoffee: true, openToLanguage: true, openToHosting: true, neighborhoodVisible: true,
          // The settings toggle defaulted to ON when this was missing, so a
          // member who unsubscribed from an email footer was shown as
          // subscribed — a consent surface saying the opposite of the truth.
          emailMarketing: true,
          industry: true, professionalRole: true, professionalStatus: true,
        },
      }),
      prisma.clubMembership.count({
        // Inactive clubs grant nothing — same count as lib/access isClubHost.
        where: { userId: session.id, status: 'approved', role: 'host', club: { isActive: true } },
      }),
      // City-level hosting authority (consul / city-host grant). The /host
      // panel gates read this — without it the panel is unreachable for
      // anyone whose only authority is city-level. Recomputed on every call,
      // so a revoked grant stops counting on the next /me fetch.
      hostCityIds(session.id),
      // Co-hosting a recent or upcoming event opens Check-In for it (lib/auth
      // canRunDoor) — a plain member co-host had no way to the roster at all.
      // Same eight-day floor as the door list (lib/checkInPrompt doorEventsWhere).
      // A failed count reads as "not a co-host": the catch below ends the
      // session, and a convenience flag must not sign anyone out.
      prisma.eventCoHost.count({
        where: { userId: session.id, event: { cancelledAt: null, date: { gte: new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10) } } },
      }).catch(() => 0),
      // Only the profile page shows these; every page load calls /me.
      req.nextUrl.searchParams.get('stats') === '1'
        ? ownStats(session.id, session.cityId ?? null).catch(() => null)
        : Promise.resolve(undefined),
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
    return NextResponse.json({ ...user, isClubHost, hostCityIds: cityIds, runsEvents: cohostCount > 0, stats })
  } catch (e) {
    // A database hiccup is not a reason to sign someone out — every page
    // that polls /me used to drop the session on any thrown error, so a
    // blip logged out whoever was online. Ban, suspension and role changes
    // above still end the session; a failure here just fails the request.
    console.error('[auth/me]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// The counts on the member's own profile. They used to be the lengths of
// "events I'm attending" (upcoming and pending included) and "clubs I've
// asked to join" — so a member who'd RSVP'd to five things and gone to none
// read "5 events". Now: past events they were approved for and didn't
// no-show, and approved memberships in clubs that still exist.
async function ownStats(userId: string, cityId: string | null) {
  const today = await todayInCity(cityId ?? await getDefaultCityId())
  const [eventsAttended, clubs] = await Promise.all([
    prisma.eventAttendee.count({
      where: {
        userId, status: 'approved', attendance: { not: 'no_show' },
        event: { date: { lt: today }, status: { in: ['published', 'archived'] }, cancelledAt: null },
      },
    }),
    prisma.clubMembership.count({ where: { userId, status: 'approved', club: { isActive: true } } }),
  ])
  return { eventsAttended, clubs }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // Each save mints a JWT and writes the session row; a stuck client
    // retrying shouldn't hammer that.
    if (!await rateLimit(`profile-save:${session.id}`, 60, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = await req.json()
    const allowed = ['name', 'bio', 'neighborhood', 'instagram', 'linkedin', 'lookingFor', 'color',
                     'phone', 'gender', 'nationality', 'languages', 'interests', 'profileVisibility', 'socialStyles', 'emailMarketing',
                     'openToCoffee', 'openToLanguage', 'openToHosting', 'neighborhoodVisible',
                     'industry', 'professionalRole', 'professionalStatus']
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const data: Record<string, unknown> = {}
    for (const key of allowed) {
      if (!(key in body)) continue
      const checked = validateProfileField(key, body[key])
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
      data[key] = checked.value
    }

    // Booleans were previously copied through unchecked, so a non-boolean
    // reached Prisma and surfaced as a 500. Reject them explicitly instead —
    // for neighborhoodVisible in particular a silently-coerced value would
    // decide whether someone appears in neighborhood discovery.
    for (const key of ['emailMarketing', 'openToCoffee', 'openToLanguage', 'openToHosting', 'neighborhoodVisible']) {
      if (key in data && typeof data[key] !== 'boolean') {
        return NextResponse.json({ error: `${key} must be true or false` }, { status: 400 })
      }
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

    // Phone is mandatory (hosts chase no-shows on WhatsApp) — members can
    // change it but never clear it. Same length cap as the apply form.
    if ('phone' in data) {
      const v = data.phone
      if (typeof v !== 'string' || !v.trim() || v.length > 30) {
        return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
      }
      data.phone = v.trim()
    }

    // Neighborhood must be one of the member's OWN city's active
    // neighborhoods. Every neighborhood feature matches this value by name, so
    // an unrecognised one silently excludes the member from all of them while
    // the profile looks complete — this route is where 21 empty strings and a
    // set of hand-typed, diacritic-stripped names got in (see
    // scripts/archive/fix-member-neighborhoods.ts). Blank clears it; anything else has
    // to be real, and the picker only ever offers real ones.
    if ('neighborhood' in data) {
      const homeCityId = session.cityId ?? await getDefaultCityId()
      const parsed = await normalizeNeighborhoodInput(homeCityId, data.neighborhood)
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
      data.neighborhood = parsed.value
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

    // profilePhoto must be a users/ upload path or empty. The folder is pinned
    // to `users` (not a wildcard): a member's own avatar can only ever live
    // there — the upload route already restricts non-privileged uploads to
    // users/ — and allowing any folder let a member point their profilePhoto
    // at a gated applications/ file, which the file route then had to serve.
    if ('profilePhoto' in body) {
      const photo = body.profilePhoto
      if (photo === null || photo === '') {
        data.profilePhoto = null
      } else if (typeof photo === 'string' && /^\/app\/api\/files\/users\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/.test(photo)) {
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

    // Hosts can't go private — members must be able to find and view the
    // people running events/clubs. Silently force club hosts back to
    // 'everyone' if they try to set 'connections only'.
    if (data.profileVisibility === 'connections' && await isClubHost(session.id)) {
      data.profileVisibility = 'everyone'
    }

    // Gender stays editable, but a change is on the record: the connection-
    // abuse scans key on it (they read the application's copy, so an edit
    // here can't slip anyone past them), and staff should be able to see
    // when and from what it changed.
    const before = 'gender' in data
      ? await prisma.user.findUnique({ where: { id: session.id }, select: { gender: true } })
      : null

    const updated = await prisma.user.update({ where: { id: session.id }, data })

    if (before && before.gender !== updated.gender) {
      await writeAudit(session.id, session.name, 'member.gender_changed', session.id, 'user',
        { from: before.gender, to: updated.gender, cityId: updated.cityId },
        `Changed their gender from ${before.gender ?? 'unset'} to ${updated.gender ?? 'unset'}`)
    }

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

    // What was saved, after normalising — the editor refreshes from this so
    // a formatted name or a URL turned into a handle shows as stored.
    return NextResponse.json({
      ok: true,
      user: {
        name: updated.name, color: updated.color, bio: updated.bio, neighborhood: updated.neighborhood,
        emailMarketing: updated.emailMarketing,
        instagram: updated.instagram, linkedin: updated.linkedin, lookingFor: updated.lookingFor,
        profileVisibility: updated.profileVisibility, phone: updated.phone, gender: updated.gender,
        nationality: updated.nationality, languages: updated.languages, interests: updated.interests,
        socialStyles: updated.socialStyles, profilePhoto: updated.profilePhoto,
        openToCoffee: updated.openToCoffee, openToLanguage: updated.openToLanguage, openToHosting: updated.openToHosting,
        neighborhoodVisible: updated.neighborhoodVisible,
        industry: updated.industry, professionalRole: updated.professionalRole, professionalStatus: updated.professionalStatus,
      },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
