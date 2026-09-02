import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { CITY_STATUS } from '@/lib/cityStatus'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator, canActInCity } from '@/lib/access'
import { slugify } from '@/lib/slug'
import { toCountryCode } from '@/lib/country'
import { DEFAULT_CITY_SLUG } from '@/lib/city'
import { getStatsFor } from '@/lib/cities'
import { todayInTz } from '@/lib/cityTime'

// GET /api/admin/cities — list every city with its club count + hosts, so the
// admin Cities page can show launch status at a glance.
export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const cities = await prisma.city.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      _count: {
        select: {
          clubs: { where: { isActive: true } },
          // active only — must mirror the go-live gate's count exactly, or the
          // panel could show "ready" for a city the gate would still reject.
          neighborhoods: { where: { active: true } },
        },
      },
      cityHosts: {
        where: { revokedAt: null },
        select: { id: true, user: { select: { id: true, name: true, email: true } } },
      },
    },
  })

  // Derived maturity for the live cities — the ops signal that separates
  // "live and thriving" from "live and stuck in seeding for 90 days".
  const liveIds = cities.filter(c => c.status === CITY_STATUS.Live).map(c => c.id)
  const stats   = liveIds.length ? await getStatsFor(liveIds) : new Map()

  // Launch inventory — what each city's shopfront actually holds (members,
  // upcoming events, guide entries, city-local handbook). Grouped counts over
  // all cities at once, same as getStatsFor — never a query per city.
  const cityIds = cities.map(c => c.id)

  // "Upcoming" means the city's own calendar day (Event.date is text
  // 'YYYY-MM-DD', compared as strings). Cities sharing a today batch into one
  // grouped count — one query per distinct calendar day, not per city.
  const idsByToday = new Map<string, string[]>()
  for (const c of cities) {
    const today = todayInTz(c.timezone)
    idsByToday.set(today, [...(idsByToday.get(today) ?? []), c.id])
  }

  const [memberRows, guideRows, handbookRows, eventRowGroups] = await Promise.all([
    prisma.user.groupBy({
      by: ['cityId'],
      where: { cityId: { in: cityIds }, status: 'approved' },
      _count: { _all: true },
    }),
    prisma.guideEntry.groupBy({
      by: ['cityId', 'status'],
      where: { cityId: { in: cityIds } },
      _count: { _all: true },
    }),
    // City-local handbook only (cityId non-null) — global articles apply to
    // every city and would inflate every card by the same number.
    prisma.post.groupBy({
      by: ['cityId'],
      where: { cityId: { in: cityIds }, kind: 'handbook', status: 'published' },
      _count: { _all: true },
    }),
    Promise.all([...idsByToday].map(([today, ids]) =>
      prisma.event.groupBy({
        by: ['cityId'],
        where: { cityId: { in: ids }, status: 'published', date: { gte: today } },
        _count: { _all: true },
      }),
    )),
  ])
  const eventRows = eventRowGroups.flat()

  return NextResponse.json(cities.map(c => ({
    id: c.id, name: c.name, slug: c.slug, country: c.country, timezone: c.timezone,
    // Lets list UIs badge only non-default-city rows without hardcoding
    // Istanbul client-side (lib/city imports prisma, so client components
    // can't read DEFAULT_CITY_SLUG themselves).
    isDefault: c.slug === DEFAULT_CITY_SLUG,
    currency: c.currency, defaultLang: c.defaultLang, status: c.status,
    tagline: c.tagline, description: c.description, heroImage: c.heroImage,
    clubCount: c._count.clubs,
    neighborhoodCount: c._count.neighborhoods,
    // Launch inventory (see the grouped counts above).
    memberCount:        memberRows.find(r => r.cityId === c.id)?._count._all ?? 0,
    upcomingEventCount: eventRows.find(r => r.cityId === c.id)?._count._all ?? 0,
    guidePublished:     guideRows.find(r => r.cityId === c.id && r.status === 'published')?._count._all ?? 0,
    guideDraft:         guideRows.find(r => r.cityId === c.id && r.status === 'draft')?._count._all ?? 0,
    handbookCount:      handbookRows.find(r => r.cityId === c.id)?._count._all ?? 0,
    // Launch readiness, derived from the SAME three counts the go-live gate
    // checks (clubs, hosts, neighborhoods) — so the panel shows the path to
    // live instead of the gate's rejection being the first time an admin
    // learns what's missing. The checklist doc stays the narrative; this is
    // the data.
    readiness: {
      clubs:         c._count.clubs > 0,
      hosts:         c.cityHosts.length > 0,
      neighborhoods: c._count.neighborhoods > 0,
    },
    maturity: stats.get(c.id)?.maturity ?? null,
    // Who runs another city is not a moderator's business: hosts (and their
    // emails) only for cities the caller may act in.
    hosts: canActInCity(session, c.id)
      ? c.cityHosts.map(h => ({ cityHostId: h.id, id: h.user.id, name: h.user.name, email: h.user.email }))
      : [],
  })))
}

