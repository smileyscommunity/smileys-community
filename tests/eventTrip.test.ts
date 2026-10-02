import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { scopeCityId, tripError, tripLabel, eventCityIds, type TripRequest } from '../lib/eventTrip'

// Cross-city trips (2026-10-01): an Istanbul club's day out to Eskişehir is
// filed in Eskişehir (cityId) and departs from Istanbul (originCityId).
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

const ok: TripRequest = {
  admin: false, isClubHost: true,
  clubCityId: 'ist', clubCityTz: 'Europe/Istanbul',
  destination: { id: 'esk', status: 'live', timezone: 'Europe/Istanbul' },
}

describe('trip rules (lib/eventTrip)', () => {
  it('a host of the club can take it to another live city in the same timezone', () => {
    expect(tripError(ok)).toBeNull()
    expect(tripError({ ...ok, admin: true, isClubHost: false })).toBeNull()
  })
  it('refuses everyone else, global clubs, the same city, a non-live city, another timezone', () => {
    expect(tripError({ ...ok, isClubHost: false })).toMatch(/admins and the club/)
    expect(tripError({ ...ok, clubCityId: null })).toMatch(/global club/)
    // Unknown and not-live read the same: no oracle for paused cities.
    expect(tripError({ ...ok, destination: null })).toBe(tripError({ ...ok, destination: { ...ok.destination!, status: 'paused' } }))
    expect(tripError({ ...ok, destination: { ...ok.destination!, id: 'ist' } })).toMatch(/another city/)
    expect(tripError({ ...ok, destination: { ...ok.destination!, status: 'coming_soon' } })).toMatch(/live Smileys city/)
    expect(tripError({ ...ok, destination: { ...ok.destination!, timezone: 'Asia/Tbilisi' } })).toMatch(/timezones/)
  })
  it('permissions follow the departure city; ordinary events are unchanged', () => {
    expect(scopeCityId({ cityId: 'esk', originCityId: 'ist' })).toBe('ist')
    expect(scopeCityId({ cityId: 'ist', originCityId: null })).toBe('ist')
    expect(scopeCityId({ cityId: 'ist' })).toBe('ist')
  })
  it('either city may moderate a trip; an ordinary event has one city', () => {
    expect(eventCityIds({ cityId: 'esk', originCityId: 'ist' })).toEqual(['esk', 'ist'])
    expect(eventCityIds({ cityId: 'ist', originCityId: null })).toEqual(['ist'])
  })
  it('one label for both feeds', () => {
    expect(tripLabel('Istanbul', 'Eskişehir')).toBe('🚆 Istanbul → Eskişehir')
  })
})

describe('trips are wired end to end', () => {
  it('schema + additive migration', () => {
    const schema = read('prisma/schema.prisma')
    expect(schema).toContain('originCityId         String?')
    expect(schema).toContain('@relation("EventOriginCity", fields: [originCityId], references: [id], onDelete: SetNull)')
    const mig = read('prisma/migrations/20261001000001_event_origin_city/migration.sql')
    expect(mig).toContain('ADD COLUMN "originCityId" TEXT;')
    expect(mig).not.toMatch(/DROP|NOT NULL/)
  })

  it('a city feed is its own events plus the trips that depart from it', () => {
    const db = read('lib/db.ts')
    expect(db).toContain('? { OR: [{ cityId }, { originCityId: cityId }] }')
    expect(db).toContain(': cityIds ? { OR: [{ cityId: { in: cityIds } }, { originCityId: { in: cityIds } }] } : null')
    // AND-wrapped so the past-events OR in baseWhere survives.
    expect(db).toContain('...(cityClause ? { AND: [cityClause] } : {}),')
    expect(db).toContain('trip:             e.originCity && e.city ? tripLabel(e.originCity.name, e.city.name) : null,')
  })

  it('create: checks run on the departure city, the row is filed in the destination', () => {
    const route = read('app/api/admin/events/route.ts')
    expect(route).toContain('const tripErr = tripError({ admin, isClubHost: hostsThisClub, clubCityId: parentClub.cityId')
    // The venue may be in either city (the departure station): tripVenueEitherCity.test.
    expect(route).toContain('const venue = await venueIdInput(businessId, originCityId ? [placeCityId, originCityId] : placeCityId)')
    expect(route).toMatch(/cityId:\s+placeCityId,\s+originCityId,/)
    expect(route).toContain('currency ?? (await getCityConfig(placeCityId)).currency')
    // The host check still reads the departure city (eventCityId).
    expect(route).toContain('const hostErr = await hostIdError(hostId, eventCityId, session, clubId)')
  })

  it('edit/delete/duplicate: permissions follow the departure city', () => {
    const edit = read('app/api/admin/events/[id]/route.ts')
    // Security review 2026-10-01: both cities' staff may edit/cancel…
    expect(edit.match(/const cities = eventCityIds\((eventScope|before)\)/g)).toHaveLength(2)
    // …but publishing a trip (or undoing a destination takedown) is the
    // destination's call: admins, destination staff, or the host resuming
    // an event they parked.
    expect(edit).toContain("if (before.originCityId && 'status' in rest && rest.status !== before.status &&")
    expect(edit).toContain('!isAdmin(session) && !canActInCity(session, before.cityId)) {')
    expect(edit).toContain("const parking    = ['cancelled', 'draft', 'postponed'].includes(rest.status as string)")
    expect(edit).toContain("const hostResume = host && rest.status === 'published' && ['draft', 'postponed'].includes(before.status)")
    // Trips from non-admins always go to (destination) review.
    expect(read('app/api/admin/events/route.ts')).toContain('const needsReview   = !admin && (!isModerator(session) || modViaCityGrant || !!originCityId)')
    expect(edit).toContain('hostIdError(rest.hostId, scopeCityId(before), session,')
    expect(edit).toContain('if (targetClub.cityId && targetClub.cityId !== scopeCityId(before)) {')
    expect(edit).toContain("notifyCityStaff(scopeCityId(before), 'system_alert'")
    // The venue may be in either of the trip's cities.
    expect(edit).toContain('venueIdInput(body.businessId, eventCityIds(before))')
    const dup = read('app/api/admin/events/[id]/duplicate/route.ts')
    expect(dup).toContain('canActInCity(session, scopeCityId(source))')
    // A copied trip would skip tripError — admins only.
    expect(dup).toContain('if (source.originCityId && !isAdmin(session)) {')
    expect(read('lib/eventDuplicate.ts')).toContain("'clubId', 'hostId', 'cityId', 'originCityId',")
  })

  it('both forms offer the trip and follow the destination for neighborhoods; the card shows the badge', () => {
    const admin = read('app/admin/events/new/page.tsx')
    expect(admin).toContain('tripToCityId: tripDestination?.id ?? null,')
    expect(admin).toContain('const selectedClubCity = tripDestination?.slug')
    const host = read('app/host/events/new/page.tsx')
    expect(host).toContain('tripToCityId: tripDestination?.slug ?? undefined,')
    expect(host).toContain('const eventCity = clubCity && tripDestination')
    expect(read('app/api/admin/events/route.ts')).toContain("{ OR: [{ id: String(tripToCityId) }, { slug: String(tripToCityId) }] }")
    expect(read('components/EventCard.tsx')).toContain('{event.trip && (')
    expect(read('lib/eventCard.ts')).toContain('trip: e.trip ?? null,')
  })
})
