import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { tripAttendeeStats, type TripAttendee } from '../lib/tripReport'

// Cross-city trips, phase 4: the per-trip read-out (Admin → Trips).
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const day = new Date('2026-10-25T00:00:00Z')
const a = (over: Partial<TripAttendee>): TripAttendee =>
  ({ userId: 'u', homeCityId: 'ist', checkedIn: false, attendance: 'unknown', joinedDestinationAt: null, ...over })

describe('trip report', () => {
  it('counts going, went, locals and the travelers who joined afterwards', () => {
    const s = tripAttendeeStats('esk', day, [
      a({ userId: 'traveler' }),
      a({ userId: 'checked', checkedIn: true }),
      a({ userId: 'attended', attendance: 'attended' }),
      a({ userId: 'local-home', homeCityId: 'esk', checkedIn: true }),
      a({ userId: 'local-joined-before', joinedDestinationAt: new Date('2026-10-01T10:00:00Z') }),
      a({ userId: 'joined-after', joinedDestinationAt: new Date('2026-10-26T19:10:00Z') }),
      a({ userId: 'joined-same-day', joinedDestinationAt: new Date('2026-10-25T21:00:00Z') }),
    ])
    expect(s).toEqual({ going: 7, went: 3, locals: 2, joined: 2 })
  })
  it('an empty trip is all zeros', () => {
    expect(tripAttendeeStats('esk', day, [])).toEqual({ going: 0, went: 0, locals: 0, joined: 0 })
  })
  it('the alert and invite counts match what phases 2 and 3 send', () => {
    const lib = read('lib/tripReport.ts')
    expect(lib).toContain("title: { startsWith: 'Members from ' }")
    expect(read('lib/notify.ts')).toContain('title: `Members from ${originName} are coming to ${destinationName} 🚆`')
    expect(lib).toContain("title: `You've been to ${t.city.name} 🚆`")
    expect(read('lib/tripFollowUp.ts')).toContain("title: `You've been to ${cityName} 🚆`")
  })
  it('admin-only, and in the admin nav', () => {
    expect(read('app/api/admin/trips/route.ts')).toContain("if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })")
    expect(read('lib/adminNav.ts')).toContain("{ label: 'Trips',        href: '/admin/trips',        exact: false, roles: ['admin'],")
    expect(read('app/admin/trips/page.tsx')).toContain("import type { TripRow } from '@/lib/tripReport'")
  })
})
