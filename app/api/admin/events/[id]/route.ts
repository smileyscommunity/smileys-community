import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator, isClubHost, isClubHostFor } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { writeAudit, getDiff } from '@/lib/audit'
import { sendEventCancelledEmail, recordEmailFailure } from '@/lib/email'

type Params = { params: Promise<{ id: string }> }

export async function DELETE(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const admin    = isAdminOrModerator(session)
    const clubHost = !admin && await isClubHost(session.id)
    if (!admin && !clubHost) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params

    // City-scope check for non-admins (moderators + club hosts both need it
    // here — the previous DELETE handler gated only on hostId for club hosts
    // and let any moderator delete any event in any city).
    const eventScope = await prisma.event.findUnique({ where: { id }, select: { hostId: true, cityId: true } })
    if (!eventScope) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (clubHost && eventScope.hostId !== session.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!isAdmin(session) && session.cityId !== eventScope.cityId) {
      return NextResponse.json({ error: 'Cross-city moderation is admin-only' }, { status: 403 })
    }

    await prisma.$transaction([
      prisma.eventAttendee.deleteMany({ where: { eventId: id } }),
      prisma.waitlistEntry.deleteMany({ where: { eventId: id } }),
      prisma.review.deleteMany({ where: { eventId: id } }),
      prisma.event.delete({ where: { id } }),
    ])
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const admin    = isAdminOrModerator(session)
    const clubHost = !admin && await isClubHost(session.id)
    if (!admin && !clubHost) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params

    const before = await prisma.event.findUnique({
      where: { id },
      select: {
        hostId: true, clubId: true, cityId: true, date: true, time: true, location: true, title: true,
        neighborhood: true, price: true, memberPrice: true, totalSpots: true,
        emoji: true, isPremium: true, membersOnly: true, limitedSpots: true, status: true,
        seriesId: true,
      }
    })
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (clubHost && before.hostId !== session.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // City-scope check for non-admins. Previously a moderator could edit
    // events in any city — including emailing cancellation notices to
    // every attendee. Admins act globally.
    if (!isAdmin(session) && session.cityId !== before.cityId) {
      return NextResponse.json({ error: 'Cross-city moderation is admin-only' }, { status: 403 })
    }

    const body = await req.json()
    const { tagIds, applyToSeries } = body

    const ALLOWED_FIELDS = [
      'title', 'date', 'time', 'location', 'neighborhood', 'address', 'description',
      'totalSpots', 'spotsLeft', 'price', 'memberPrice', 'emoji', 'isPremium',
      'membersOnly', 'limitedSpots', 'vibes', 'status', 'coverImage', 'coverImagePosition', 'meetingUrl',
      'whatsappUrl', 'minAge', 'maxAge', 'language', 'difficulty', 'refundPolicy',
      'registrationDeadline', 'endTime', 'currency', 'approvalRequired', 'isRecurring',
      'lat', 'lng', 'featured', 'genderBalance', 'maleQuota', 'femaleQuota', 'turkishMaleQuota',
      'cancelReason', 'duration', 'clubId', 'hostId', 'seriesId',
    ]
    const rest: Record<string, unknown> = {}
    for (const key of ALLOWED_FIELDS) {
      if (key in body) rest[key] = body[key]
    }

    // URL validation
    const safeLocalFile = (v: unknown) => !v || /^\/app\/api\/files\/[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/.test(String(v))
    const safeHttps     = (v: unknown) => !v || (typeof v === 'string' && v.startsWith('https://'))
    if ('coverImage'  in rest && !safeLocalFile(rest.coverImage))
      return NextResponse.json({ error: 'Invalid cover image URL' }, { status: 400 })
    if ('meetingUrl'  in rest && !safeHttps(rest.meetingUrl))
      return NextResponse.json({ error: 'Meeting URL must start with https://' }, { status: 400 })
    if ('whatsappUrl' in rest && !safeHttps(rest.whatsappUrl))
      return NextResponse.json({ error: 'WhatsApp URL must start with https://' }, { status: 400 })

    // Hosts cannot reassign event ownership or move to an unmanaged club
    if (clubHost) {
      delete rest.hostId
      delete rest.featured
      if (rest.clubId && rest.clubId !== before.clubId) {
        if (!await isClubHostFor(session.id, rest.clubId as string)) {
          return NextResponse.json({ error: 'You are not a host of the target club' }, { status: 403 })
        }
      }
    }

    const data: Record<string, unknown> = { ...rest }

    // #3 fix: same numeric + range validation as the POST handler.
    // Was using `parseInt(v) || 0` which silently coerced
    // negatives and non-numeric inputs to 0 — admin typo like
    // 'twenty' became 0 spots, '-100' became -100 price. Now
    // each numeric field carries an explicit bound and 400s on
    // out-of-range.
    const numField = (v: unknown, label: string, opts: { min?: number; max?: number; allowNull?: boolean } = {}):
      number | null | { error: string } => {
      const { min = 0, max = Infinity, allowNull = false } = opts
      if (v === undefined || v === null || v === '') {
        if (allowNull) return null
        return { error: `${label} required` }
      }
      const n = Number(v)
      if (!Number.isFinite(n)) return { error: `${label} must be a number` }
      if (n < min) return { error: `${label} must be >= ${min}` }
      if (n > max) return { error: `${label} must be <= ${max}` }
      return n
    }

    const coerced: Array<[string, ReturnType<typeof numField>, { min?: number; max?: number; allowNull?: boolean }]> = [
      ['totalSpots',       numField(data.totalSpots,       'totalSpots',       { min: 1, max: 10000, allowNull: true }),  { min: 1, max: 10000 }],
      ['spotsLeft',        numField(data.spotsLeft,        'spotsLeft',        { min: 0, max: 10000, allowNull: true }),  { min: 0, max: 10000 }],
      ['price',            numField(data.price,            'price',            { min: 0, max: 100000, allowNull: true }), { min: 0, max: 100000 }],
      ['memberPrice',      numField(data.memberPrice,      'memberPrice',      { min: 0, max: 100000, allowNull: true }), { min: 0, max: 100000 }],
      ['minAge',           numField(data.minAge,           'minAge',           { min: 0, max: 120, allowNull: true }),    { min: 0, max: 120 }],
      ['maxAge',           numField(data.maxAge,           'maxAge',           { min: 0, max: 120, allowNull: true }),    { min: 0, max: 120 }],
      ['maleQuota',        numField(data.maleQuota,        'maleQuota',        { min: 0, max: 10000, allowNull: true }),  { min: 0, max: 10000 }],
      ['femaleQuota',      numField(data.femaleQuota,      'femaleQuota',      { min: 0, max: 10000, allowNull: true }),  { min: 0, max: 10000 }],
      ['turkishMaleQuota', numField(data.turkishMaleQuota, 'turkishMaleQuota', { min: 0, max: 10000, allowNull: true }),  { min: 0, max: 10000 }],
    ]
    for (const [key, val] of coerced) {
      if (val && typeof val === 'object' && 'error' in val) {
        return NextResponse.json({ error: val.error }, { status: 400 })
      }
      if (key in data) data[key] = val
    }

    // Cross-field checks.
    const N = (x: unknown) => typeof x === 'number' ? x : null
    if (N(data.minAge) !== null && N(data.maxAge) !== null && (data.maxAge as number) < (data.minAge as number)) {
      return NextResponse.json({ error: 'maxAge must be >= minAge' }, { status: 400 })
    }
    // Quota vs totalSpots — use the new value if it's being changed,
    // otherwise the existing value from `before`.
    const effectiveSpots = (data.totalSpots as number | null | undefined) ?? before.totalSpots
    for (const q of ['maleQuota', 'femaleQuota', 'turkishMaleQuota'] as const) {
      const v = N(data[q])
      if (v !== null && v > effectiveSpots) {
        return NextResponse.json({ error: `${q} (${v}) cannot exceed totalSpots (${effectiveSpots})` }, { status: 400 })
      }
    }
    // spotsLeft can't exceed totalSpots when both are present.
    if (N(data.spotsLeft) !== null && (data.spotsLeft as number) > effectiveSpots) {
      return NextResponse.json({ error: 'spotsLeft cannot exceed totalSpots' }, { status: 400 })
    }
    // Date sanity if being changed.
    if (data.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
    }
    if (data.registrationDeadline && data.date &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(data.registrationDeadline)) &&
        String(data.registrationDeadline) > String(data.date)) {
      return NextResponse.json({ error: 'registrationDeadline cannot be after the event date' }, { status: 400 })
    }

    // lat / lng — keep float parsing but reject out-of-range.
    const parseCoord = (v: unknown, label: string, lo: number, hi: number) => {
      if (v === undefined) return undefined
      if (v === null || v === '') return null
      const n = parseFloat(String(v))
      if (!Number.isFinite(n) || n < lo || n > hi) return { error: `${label} must be between ${lo} and ${hi}` }
      return n
    }
    const latParsed = parseCoord(data.lat, 'lat', -90, 90)
    const lngParsed = parseCoord(data.lng, 'lng', -180, 180)
    if (latParsed && typeof latParsed === 'object' && 'error' in latParsed) return NextResponse.json({ error: latParsed.error }, { status: 400 })
    if (lngParsed && typeof lngParsed === 'object' && 'error' in lngParsed) return NextResponse.json({ error: lngParsed.error }, { status: 400 })
    if (latParsed !== undefined) data.lat = latParsed
    if (lngParsed !== undefined) data.lng = lngParsed

    // Handle tag updates
    if (Array.isArray(tagIds)) {
      data.tags = {
        deleteMany: {},
        create: tagIds.map((tagId: string) => ({ tagId })),
      }
    }

    const event = await prisma.event.update({ where: { id }, data })

    // Propagate changes to all future events in the same series (except date/time which are per-event)
    if (applyToSeries && before.seriesId) {
      const SERIES_EXCLUDED = new Set(['date', 'time', 'registrationDeadline', 'seriesId', 'tags'])
      const seriesData: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(data)) {
        if (!SERIES_EXCLUDED.has(k)) seriesData[k] = v
      }
      if (Object.keys(seriesData).length > 0) {
        const today = new Date().toISOString().split('T')[0]
        await prisma.event.updateMany({
          where: { seriesId: before.seriesId, id: { not: id }, date: { gte: today } },
          data: seriesData,
        })
      }
    }

    // Log enriched audit
    const diff = getDiff(before, rest)
    if (diff) {
      writeAudit(session.id, session.name, 'event.update', id, 'event',
        { diff, title: before.title },
        `Updated event "${before.title}"`
      )
    }

    // Notify new host if host assignment changed
    if (rest.hostId && rest.hostId !== before.hostId) {
      createNotification(
        rest.hostId as string,
        'host_assigned',
        'You\'ve been assigned to host an event! 🎤',
        `You've been assigned as host for "${before.title}". Head to your host panel to manage it.`,
        '/host/events'
      ).catch(() => {})
    }

    // Notify attendees if date, time, or location changed
    const changed = (body.date && body.date !== before.date) ||
                    (body.time && body.time !== before.time) ||
                    (body.location && body.location !== before.location)
    if (changed) {
      ;(async () => {
        const attendees = await prisma.eventAttendee.findMany({ where: { eventId: id, status: 'approved' }, select: { userId: true } })
        await Promise.all(attendees.map(a =>
          createNotification(a.userId, 'event_updated', 'Event details changed 📅', `"${before.title}" has been updated — check the new time or location`, `/events/${id}`)
        ))
      })().catch(() => {})
    }

    // Email all approved attendees if event was just cancelled
    if (body.status === 'cancelled' && before.status !== 'cancelled') {
      ;(async () => {
        const attendees = await prisma.eventAttendee.findMany({
          where: { eventId: id, status: 'approved' },
          include: { user: { select: { email: true, name: true } } },
        })
        // EM2 fix: collect failure count instead of silently
        // swallowing each per-attendee email. Mass-send means a
        // misconfigured SMTP could leave dozens of members
        // un-notified about a cancelled event they were going to
        // show up to. Log the aggregate so the failure is grep-
        // able by eventId.
        const emailResults = await Promise.all(attendees.map(a =>
          sendEventCancelledEmail(a.user.email, a.user.name ?? 'Member', before.title, before.date)
            .then(() => ({ ok: true as const }))
            .catch(async err => {
              await recordEmailFailure({ helper: 'sendEventCancelledEmail', recipient: a.user.email, error: err, context: { eventId: id, userId: a.userId } })
              return { ok: false as const, err: String(err), email: a.user.email }
            }),
        ))
        const failures = emailResults.filter(r => !r.ok)
        if (failures.length > 0) {
          console.error('[event PATCH cancel] sendEventCancelledEmail failures', {
            eventId: id, total: attendees.length, failed: failures.length,
            sample: failures.slice(0, 3),
          })
        }
        // Also notify in-app (same logging treatment).
        const notifyResults = await Promise.all(attendees.map(a =>
          createNotification(a.userId, 'event_cancelled', 'Event cancelled 😔', `"${before.title}" has been cancelled.`, '/events')
            .then(() => ({ ok: true as const }))
            .catch(err => ({ ok: false as const, err: String(err) })),
        ))
        const notifyFail = notifyResults.filter(r => !r.ok).length
        if (notifyFail > 0) {
          console.error('[event PATCH cancel] in-app notification failures', { eventId: id, failed: notifyFail })
        }
      })().catch(err => console.error('[event PATCH cancel] fan-out failed', { eventId: id, err: String(err) }))
    }

    return NextResponse.json(event)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// Moderators can change event status (approve / flag / unpublish)
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const { status } = await req.json()
    const allowed = ['published', 'flagged', 'unpublished', 'pending']
    if (!allowed.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const before = await prisma.event.findUnique({
      where: { id },
      select: { title: true, hostId: true, clubId: true, status: true, cityId: true },
    })
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // City scope — moderators can only change status on events in
    // their own city. Admins act globally.
    if (!isAdmin(session) && session.cityId !== before.cityId) {
      return NextResponse.json({ error: 'Cross-city moderation is admin-only' }, { status: 403 })
    }

    const event = await prisma.event.update({ where: { id }, data: { status } })

    writeAudit(session.id, session.name, `event.${status}`, id, 'event',
      { status },
      `Event status set to ${status}`,
    )

    // When approving a pending event: notify host + club members
    if (status === 'published' && before.status === 'pending') {
      ;(async () => {
        // Notify the host
        if (before.hostId) {
          await createNotification(
            before.hostId, 'host_assigned',
            'Your event has been approved! 🎉',
            `"${before.title}" is now live and visible to members.`,
            `/host/events`,
          ).catch(() => {})
        }
        // Notify club members
        if (before.clubId) {
          const [members, club] = await Promise.all([
            prisma.clubMembership.findMany({
              where: { clubId: before.clubId, status: 'approved', userId: { not: before.hostId ?? undefined } },
              select: { userId: true },
            }),
            prisma.club.findUnique({ where: { id: before.clubId }, select: { name: true } }),
          ])
          await Promise.all(members.map(m =>
            createNotification(m.userId, 'new_event',
              `New event in ${club?.name ?? 'your club'} 🎉`,
              `"${before.title}" has just been posted`,
              `/events/${id}`,
            )
          ))
        }
      })().catch(() => {})
    }

    return NextResponse.json(event)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
