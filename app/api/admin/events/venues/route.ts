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
  // A cross-city trip searches both its cities (?city=a&city=b or the same
  // with cityId): it can meet at the departure station. Capped at two.
  const slugs = req.nextUrl.searchParams.getAll('city').map(s => s.trim()).filter(s => /^[a-z0-9-]{1,40}$/.test(s)).slice(0, 2)
  const ids   = req.nextUrl.searchParams.getAll('cityId').map(s => s.trim()).filter(s => s && s.length <= 64).slice(0, 2)
  const cityIds = slugs.length
    ? (await prisma.city.findMany({ where: { slug: { in: slugs } }, select: { id: true } })).map(c => c.id)
    : ids.length
      ? (await prisma.city.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(c => c.id)
      : [await resolveCityId(session)].filter((c): c is string => !!c)
  if (cityIds.length === 0 || q.length < 2) return NextResponse.json({ venues: [] })

  const venues = await prisma.business.findMany({
    where:   { cityId: { in: cityIds }, ...LIVE_BUSINESS, name: { contains: q, mode: 'insensitive' } },
    select:  { id: true, name: true, neighborhood: true, address: true, latitude: true, longitude: true },
    orderBy: { name: 'asc' },
    take:    8,
  })
  return NextResponse.json({ venues })
}
