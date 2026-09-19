import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getMemberCities, joinCity, leaveCity, setHomeCity } from '@/lib/cityMembership'
import { trackServer } from '@/lib/posthog-server'
import { VIEW_CITY_COOKIE } from '@/lib/city'
import { writeAudit } from '@/lib/audit'
import { rateLimit } from '@/lib/rateLimit'
import { prisma } from '@/lib/prisma'
import { CITY_STATUS } from '@/lib/cityStatus'

// The member's own city list: which cities they belong to, and joining or
// leaving one. Scoped entirely to the caller — there is no userId in the body,
// so this can't be pointed at anyone else's account.

export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  return NextResponse.json({ cities: await getMemberCities(session.id) })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
  if (!slug) return NextResponse.json({ error: 'City is required' }, { status: 400 })

  const result = await joinCity(session.id, slug)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  // First-time joins only — an idempotent re-press isn't a funnel event.
  if (!result.alreadyMember) trackServer(session, 'city_join', { city: slug })

  return NextResponse.json({
    ok: true,
    alreadyMember: result.alreadyMember,
    city: result.city,
    cities: await getMemberCities(session.id),
  })
}

// Change home city ("I moved"). The old home is kept as a joined city so
// history stays reachable; getSession injects the fresh cityId on the next
// request, so no re-login is needed.
export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
  if (!slug) return NextResponse.json({ error: 'City is required' }, { status: 400 })

  // Attempts are bounded cheaply; the daily budget below is spent only on
  // moves that actually happen, so five refusals (a city that isn't live, a
  // staff account) don't lock a member out for a day.
  if (!await rateLimit(`home-city-try:${session.id}`, 30, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // Moving rewrites city rows and clears the neighbourhood; a few a day is a
  // member who moved, a hundred is something else. Checked BEFORE the move
  // (a 429 afterwards would refuse a change that already happened) but only
  // for a request that would really move them, so refusals cost nothing.
  const target = await prisma.city.findUnique({ where: { slug }, select: { id: true, status: true } })
  const me = await prisma.user.findUnique({ where: { id: session.id }, select: { cityId: true } })
  if (target?.status === CITY_STATUS.Live && me?.cityId !== target.id
      && !await rateLimit(`home-city:${session.id}`, 5, 24 * 60 * 60_000)) {
    return NextResponse.json({ error: "That's a lot of moving. Ask us to change it for you." }, { status: 429 })
  }

  const from = session.cityId
  const result = await setHomeCity(session.id, slug)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  if (!result.alreadyHome) {
    trackServer(session, 'home_city_changed', { city: slug })
    // On the record: which city a member calls home decides whose staff
    // answer for them, and this left no trace but a product event.
    await writeAudit(session.id, session.name, 'user.home_city_changed', session.id, 'user',
      { from, to: result.city.id, self: true, cityId: result.city.id },
      `${session.name} moved their home city to ${result.city.name}`)
  }

  const res = NextResponse.json({
    ok: true,
    city: result.city,
    // The neighbourhood is cleared on a real move (it belongs to the old
    // city's registry) — the page says so and points at the profile.
    neighborhoodCleared: !result.alreadyHome,
    cities: await getMemberCities(session.id),
  })
  // A city the member once browsed outranks their home for a year
  // (lib/city resolveCityId), so without this the feeds stay where they were
  // while the page promises they moved.
  if (!result.alreadyHome) {
    // Written empty with the same attributes, not deleted: on https the
    // original is Secure, and a non-Secure Set-Cookie can't overwrite a
    // Secure one, so a bare delete silently no-ops on iOS — which is where
    // most of this audience is. /api/city/enter learned that the hard way.
    res.cookies.set(VIEW_CITY_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure:   process.env.NODE_ENV === 'production',
      path:     '/',
      maxAge:   0,
    })
  }
  return res
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
  if (!slug) return NextResponse.json({ error: 'City is required' }, { status: 400 })

  const result = await leaveCity(session.id, slug)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true, cities: await getMemberCities(session.id) })
}
