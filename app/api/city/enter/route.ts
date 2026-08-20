import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { VIEW_CITY_COOKIE } from '@/lib/city'
import { getSession } from '@/lib/session'
import { trackServer } from '@/lib/posthog-server'

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
  events:        '/events',
  clubs:         '/clubs',
  directory:     '/directory',
  members:       '/members',
  neighborhoods: '/neighborhoods',
  guide:         '/guide',
  // The city's own page. Empty because the path is the city slug itself, filled
  // in below once the slug has been checked against a real live city — the
  // whole point of this map is that a redirect target is never caller-shaped.
  city:          '',
}

export async function GET(req: NextRequest) {
  const slug  = req.nextUrl.searchParams.get('city')?.trim() ?? ''
  const toKey = req.nextUrl.searchParams.get('to') ?? ''
  let   to    = DESTINATIONS[toKey] ?? '/events'
  // `?clear=1` — the "back to my city" switch on feed headers. Drops the
  // cookie so resolveCityId falls back to the member's home (or the
  // default city for guests). Guest-usable, unlike DELETE /api/me/view-city.
  const clear = req.nextUrl.searchParams.get('clear') === '1'

  // Live cities only — viewing a pre-launch city would empty every feed and
  // read as a broken site rather than an unlaunched one (same rule as the
  // member selector). Unknown/pre-launch slugs still redirect, just without
  // touching the cookie.
  const city = !clear && slug
    ? await prisma.city.findFirst({ where: { slug, status: 'live' }, select: { id: true, slug: true } })
    : null

  // Deep link into one neighborhood of the city being entered. The slug is not
  // appended as given — it has to match a row in THAT city's neighborhoods
  // table, and what gets used is the stored value, so this stays as closed a
  // set as DESTINATIONS itself (no traversal, no open redirect). A slug that
  // doesn't match just lands on the index.
  const nSlug = req.nextUrl.searchParams.get('n')?.trim()
  // to=city — used by the city cards. Tapping a city should mean "show me this
  // city", and landing on its page while your feeds still serve another city is
  // how "changing city doesn't work" happens: the page says Bodrum everywhere
  // and the guide, members and board stay on Istanbul.
  if (city && toKey === 'city') to = `/${city.slug}`

  if (city && toKey === 'neighborhoods' && nSlug) {
    const hood = await prisma.neighborhood.findUnique({
      where:  { cityId_slug: { cityId: city.id, slug: nSlug } },
      select: { slug: true, active: true },
    })
    if (hood?.active) to = `/neighborhoods/${hood.slug}`
  }

  // Relative Location, resolved by the browser against whatever origin the
  // user is on. Building an absolute URL from req.nextUrl here redirects to
  // the Nginx upstream (localhost:3000) in production.
  // city_switch for signed-in members; guests have no server-side distinct
  // id (their pageviews still land via posthog-js on the destination page).
  const session = await getSession()
  if (session && (clear || city)) {
    trackServer(session, 'city_switch', clear ? { via: 'back' } : { city: city!.slug, via: 'city_page' })
  }

  const res = new NextResponse(null, { status: 307, headers: { Location: `/app${to}` } })
  if (clear) {
    // Mirrors the set below, attribute for attribute. Safari won't let a
    // non-Secure Set-Cookie overwrite a Secure one, and on https the set is
    // always Secure — so a bare { path, maxAge: 0 } silently failed to clear
    // the override on iOS, leaving "back to my city" a no-op.
    res.cookies.set(VIEW_CITY_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure:   process.env.NODE_ENV === 'production',
      path:     '/',
      maxAge:   0,
    })
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
