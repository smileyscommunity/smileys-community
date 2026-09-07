import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isModerator, isClubHost, isClubHostFor, failClosedCityId, hostCityIds } from '@/lib/access'
import { createNotification, notifyNewEvent } from '@/lib/notify'
import {splitLeadingEmoji, stripDupTrailingEmoji} from '@/lib/data'
import { normalizePaymentContact } from '@/lib/safeUrl'
import { computeEventSurveyRollup } from '@/lib/survey'
import { ensurePendingVenueBusiness } from '@/lib/venueDirectory'
import { todayInCity, resolveTargetCityId, getCityConfig } from '@/lib/city'

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
    // Optional city filter, so the dashboard's upcoming-events panel can
    // follow the same city as the numbers above it. Unset means every city,
    // which is the long-standing behaviour of this endpoint.
    const cityParam    = req.nextUrl.searchParams.get('city')
    // Moderators fail closed to their own city, like every sibling admin
    // list (this route treated them as admins and let a Bodrum moderator
    // read every city's event roster). Admins see all, or one via ?city=;
    // the param can never WIDEN a moderator's scope.
    const cityScope: Prisma.EventWhereInput = isAdmin(session)
      ? (cityParam ? { cityId: cityParam } : {})
      : isModerator(session)
        ? { cityId: failClosedCityId(session) }
        : {}

    const where: Prisma.EventWhereInput = {
      ...(clubHost ? { hostId: session.id } : {}),
      ...cityScope,
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
        membersOnly: true, featured: true, soldOut: true, isRecurring: true, seriesId: true,
        isFirstTimerFriendly: true,
        city: { select: { name: true, slug: true } },
        _count: { select: { attendees: { where: { status: 'approved' } } } },
      },
    })

    // Attach host names in one extra query
    const hostIds = [...new Set(events.map(e => e.hostId).filter(Boolean))] as string[]
    const hostUsers = hostIds.length
      ? await prisma.user.findMany({ where: { id: { in: hostIds } }, select: { id: true, name: true, color: true, profilePhoto: true } })
      : []
    const hostMap = Object.fromEntries(hostUsers.map(u => [u.id, u]))

    // Survey rollup — shared helper does the five-groupBy reconciliation
    // including eligibleAttendees + responseRate. Same shape used on
    // /admin/users/[id] host quality and /admin/clubs/[id] quality card.
    const surveyMap = await computeEventSurveyRollup(events.map(e => e.id))

    const result = events.map(e => ({
      ...e,
      host:   e.hostId ? (hostMap[e.hostId] ?? null) : null,
      survey: surveyMap.get(e.id) ?? null,
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
    // City hosts (consuls) run their city's events without per-club host
    // grants — until now the panel advertised "+ New Event" to them and this
    // gate answered 403. Bounded like club hosts: own hostId only, clubs of a
    // city they host only (checked below once the parent club resolves), and
    // their events still land in the review queue like any non-staff host's.
    const cityHostOf = (!admin && !clubHost && !isModerator(session)) ? await hostCityIds(session.id) : []
    const cityHost   = cityHostOf.length > 0
    const canCreate = admin || clubHost || isModerator(session) || cityHost
    if (!canCreate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const { title, date, time, location, neighborhood, clubId, hostId, description,
            totalSpots, price, memberPrice, payTo, paymentContact, ticketUrl, intent, emoji, isPremium, membersOnly, limitedSpots, isFirstTimerFriendly,
            vibes, tagIds, tags, status, coverImage, coverImagePosition, meetingUrl, whatsappUrl, address,
            minAge, maxAge, language, difficulty,
            refundPolicy, registrationDeadline, endTime, currency, approvalRequired,
            // Pre-existing gap: genderBalance + the three quotas were destructured
            // nowhere, so admin-form gender-balance settings silently never made
            // it to prisma.event.create. Fix while adding femaleQuota.
            genderBalance, maleQuota, femaleQuota, turkishMaleQuota,
            // cityId is only read when the parent club is global (cityId
            // null) and so has no city to give the event — see below.
            cityId,
            isRecurring, seriesId, lat, lng } = body

    if (!title || !date || !time || !location || !clubId || !hostId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // A leading emoji typed into the title would render doubled everywhere
    // (every surface shows the emoji field next to the title) — move it
    // into the emoji field instead, unless one was chosen explicitly.
    const { emoji: titleEmoji, title: titleSansLeading } = splitLeadingEmoji(String(title))
    const finalEmoji = emoji || titleEmoji || '🎉'
    const cleanTitle = stripDupTrailingEmoji(titleSansLeading, finalEmoji)

    if (clubHost && (!description?.trim() || !coverImage || !address?.trim())) {
      return NextResponse.json({ error: 'Description, cover image, and full address are required' }, { status: 400 })
    }

    // URL validation
    const safeLocalFile = (v: unknown) => !v || /^\/app\/api\/files\/[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/.test(String(v))
    const safeHttps     = (v: unknown) => !v || (typeof v === 'string' && v.startsWith('https://'))
    if (!safeLocalFile(coverImage))  return NextResponse.json({ error: 'Invalid cover image URL' }, { status: 400 })
    if (!safeHttps(meetingUrl))      return NextResponse.json({ error: 'Meeting URL must start with https://' }, { status: 400 })
    if (!safeHttps(whatsappUrl))     return NextResponse.json({ error: 'WhatsApp URL must start with https://' }, { status: 400 })
    if (!safeHttps(ticketUrl))       return NextResponse.json({ error: 'Ticket URL must start with https://' }, { status: 400 })

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
    // City hosts likewise host only their own events; the club-belongs-to-
    // their-city check runs below, where the parent club's city resolves.
    if (cityHost && hostId !== session.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // #3 fix: numeric + range validation. P6 in the payment audit
    // was defense-in-depth at the payment-creation site; this is
    // the upstream gate. A negative price or impossible quota now
    // gets a 400 instead of silently corrupting the event row.
    //
    // Bounds are intentionally generous — we're catching admin
    // typos and bad client state, not enforcing brand rules.
    const numField = (v: unknown, label: string, opts: { min?: number; max?: number; allowNull?: boolean } = {}) => {
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

    const parsedPrice       = numField(price,       'price',       { min: 0, max: 100000 })
    const parsedMemberPrice = numField(memberPrice, 'memberPrice', { min: 0, max: 100000, allowNull: true })
    // Closed set — payTo drives whether RSVP creates payment ledger rows.
    if (payTo != null && payTo !== '' && payTo !== 'venue' && payTo !== 'smileys') {
      return NextResponse.json({ error: 'payTo must be venue or smileys' }, { status: 400 })
    }
    // Closed set — the host form's Event Goal selector was previously
    // dropped here (never destructured), silently defaulting to social.
    if (intent != null && intent !== '' && intent !== 'social' && intent !== 'professional') {
      return NextResponse.json({ error: 'intent must be social or professional' }, { status: 400 })
    }
    const contact = normalizePaymentContact(paymentContact)
    if (contact instanceof Error) {
      return NextResponse.json({ error: contact.message }, { status: 400 })
    }
    // totalSpots historically defaulted to 20 when omitted — preserve
    // that contract by treating undefined/null/empty as nullable here
    // and falling back below. Non-numeric / negative / > 10000 still
    // 400s so we catch the actual bug surface (admin typos).
    const parsedTotalSpots  = numField(totalSpots,  'totalSpots',  { min: 1, max: 10000, allowNull: true })
    const parsedMinAge      = numField(minAge,      'minAge',      { min: 0, max: 120, allowNull: true })
    const parsedMaxAge      = numField(maxAge,      'maxAge',      { min: 0, max: 120, allowNull: true })
    const parsedMaleQuota   = numField(maleQuota,        'maleQuota',        { min: 0, max: 10000, allowNull: true })
    const parsedFemaleQuota = numField(femaleQuota,      'femaleQuota',      { min: 0, max: 10000, allowNull: true })
    const parsedTrMaleQuota = numField(turkishMaleQuota, 'turkishMaleQuota', { min: 0, max: 10000, allowNull: true })

    for (const v of [parsedPrice, parsedMemberPrice, parsedTotalSpots, parsedMinAge, parsedMaxAge,
                     parsedMaleQuota, parsedFemaleQuota, parsedTrMaleQuota]) {
      if (v && typeof v === 'object' && 'error' in v) {
        return NextResponse.json({ error: v.error }, { status: 400 })
      }
    }

    // Cross-field checks — only meaningful after the per-field
    // checks succeed (so we know each value is a number / null).
    const N = (x: unknown) => typeof x === 'number' ? x : null
    if (N(parsedMinAge) !== null && N(parsedMaxAge) !== null && (parsedMaxAge as number) < (parsedMinAge as number)) {
      return NextResponse.json({ error: 'maxAge must be >= minAge' }, { status: 400 })
    }
    const spotsForQuotaCheck = (parsedTotalSpots as number) || 0
    for (const [name, val] of [['maleQuota', parsedMaleQuota], ['femaleQuota', parsedFemaleQuota], ['turkishMaleQuota', parsedTrMaleQuota]] as const) {
      const num = N(val)
      if (num !== null && num > spotsForQuotaCheck) {
        return NextResponse.json({ error: `${name} (${num}) cannot exceed totalSpots (${spotsForQuotaCheck})` }, { status: 400 })
      }
    }

    // Date sanity — YYYY-MM-DD parse + registration deadline must
    // come before the event date when both are set.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
    }
    if (registrationDeadline && /^\d{4}-\d{2}-\d{2}$/.test(String(registrationDeadline)) && String(registrationDeadline) > String(date)) {
      return NextResponse.json({ error: 'registrationDeadline cannot be after the event date' }, { status: 400 })
    }

    const spots = (parsedTotalSpots as number | null) ?? 20

    // Resolve tagIds: accept either explicit IDs or tag names (vibes)
    let resolvedTagIds: string[] = tagIds ?? []
    if (!resolvedTagIds.length && vibes?.length) {
      const tagRecords = await prisma.tag.findMany({ where: { name: { in: vibes } } })
      resolvedTagIds = tagRecords.map(t => t.id)
    }

    // Events inherit their city from the parent club — keeps Sailing
    // Istanbul events out of the Berlin feed even if a host belongs to both
    // cities.
    //
    // But a null cityId is NOT the "impossible bug" this used to 400 on.
    // Global clubs — the 32 language/nationality ones (English, German,
    // Balkan, East Asian, …) — carry cityId null BY DESIGN: they appear in
    // every city's grid, which is exactly why /api/admin/clubs gives them
    // their own `?city=global` filter. They were listed in the create form's
    // club dropdown and then rejected on save, so none of them could host an
    // event anywhere. A global club has no city to inherit, so the request
    // has to name one.
    const parentClub = await prisma.club.findUnique({ where: { id: clubId }, select: { cityId: true, name: true } })
    if (!parentClub) {
      return NextResponse.json({ error: 'Unknown club' }, { status: 400 })
    }

    let eventCityId: string
    if (parentClub.cityId) {
      eventCityId = parentClub.cityId
    } else {
      // Who gets asked, and who gets a sensible default:
      //
      //   - admins/moderators come through /admin/events/new, which now
      //     renders a city picker as soon as a global club is chosen. They
      //     can file into ANY city, so a silent fallback to their own would
      //     quietly put an Antalya event in Istanbul. Ask instead.
      //   - club hosts and city hosts come through /host/events/new, which
      //     has no city control by design ("hosts always create in their
      //     own city"). Defaulting to theirs is the documented behaviour,
      //     and the cityHost grant check below still has the last word.
      const staff = admin || isModerator(session)
      if (!cityId && staff) {
        return NextResponse.json(
          { error: `"${parentClub.name}" is a global club, so it has no city of its own — pick which city this event is in.` },
          { status: 400 },
        )
      }
      // Validates the id and enforces canActInCity, so a moderator still
      // can't file into someone else's city by hand-posting a cityId.
      const resolved = await resolveTargetCityId(session, cityId)
      if ('error' in resolved) {
        return NextResponse.json({ error: resolved.error }, { status: resolved.status })
      }
      eventCityId = resolved.cityId
    }

    // City-scope check for moderators (admins act globally, club hosts are
    // already constrained to their own clubs via isClubHostFor above).
    if (!admin && isModerator(session) && session.cityId !== eventCityId) {
      return NextResponse.json({ error: 'Cross-city event creation is admin-only' }, { status: 403 })
    }
    // City hosts are scoped by their grants, not their home city — a consul
    // living in Istanbul can host the İzmir they were appointed to.
    if (cityHost && !cityHostOf.includes(eventCityId)) {
      return NextResponse.json({ error: 'You can only create events in a city you host' }, { status: 403 })
    }

    // Non-admins/non-moderators always create events in pending for review.
    // This covers the timing issue where a host creates their first event
    // before their club host membership is saved (the form assigns the host
    // role after event creation).
    //
    // `tooFarOut` no longer applies to admins. It used to, which meant an
    // admin creating a FREE event more than a week out got `pending` back
    // without being told — the event saved fine and simply never appeared on
    // the public page, which reads as "creating the event didn't work". An
    // admin setting a date deliberately is not the case this guard was for;
    // it still holds for moderators, and the create form now says so when it
    // fires. An explicit `status` in the request still wins either way.
    //
    // The week window is measured in the EVENT's city, not the creator's —
    // an Istanbul admin scheduling in Antalya was being judged against
    // Istanbul's today.
    const isFree        = !parseInt(price) && !memberPrice
    const weekOut       = await todayInCity(eventCityId, 7)
    const tooFarOut     = isFree && date > weekOut && !admin
    const needsReview   = !admin && !isModerator(session)
    const eventStatus   = needsReview ? 'pending' : (tooFarOut ? 'pending' : (status ?? 'published'))

    const event = await prisma.event.create({
      data: {
        title:                cleanTitle,
        date, time,
        location:             location.trim(),
        neighborhood:         neighborhood?.trim() ?? '',
        address:              address?.trim() ?? '',
        clubId, hostId,
        cityId:               eventCityId,
        description:          description?.trim() ?? '',
        totalSpots:           spots,
        spotsLeft:            spots,
        // Use the validated numbers from the #3 guard above —
        // parsedPrice / parsedMemberPrice are already known to be
        // in-range (or the request 400'd). parsedMemberPrice can
        // be null (when memberPrice was omitted) but never NaN.
        price:                parsedPrice as number,
        memberPrice:          parsedMemberPrice as number | null,
        payTo:                payTo || 'venue',
        paymentContact:       contact,
        ticketUrl:            ticketUrl?.trim() || null,
        emoji:                finalEmoji,
        isPremium:            isPremium ?? false,
        membersOnly:          membersOnly ?? false,
        limitedSpots:         limitedSpots ?? true,
        isFirstTimerFriendly: isFirstTimerFriendly ?? false,
        vibes:                vibes ?? [],
        intent:               intent === 'professional' ? 'professional' : 'social',
        status:               eventStatus,
        coverImage:           coverImage           ?? null,
        coverImagePosition:   coverImagePosition   ?? 50,
        meetingUrl:           meetingUrl           ?? null,
        whatsappUrl:          whatsappUrl ?? null,
        minAge:               parsedMinAge as number | null,
        maxAge:               parsedMaxAge as number | null,
        language:             language ?? null,
        difficulty:           difficulty ?? null,
        refundPolicy:         refundPolicy ?? null,
        registrationDeadline: registrationDeadline ?? null,
        endTime:              endTime ?? null,
        // The event's city decides the currency when the form didn't: an
        // Athens event is priced in euros by default, not lira. Reads the
        // resolved city rather than the club's, so a global club's event
        // is priced in the city it was filed under.
        currency:             currency ?? (await getCityConfig(eventCityId)).currency,
        approvalRequired:     approvalRequired ?? false,
        // Gender balance + quotas — null defaults so explicit-off doesn't
        // get coerced to 0. Cast numbers explicitly since the form ships
        // them as strings from <input type=number>.
        genderBalance:        genderBalance ?? false,
        maleQuota:            parsedMaleQuota   as number | null,
        femaleQuota:          parsedFemaleQuota as number | null,
        turkishMaleQuota:     parsedTrMaleQuota as number | null,
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

    // Mirror the venue into the directory as a PENDING listing for admin
    // review. Once approved, the event page's "View in directory" link matches.
    // Fire-and-forget — never blocks event creation.
    ensurePendingVenueBusiness({
      location:      event.location,
      cityId:        event.cityId,
      neighborhood:  event.neighborhood,
      address:       event.address,
      latitude:      event.lat,
      longitude:     event.lng,
      submittedById: hostId,
    }).catch(() => {})

    // Notify the assigned host if an admin created the event on their behalf
    if (admin && hostId !== session.id) {
      createNotification(
        hostId,
        'host_assigned',
        'You\'ve been assigned to host an event! 🎤',
        `You've been assigned as host for "${cleanTitle}". Head to your host panel to manage it.`,
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
            `"${cleanTitle}" submitted by ${session.name} — tap to review and publish.`,
            `/admin/events/${event.id}/edit`,
          )
        ))
      })().catch(() => {})
    }

    // Announce to club members when created directly as published
    // (fire-and-forget; batched + idempotency-guarded inside notifyNewEvent).
    if (eventStatus === 'published') {
      notifyNewEvent({ id: event.id, title: cleanTitle, clubId, hostId }).catch(() => {})
    }

    return NextResponse.json(event)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
