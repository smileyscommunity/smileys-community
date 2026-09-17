import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, canActInCity } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'
import { writeAudit } from '@/lib/audit'
import { todayInCity } from '@/lib/city'
import { VISITOR_TRAVELER_TYPES, VISITOR_LOOKING_FOR } from '@/lib/data'
import { safeNeighborhoodFor } from '@/lib/neighborhoodsDb'
import { visitDatesError, cleanEmail } from '@/lib/visitorPolicy'

type Params = { params: Promise<{ id: string }> }

// One visitor announcement, for its owner: read it back (the edit form),
// change it (PATCH), take it down (DELETE → status 'withdrawn'; the row
// stays for the record). A moderator of the destination city, or an admin,
// can take one down too — the only staff path a doxxing or abusive card
// ever had was psql. Every write busts the /visiting list cache.

const OWN = { select: {
  id: true, userId: true, cityId: true, name: true, email: true, fromCity: true, intro: true, startsOn: true, endsOn: true,
  neighborhood: true, contact: true, status: true, travelerType: true, languages: true, lookingFor: true, visibility: true,
  city: { select: { slug: true, name: true } },
} }

export async function GET(_: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const row = await prisma.visitorAnnouncement.findUnique({ where: { id }, ...OWN })
  if (!row || row.userId !== session.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(row)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!await rateLimit(`visitor-edit:${session.id}`, 20, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many changes — try again in an hour' }, { status: 429 })
    }
    const { id } = await params
    const row = await prisma.visitorAnnouncement.findUnique({ where: { id }, select: { userId: true, cityId: true, status: true } })
    if (!row || row.userId !== session.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (row.status !== 'active') return NextResponse.json({ error: 'This visit is no longer active — post a new one' }, { status: 409 })

    const body = await req.json().catch(() => ({}))
    const { name, email, fromCity, intro, startsOn, endsOn, neighborhood, contact, travelerType, languages, lookingFor, visibility } = body
    if (!name?.trim() || !intro?.trim() || !startsOn || !endsOn) {
      return NextResponse.json({ error: 'Name, intro, and dates are required' }, { status: 400 })
    }
    if (name.length > 80 || intro.length > 1000) return NextResponse.json({ error: 'Name or intro too long' }, { status: 400 })
    const dateError = visitDatesError(startsOn, endsOn, await todayInCity(row.cityId))
    if (dateError) return NextResponse.json({ error: dateError }, { status: 400 })

    const LOOKING_FOR_VALUES = new Set((VISITOR_LOOKING_FOR as readonly { value: string }[]).map(t => t.value))
    const data = {
      name:         String(name).trim().slice(0, 80),
      email:        cleanEmail(email),
      fromCity:     typeof fromCity === 'string' ? fromCity.trim().slice(0, 80) || null : null,
      intro:        String(intro).trim().slice(0, 1000),
      startsOn, endsOn,
      neighborhood: await safeNeighborhoodFor(row.cityId, neighborhood),
      contact:      typeof contact === 'string' ? contact.trim().slice(0, 200) || null : null,
      travelerType: typeof travelerType === 'string' && (VISITOR_TRAVELER_TYPES as readonly { value: string }[]).some(t => t.value === travelerType) ? travelerType : null,
      languages:    Array.isArray(languages)
        ? [...new Set(languages.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.trim().slice(0, 30)))].slice(0, 8)
        : [],
      lookingFor:   Array.isArray(lookingFor)
        ? [...new Set(lookingFor.filter((v): v is string => typeof v === 'string' && LOOKING_FOR_VALUES.has(v)))].slice(0, 10)
        : [],
      visibility:   visibility === 'public' ? 'public' : 'members',
    }
    // The owner condition rides in the write: the row can't change hands between the read and here.
    const { count } = await prisma.visitorAnnouncement.updateMany({ where: { id, userId: session.id, status: 'active' }, data })
    if (count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    revalidateTag('visitor-announcements')
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[visitors PATCH]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { id } = await params
    const row = await prisma.visitorAnnouncement.findUnique({ where: { id }, select: { userId: true, cityId: true, status: true, name: true } })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const owner = row.userId === session.id
    // Staff: an admin anywhere, a moderator in the destination city (a
    // city-less moderator matches nothing — lib/access fails closed).
    const staff = isAdmin(session) || canActInCity(session, row.cityId)
    if (!owner && !staff) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (row.status !== 'active') return NextResponse.json({ ok: true, already: row.status })

    const { count } = await prisma.visitorAnnouncement.updateMany({ where: { id, status: 'active' }, data: { status: 'withdrawn' } })
    if (count === 0) return NextResponse.json({ ok: true })
    revalidateTag('visitor-announcements')
    if (!owner) {
      await writeAudit(session.id, session.name, 'visitor_announcement_removed', id, 'visitor_announcement',
        { userId: row.userId, cityId: row.cityId }, `Took down the visit card of ${row.name}`)
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[visitors DELETE]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
