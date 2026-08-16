import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { VIEW_CITY_COOKIE } from '@/lib/city'
import { trackServer } from '@/lib/posthog-server'

// The city selector's switch. Sets (or clears) the cookie that resolveCityId
// reads, so every city-scoped feed follows in one move.
//
// This grants nothing. It changes what you're LOOKING AT, never what you may
// do: permission checks read session.cityId directly, so switching your view to
// another city gives a moderator no powers there. That separation is the reason
// this can be a plain cookie rather than a session change.

export const runtime = 'nodejs'

const YEAR = 60 * 60 * 24 * 365

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
  if (!slug) return NextResponse.json({ error: 'City is required' }, { status: 400 })

  // Live only. Viewing a pre-launch city would show empty feeds and read as a
  // broken site rather than an unlaunched one.
  const city = await prisma.city.findFirst({
    where:  { slug, status: 'live' },
    select: { id: true, slug: true, name: true },
  })
  if (!city) return NextResponse.json({ error: 'That city isn\'t open yet' }, { status: 400 })

  trackServer(session, 'city_switch', { city: city.slug, via: 'selector' })

  const res = NextResponse.json({ ok: true, city })
  res.cookies.set(VIEW_CITY_COOKIE, city.slug, {
    httpOnly: true,          // only the server reads it
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    path:     '/',
    maxAge:   YEAR,
  })
  return res
}

/** Clear the override — back to the member's own city. */
export async function DELETE() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const res = NextResponse.json({ ok: true })
  res.cookies.set(VIEW_CITY_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}
