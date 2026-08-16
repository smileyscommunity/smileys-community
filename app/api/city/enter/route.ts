import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { VIEW_CITY_COOKIE } from '@/lib/city'

// Entering a city from its public shopfront (/izmir → "See what's on"): set
// the view-city cookie and land on the requested feed, so events, clubs and
// the rest show THAT city rather than the default one.
//
// GET, because it's a plain link target on a public page — the only side
// effect is the same view cookie the member selector sets. Unlike
// POST /api/me/view-city this works for guests: a guest browsing /izmir who
// clicks through must get İzmir's calendar, not Istanbul's. It grants
// nothing (authorization reads session.cityId, never this cookie).

export const runtime = 'nodejs'

const YEAR = 60 * 60 * 24 * 365

// Closed set of destinations. This endpoint redirects, so the target must
// never be caller-shaped — no open redirects, no path injection.
const DESTINATIONS: Record<string, string> = {
  events:    '/events',
  clubs:     '/clubs',
  directory: '/directory',
}

export async function GET(req: NextRequest) {
  const slug  = req.nextUrl.searchParams.get('city')?.trim() ?? ''
  const to    = DESTINATIONS[req.nextUrl.searchParams.get('to') ?? ''] ?? '/events'
  // `?clear=1` — the "back to my city" switch on feed headers. Drops the
  // cookie so resolveCityId falls back to the member's home (or the
  // default city for guests). Guest-usable, unlike DELETE /api/me/view-city.
  const clear = req.nextUrl.searchParams.get('clear') === '1'

  // Live cities only — viewing a pre-launch city would empty every feed and
  // read as a broken site rather than an unlaunched one (same rule as the
  // member selector). Unknown/pre-launch slugs still redirect, just without
  // touching the cookie.
  const city = !clear && slug
    ? await prisma.city.findFirst({ where: { slug, status: 'live' }, select: { slug: true } })
    : null

  // Relative Location, resolved by the browser against whatever origin the
  // user is on. Building an absolute URL from req.nextUrl here redirects to
  // the Nginx upstream (localhost:3000) in production.
  const res = new NextResponse(null, { status: 307, headers: { Location: `/app${to}` } })
  if (clear) {
    res.cookies.set(VIEW_CITY_COOKIE, '', { path: '/', maxAge: 0 })
  } else if (city) {
    res.cookies.set(VIEW_CITY_COOKIE, city.slug, {
      httpOnly: true,
      sameSite: 'lax',
      secure:   process.env.NODE_ENV === 'production',
      path:     '/',
      maxAge:   YEAR,
    })
  }
  return res
}
