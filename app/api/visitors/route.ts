import { NextRequest, NextResponse } from 'next/server'
import { resolvePublicCityIdFromSlug } from '@/lib/cities'
import { revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId, todayInCity } from '@/lib/city'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { VISITOR_TRAVELER_TYPES, VISITOR_LOOKING_FOR } from '@/lib/data'
import { safeNeighborhoodFor } from '@/lib/neighborhoodsDb'
import { visitDatesError, cleanEmail, guestView, visitorName } from '@/lib/visitorPolicy'
import { notifyLocalsOfVisit } from '@/lib/visitorNotify'

// "I'm visiting Istanbul" announcements. Members only: anonymous posting was
// tried and reverted on the form (see app/(member)/visiting/new), and an API
// that still took it let anyone put a member's name and a stranger's phone
// number on a public card nobody could take down. Edits and withdrawals are
// app/api/visitors/[id].

/** Only approved, unhidden authors are listed; a card without an account has no author to check. */
const AUTHOR_OK = { OR: [{ userId: null }, { user: { status: 'approved', hiddenFromMembers: false } }] }

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const neighborhood = searchParams.get('neighborhood') || undefined

  const session = await getSession()
  // ?city=<slug> browses another city's visitors (the /[city] pages use
  // this); unknown slugs fail closed to an empty list, and the default
  // stays the viewer's own city.
  let cityId: string
  const citySlug = searchParams.get('city')?.trim()
  if (citySlug) {
    // Shared resolver — the status rule (no paused/hidden cities by slug)
    // lives in lib/cities.resolvePublicCityIdFromSlug.
    cityId = await resolvePublicCityIdFromSlug(citySlug)
  } else {
    cityId = await resolveCityId(session)
  }
  const blockedIds = session
    ? (await prisma.memberBlock.findMany({
        where:  { OR: [{ blockerId: session.id }, { blockedId: session.id }] },
        select: { blockerId: true, blockedId: true },
      })).map(b => (b.blockerId === session.id ? b.blockedId : b.blockerId))
    : []
  const announcements = await prisma.visitorAnnouncement.findMany({
    where: {
      status: 'active',
      cityId,
      // Members get contact details below; a blocked pair gets nothing of
      // each other, like every other member surface.
      ...(blockedIds.length ? { OR: [{ userId: null }, { userId: { notIn: blockedIds } }] } : {}),
      AND: [AUTHOR_OK],
      // "Still ongoing" is judged on the visited city's calendar, not UTC —
      // a visit "ends today" until that city's midnight, not three hours early.
      endsOn: { gte: await todayInCity(cityId) },
      // Visibility is enforced here as well as on the page — otherwise a
      // guest could read members-only visits straight off the API while
      // the rendered page correctly hid them.
      ...(session ? {} : { visibility: 'public' }),
      ...(neighborhood ? { neighborhood } : {}),
    },
    orderBy: { startsOn: 'asc' },
    take: 100,
    select: {
      id: true, name: true, startsOn: true, endsOn: true, fromCity: true, neighborhood: true, intro: true,
      contact: true, email: true, travelerType: true, languages: true, lookingFor: true,
      user: { select: { id: true, name: true, color: true, profilePhoto: true } },
    },
  })

  // An allow-list, not the row: a guest gets a first name, the months and no
  // neighbourhood (lib/visitorPolicy guestView) and no author to follow to a
  // profile; a member gets the card as posted. Nothing else on the row —
  // not its ids, status or visibility — leaves this route.
  const isMember = !!session
  const cleaned = announcements.map(a => ({
    id: a.id,
    ...(isMember
      ? { name: visitorName(a.name), startsOn: a.startsOn, endsOn: a.endsOn, neighborhood: a.neighborhood, contact: a.contact, email: a.email, user: a.user }
      : { ...guestView(a), neighborhood: null, contact: null, email: null, user: null }),
    fromCity: a.fromCity, intro: a.intro, travelerType: a.travelerType, languages: a.languages, lookingFor: a.lookingFor,
  }))

  return NextResponse.json({ announcements: cleaned, isMember })
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Sign in to post a visit' }, { status: 401 })

    const body = (await req.json().catch(() => null)) ?? {}
    const { name, email, fromCity, intro, startsOn, endsOn, neighborhood, contact,
      travelerType, languages, lookingFor, visibility } = body

    if (typeof name !== 'string' || typeof intro !== 'string' || !name.trim() || !intro.trim() || !startsOn || !endsOn) {
      return NextResponse.json({ error: 'Name, intro, and dates are required' }, { status: 400 })
    }
    if (name.length > 80 || intro.length > 1000) {
      return NextResponse.json({ error: 'Name or intro too long' }, { status: 400 })
    }

    // Destination city — the city being VISITED, chosen on the form. Only
    // LIVE cities accept visits: a visit needs a community that can see it
    // and welcome the visitor, and until per-city visiting surfaces exist,
    // anything less than live is write-only — dates stored, shown to nobody.
    // The status gate applies to the no-slug fallback too (older clients /
    // the poster's own city), so both paths share one rule.
    const citySlug = typeof body.city === 'string' ? body.city.trim() : ''
    const dest = citySlug
      ? await prisma.city.findUnique({ where: { slug: citySlug }, select: { id: true, slug: true, status: true } })
      : await prisma.city.findUnique({ where: { id: await resolveCityId(session) }, select: { id: true, slug: true, status: true } })
    if (!dest || dest.status !== 'live') {
      return NextResponse.json({ error: 'That city is not open for visits yet' }, { status: 400 })
    }
    const destCityId = dest.id

    // Judged on the DESTINATION city's calendar — the trip happens on that
    // city's clock, not UTC's. Real days, in order, not past, not a
    // residency, not a wish (lib/visitorPolicy).
    const today = await todayInCity(destCityId)
    const dateError = visitDatesError(startsOn, endsOn, today)
    if (dateError) return NextResponse.json({ error: dateError }, { status: 400 })

    // After the checks: a form with a bad date three times over must not
    // spend the day's posts. Per member, and per address as a backstop for
    // a member on many accounts — not the other way round, since a whole
    // block of flats can share one mobile-carrier address.
    if (!await rateLimit(`visitor:user:${session.id}`, 3, 24 * 60 * 60_000)
      || !await rateLimit(`visitor:${getIp(req)}`, 10, 24 * 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many posts today. Try again tomorrow.' }, { status: 429 })
    }

    const safeNeighborhood = await safeNeighborhoodFor(destCityId, neighborhood)

    const safeTravelerType = typeof travelerType === 'string'
      && (VISITOR_TRAVELER_TYPES as readonly { value: string }[]).some(t => t.value === travelerType)
      ? travelerType : null

    const LOOKING_FOR_VALUES = new Set((VISITOR_LOOKING_FOR as readonly { value: string }[]).map(t => t.value))
    const safeLookingFor = Array.isArray(lookingFor)
      ? [...new Set(lookingFor.filter((v): v is string => typeof v === 'string' && LOOKING_FOR_VALUES.has(v)))].slice(0, 10)
      : []

    // Anything other than an explicit 'public' falls back to the private
    // default — a malformed or missing value must never accidentally list
    // someone's trip on the public web.
    const safeVisibility = visibility === 'public' ? 'public' : 'members'

    // Free text, no fixed list — capped on count and per-item length so a
    // malicious payload can't stuff an oversized array into the column.
    const safeLanguages = Array.isArray(languages)
      ? [...new Set(languages.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.trim().slice(0, 30)))].slice(0, 8)
      : []

    // One live visit per member per city: a second post duplicated the card
    // and re-pinged every local. To change dates, edit the existing one.
    // Checked and written under one lock per (member, city), so two posts
    // sent together can't both pass the check.
    const created = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`visitor:${session.id}:${destCityId}`}))) AS l`
      const existing = await tx.visitorAnnouncement.findFirst({
        where:  { userId: session.id, cityId: destCityId, status: 'active', endsOn: { gte: today } },
        select: { id: true },
      })
      if (existing) return { existingId: existing.id }
      return tx.visitorAnnouncement.create({
      data: {
        userId:       session.id,
        cityId:       destCityId,
        name:         name.trim().slice(0, 80),
        email:        cleanEmail(email),
        fromCity:     typeof fromCity === 'string' ? fromCity.trim().slice(0, 80) || null : null,
        intro:        intro.trim().slice(0, 1000),
        startsOn,
        endsOn,
        neighborhood: safeNeighborhood,
        contact:      typeof contact === 'string' ? contact.trim().slice(0, 200) || null : null,
        travelerType: safeTravelerType,
        languages:    safeLanguages,
        lookingFor:   safeLookingFor,
        visibility:   safeVisibility,
      },
      })
    })
    if ('existingId' in created) {
      return NextResponse.json({ error: 'You already have a visit posted for this city — edit it instead.', existingId: created.existingId }, { status: 409 })
    }

    // Bust /visiting's 2-minute list cache so the new post (and the
    // poster's own "events during your visit" view) shows up immediately.
    revalidateTag('visitor-announcements')

    notifyLocalsOfVisit({
      id: created.id, userId: session.id, cityId: destCityId, citySlug: dest.slug, neighborhood: safeNeighborhood,
      name: created.name, fromCity: created.fromCity, startsOn, endsOn,
    }).catch(e => console.error('[visitors POST] fan-out failed', { err: String(e) }))

    return NextResponse.json({ id: created.id }, { status: 201 })
  } catch (e) {
    console.error('[visitors POST]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