// POST /api/admin/cities — create a new city (in "coming soon" status). Clubs are
// seeded separately via /[id]/launch-clubs once the city exists.
// Admin-only: standing up a new city is a platform-level action (a moderator is
// scoped to an existing city and has nothing to scope a brand-new one against).
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'Creating a city is admin-only' }, { status: 403 })
  }

  const body = await req.json()
  const name     = typeof body.name === 'string' ? body.name.trim() : ''
  const country  = toCountryCode(body.country)
  const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : ''
  const currency = typeof body.currency === 'string' && body.currency.trim() ? body.currency.trim().toUpperCase() : 'EUR'
  const defaultLang = typeof body.defaultLang === 'string' && body.defaultLang.trim() ? body.defaultLang.trim() : 'en'

  if (!name)     return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  // Stored as an ISO 3166-1 alpha-2 code so two admins can't spell one
  // country two ways ('TR' and 'TURKEY' both existed before this).
  if (!country)  return NextResponse.json({ error: 'Country must be a 2-letter ISO code (TR, PT, GR)' }, { status: 400 })
  if (!timezone) return NextResponse.json({ error: 'Timezone is required (e.g. Europe/Lisbon)' }, { status: 400 })

  const slug = slugify(name)
  if (!slug) return NextResponse.json({ error: 'Name must contain letters or numbers' }, { status: 400 })

  // Static segments always beat the /[city] dynamic route, so a city whose
  // slug collides with a real page would render as an unreachable shopfront:
  // its card and menu entry would silently link to /events or /login instead.
  // List mirrors the top-level app/ directory — update it when a new
  // top-level route lands.
  const RESERVED_SLUGS = new Set([
    'about', 'activate', 'admin', 'advertise', 'api', 'appeal', 'apply',
    'board', 'clubs', 'contact', 'cookies', 'directory', 'events', 'faq',
    'forgot-password', 'get-involved', 'guide', 'guidelines', 'handbook',
    'host', 'login', 'marketplace', 'moving-sales', 'neighborhoods',
    'onboarding', 'partner', 'posts', 'privacy', 'pro', 'reset-password',
    'terms', 'unsubscribe', 'verify-email', 'visiting', 'why',
    'dashboard', 'members', 'messages', 'account', 'search', 'hangouts',
  ])
  if (RESERVED_SLUGS.has(slug)) {
    return NextResponse.json({ error: `"${slug}" collides with an existing page — pick a different city name or add a qualifier` }, { status: 400 })
  }

  const existing = await prisma.city.findUnique({ where: { slug }, select: { id: true } })
  if (existing) return NextResponse.json({ error: `A city with slug "${slug}" already exists` }, { status: 409 })

  const city = await prisma.city.create({
    data: { name, slug, country, timezone, currency, defaultLang, status: CITY_STATUS.ComingSoon },
    select: { id: true, name: true, slug: true },
  })

  return NextResponse.json(city, { status: 201 })
}
