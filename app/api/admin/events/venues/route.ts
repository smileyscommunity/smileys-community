import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isModerator, isClubHost, hostCityIds } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'
import { resolveCityId } from '@/lib/city'
import { LIVE_BUSINESS } from '@/lib/eventVenue'

// Directory listings an event can be held at — the event forms' venue picker
// (components/VenuePicker). Live listings of the event's city whose name
// contains the typed text; picking one stores Event.businessId.
//
// For whoever can create an event (staff, club hosts, city hosts), the same
// gate as the geocoder beside it. ?city=<slug> or ?cityId=<id> names the
// event's city; without either, the city the viewer is working in.

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const canUse = isAdmin(session) || isModerator(session) || await isClubHost(session.id) || (await hostCityIds(session.id)).length > 0
  if (!canUse) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!await rateLimit(`event-venues:${session.id}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const q    = (req.nextUrl.searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  const slug = req.nextUrl.searchParams.get('city')?.trim()
  const id   = req.nextUrl.searchParams.get('cityId')?.trim()
  const cityId = slug
    ? /^[a-z0-9-]{1,40}$/.test(slug) ? (await prisma.city.findFirst({ where: { slug }, select: { id: true } }))?.id : undefined
    : id
      ? id.length <= 64 ? (await prisma.city.findFirst({ where: { id }, select: { id: true } }))?.id : undefined
      : await resolveCityId(session)
  if (!cityId || q.length < 2) return NextResponse.json({ venues: [] })

  const venues = await prisma.business.findMany({
    where:   { cityId, ...LIVE_BUSINESS, name: { contains: q, mode: 'insensitive' } },
    select:  { id: true, name: true, neighborhood: true, address: true, latitude: true, longitude: true },
    orderBy: { name: 'asc' },
    take:    8,
  })
  return NextResponse.json({ venues })
}
