import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isModerator, isClubHost, isClubHostFor } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { todayIstanbul } from '@/lib/data'

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const admin    = isAdmin(session) || isModerator(session)
    const clubHost = !admin && await isClubHost(session.id)
    if (!admin && !clubHost) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const showArchived = req.nextUrl.searchParams.get('archived') === '1'
    const statusParam  = req.nextUrl.searchParams.get('status')
    // Optional date floor + row cap — added so the admin dashboard can ask
    // for "next N upcoming events" in one round trip instead of fetching
    // everything and slicing client-side. Validated cheaply: from must be
    // YYYY-MM-DD, take must be 1–100.
    const fromParam    = req.nextUrl.searchParams.get('from')
    const takeRaw      = req.nextUrl.searchParams.get('take')
    const takeParam    = takeRaw && /^\d+$/.test(takeRaw) && +takeRaw > 0 && +takeRaw <= 100
                         ? +takeRaw : undefined
    const fromValid    = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : undefined

    const where: any = {
      ...(clubHost ? { hostId: session.id } : {}),
      ...(!showArchived && !statusParam ? { status: { not: 'archived' } } : {}),
      ...(fromValid ? { date: { gte: fromValid } } : {}),
    }
    if (statusParam) where.status = statusParam

    const events = await prisma.event.findMany({
      where,
      orderBy: { date: 'asc' },
      ...(takeParam ? { take: takeParam } : {}),
      select: {
        id: true, title: true, date: true, time: true, emoji: true,
        status: true, totalSpots: true, spotsLeft: true, clubId: true, hostId: true,
        neighborhood: true, coverImage: true, price: true, currency: true,
        membersOnly: true, featured: true, isRecurring: true, seriesId: true,
        _count: { select: { attendees: { where: { status: 'approved' } } } },
      },
    })

    // Attach host names in one extra query
    const hostIds = [...new Set(events.map(e => e.hostId).filter(Boolean))] as string[]
    const hostUsers = hostIds.length
      ? await prisma.user.findMany({ where: { id: { in: hostIds } }, select: { id: true, name: true, color: true, profilePhoto: true } })
      : []
    const hostMap = Object.fromEntries(hostUsers.map(u => [u.id, u]))

    const result = events.map(e => ({
      ...e,
      host: e.hostId ? (hostMap[e.hostId] ?? null) : null,
    }))

    return NextResponse.json(result)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const admin    = isAdmin(session)
    const clubHost = !admin && await isClubHost(session.id)
    const canCreate = admin || clubHost || isModerator(session)
    if (!canCreate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const { title, date, time, location, neighborhood, clubId, hostId, description,
            totalSpots, price, memberPrice, emoji, isPremium, membersOnly, limitedSpots,
            vibes, tagIds, tags, status, coverImage, coverImagePosition, meetingUrl, whatsappUrl, address,
            minAge, maxAge, language, difficulty,
            refundPolicy, registrationDeadline, endTime, currency, approvalRequired,
            // Pre-existing gap: genderBalance + the three quotas were destructured
            // nowhere, so admin-form gender-balance settings silently never made
            // it to prisma.event.create. Fix while adding femaleQuota.
            genderBalance, maleQuota, femaleQuota, turkishMaleQuota,
            isRecurring, seriesId, lat, lng } = body

    if (!title || !date || !time || !location || !clubId || !hostId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (clubHost && (!description?.trim() || !coverImage || !address?.trim())) {
      return NextResponse.json({ error: 'Description, cover image, and full address are required' }, { status: 400 })
    }

    // URL validation
    const safeLocalFile = (v: unknown) => !v || /^\/app\/api\/files\/[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/.test(String(v))
    const safeHttps     = (v: unknown) => !v || (typeof v === 'string' && v.startsWith('https://'))
    if (!safeLocalFile(coverImage))  return NextResponse.json({ error: 'Invalid cover image URL' }, { status: 400 })
    if (!safeHttps(meetingUrl))      return NextResponse.json({ error: 'Meeting URL must start with https://' }, { status: 400 })
    if (!safeHttps(whatsappUrl))     return NextResponse.json({ error: 'WhatsApp URL must start with https://' }, { status: 400 })

    if (clubHost) {
      // Club hosts can only create events for themselves
      if (hostId !== session.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      // Club hosts can only create events for clubs where they have host role
      if (!await isClubHostFor(session.id, clubId)) {
        return NextResponse.json({ error: 'You must be assigned as a host of this club to create events for it' }, { status: 403 })
      }
    }

    const spots = parseInt(totalSpots) || 20

    // Resolve tagIds: accept either explicit IDs or tag names (vibes)
    let resolvedTagIds: string[] = tagIds ?? []
    if (!resolvedTagIds.length && vibes?.length) {
      const tagRecords = await prisma.tag.findMany({ where: { name: { in: vibes } } })
      resolvedTagIds = tagRecords.map(t => t.id)
    }

    // Non-admins/non-moderators always create events in pending for review
    // This covers the timing issue where a host creates their first event before
    // their club host membership is saved (form assigns host role after event creation)
    const isFree        = !parseInt(price) && !memberPrice
    const weekOut       = todayIstanbul(7)
    const tooFarOut     = isFree && date > weekOut
    const needsReview   = !admin && !isModerator(session)
    const eventStatus   = needsReview ? 'pending' : (tooFarOut ? 'pending' : (status ?? 'published'))

    // Events inherit their city from the parent club — keeps Sailing
    // Istanbul events out of the Berlin feed even if a host belongs
    // to both cities. Fail loudly if the club has no cityId because
    // every club has one post-backfill; this would only fire on a
    // bug.
    const parentClub = await prisma.club.findUnique({ where: { id: clubId }, select: { cityId: true } })
    if (!parentClub?.cityId) {
      return NextResponse.json({ error: 'Parent club has no city — cannot create event' }, { status: 400 })
    }

    const event = await prisma.event.create({
      data: {
        title:                title.trim(),
        date, time,
        location:             location.trim(),
        neighborhood:         neighborhood?.trim() ?? '',
        address:              address?.trim() ?? '',
        clubId, hostId,
        cityId:               parentClub.cityId,
        description:          description?.trim() ?? '',
        totalSpots:           spots,
        spotsLeft:            spots,
        price:                parseInt(price) || 0,
        memberPrice:          memberPrice ? parseInt(memberPrice) : null,
        emoji:                emoji || '🎉',
        isPremium:            isPremium ?? false,
        membersOnly:          membersOnly ?? false,
        limitedSpots:         limitedSpots ?? true,
        vibes:                vibes ?? [],
        status:               eventStatus,
        coverImage:           coverImage           ?? null,
        coverImagePosition:   coverImagePosition   ?? 50,
        meetingUrl:           meetingUrl           ?? null,
        whatsappUrl:          whatsappUrl ?? null,
        minAge:               minAge ? parseInt(minAge) : null,
        maxAge:               maxAge ? parseInt(maxAge) : null,
        language:             language ?? null,
        difficulty:           difficulty ?? null,
        refundPolicy:         refundPolicy ?? null,
        registrationDeadline: registrationDeadline ?? null,
        endTime:              endTime ?? null,
        currency:             currency ?? 'TRY',
        approvalRequired:     approvalRequired ?? false,
        // Gender balance + quotas — null defaults so explicit-off doesn't
        // get coerced to 0. Cast numbers explicitly since the form ships
        // them as strings from <input type=number>.
        genderBalance:        genderBalance ?? false,
        maleQuota:            maleQuota        ? parseInt(maleQuota)        : null,
        femaleQuota:          femaleQuota      ? parseInt(femaleQuota)      : null,
        turkishMaleQuota:     turkishMaleQuota ? parseInt(turkishMaleQuota) : null,
        isRecurring:          isRecurring ?? false,
        seriesId:             seriesId    ?? null,
        lat:                  lat != null && lat !== '' ? parseFloat(lat) : null,
        lng:                  lng != null && lng !== '' ? parseFloat(lng) : null,
        tags: resolvedTagIds.length
          ? { create: resolvedTagIds.map(tagId => ({ tagId })) }
          : undefined,
      },
      include: { tags: { include: { tag: { include: { group: true } } } } },
    })

    // Notify the assigned host if an admin created the event on their behalf
    if (admin && hostId !== session.id) {
      createNotification(
        hostId,
        'host_assigned',
        'You\'ve been assigned to host an event! 🎤',
        `You've been assigned as host for "${title.trim()}". Head to your host panel to manage it.`,
        '/host/events'
      ).catch(() => {})
    }

    // Notify admins when a host submits an event for approval
    if (clubHost) {
      ;(async () => {
        const admins = await prisma.user.findMany({ where: { role: 'admin' }, select: { id: true } })
        await Promise.all(admins.map(a =>
          createNotification(a.id, 'host_message',
            `New event needs approval 📋`,
            `"${title.trim()}" submitted by ${session.name} — tap to review and publish.`,
            `/admin/events/${event.id}/edit`,
          )
        ))
      })().catch(() => {})
    }

    // Notify all club members about the new event (fire-and-forget)
    if (eventStatus === 'published') {
      ;(async () => {
        const [members, club] = await Promise.all([
          prisma.clubMembership.findMany({ where: { clubId, status: 'approved', userId: { not: hostId } }, select: { userId: true } }),
          prisma.club.findUnique({ where: { id: clubId }, select: { name: true } }),
        ])
        await Promise.all(members.map(m =>
          createNotification(m.userId, 'new_event', `New event in ${club?.name ?? 'your club'} 🎉`, `"${title.trim()}" has just been posted`, `/events/${event.id}`)
        ))
      })().catch(() => {})
    }

    return NextResponse.json(event)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
