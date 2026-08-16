import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getMemberCities, joinCity, leaveCity, setHomeCity } from '@/lib/cityMembership'
import { trackServer } from '@/lib/posthog-server'

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

  const result = await setHomeCity(session.id, slug)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  if (!result.alreadyHome) trackServer(session, 'home_city_changed', { city: slug })

  return NextResponse.json({ ok: true, city: result.city, cities: await getMemberCities(session.id) })
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
