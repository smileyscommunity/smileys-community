import { canManageClubs, isAdminOrModerator } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { CLUB_CATEGORIES } from '@/lib/data'
import { slugify } from '@/lib/slug'
import { resolveTargetCityId } from '@/lib/city'
import { computeEventSurveyRollup, aggregateRollup } from '@/lib/survey'

// GET /api/admin/clubs
//
// Returns every club plus three at-a-glance signals admins need
// without drilling in:
//   • pendingCount  — count of pending join requests, so the
//     list-card pending-badge surfaces work that's been sitting
//     in the queue.
//   • quality       — aggregated post-event survey rollup
//     (wouldReturnRate + responseRate + eventsTracked). Same
//     shape and helper that /admin/clubs/[id] uses, computed in
//     one batch across every club so the list call stays O(1)
//     in DB round-trips.
//   • _count.events — already there; left untouched.
//
// All three derived in a single pass so the response is
// consistent and the list page can render the full picture
// without follow-up requests.

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Optional ?city= narrows to clubs that BELONG to that city — exact
    // match, deliberately excluding global clubs (cityId null) that merely
    // appear in every city's member-facing grid. ?city=global lists exactly
    // those. Unset keeps the full network list this endpoint always returned.
    const cityParam = req.nextUrl.searchParams.get('city')
    const clubs = await prisma.club.findMany({
      where: cityParam === 'global' ? { cityId: null }
           : cityParam              ? { cityId: cityParam }
           : {},
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { events: true } },
        city:   { select: { name: true, slug: true } },
      },
    })
    const clubIds = clubs.map((c: any) => c.id)

    // Pending join requests grouped by club. One query covers
    // every club (vs one-per-club drift).
    const pendingByClub = clubIds.length === 0 ? [] : await prisma.clubMembership.groupBy({
      by: ['clubId'],
      where: { clubId: { in: clubIds }, status: 'pending' },
      _count: { _all: true },
    })
    const pendingMap = new Map<string, number>(pendingByClub.map((r: any) => [r.clubId, r._count._all] as [string, number]))

    // Quality rollup. Pull every published/archived event id in
    // one go, batch through computeEventSurveyRollup, then
    // aggregate per-club via the same helper /admin/clubs/[id]
    // uses so behaviour stays in lockstep.
    const events = clubIds.length === 0 ? [] : await prisma.event.findMany({
      where:  { clubId: { in: clubIds }, status: { in: ['published', 'archived'] } },
      select: { id: true, clubId: true },
    })
    const eventRollups = await computeEventSurveyRollup(events.map((e: any) => e.id))
    const eventsByClub = new Map<string, string[]>()
    for (const e of events) {
      if (!e.clubId) continue
      if (!eventsByClub.has(e.clubId)) eventsByClub.set(e.clubId, [])
      eventsByClub.get(e.clubId)!.push(e.id)
    }
    const qualityByClub = new Map<string, ReturnType<typeof aggregateRollup>>()
    for (const [clubId, eventIds] of eventsByClub) {
      const rows = eventIds.map(id => eventRollups.get(id)).filter((r): r is NonNullable<typeof r> => !!r)
      qualityByClub.set(clubId, aggregateRollup(rows))
    }

    return NextResponse.json(clubs.map((c: any) => ({
      ...c,
      pendingCount: pendingMap.get(c.id) ?? 0,
      quality:      qualityByClub.get(c.id) ?? null,
    })))
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !canManageClubs(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = await req.json()
    const { name, description, category, emoji, cityId: requestedCityId } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    // Category must be one of the known options — the previous
    // `category || 'Social'` fallback silently filed unsubmitted
    // categories into Social, which was confusing both for admins
    // (form said "required" but submitted blank still worked) and
    // for the audit trail. Validate explicitly here.
    const cat = category?.trim()
    if (!cat || !(CLUB_CATEGORIES as readonly string[]).includes(cat)) {
      return NextResponse.json({ error: `Category must be one of: ${CLUB_CATEGORIES.join(', ')}` }, { status: 400 })
    }

    const slug = slugify(name)

    // An explicit cityId is how an admin creates a club for a city they are
    // not in — validated + gated in resolveTargetCityId (moderators stay in
    // their own city). Omitted falls back to the creator's context.
    const target = await resolveTargetCityId(session, requestedCityId)
    if ('error' in target) {
      return NextResponse.json({ error: target.error }, { status: target.status })
    }

    const club = await prisma.club.create({
      data: {
        name:        name.trim(),
        slug,
        description: description?.trim() || 'A new Smileys club.',
        category:    cat,
        emoji:       emoji               || '🎉',
        color:       'text-amber-600',
        bgColor:     'bg-amber-50',
        memberCount: 0,
        cityId:      target.cityId,
      },
    })
    return NextResponse.json(club, { status: 201 })
  } catch (e) {
    // P2002 = unique-constraint violation. The only realistic
    // hit here is the slug unique constraint, since name comes
    // from the admin's input and we slugify it deterministically.
    // Tell them that explicitly instead of returning a generic 500
    // — previously a duplicate name silently failed with no usable
    // error in the toast.
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'A club with this name already exists — pick a different name' }, { status: 409 })
    }
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
