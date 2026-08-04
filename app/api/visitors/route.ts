import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { verifyTurnstile } from '@/lib/turnstile'
import { createNotification } from '@/lib/notify'
import { ISTANBUL_NEIGHBORHOODS, VISITOR_TRAVELER_TYPES, VISITOR_LOOKING_FOR } from '@/lib/data'

// "I'm visiting Istanbul" announcements. Anonymous posting allowed to capture
// visitors before they sign up (the whole growth lever); Turnstile + 3/day/IP
// rate limit guard the open POST endpoint.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const neighborhood = searchParams.get('neighborhood') || undefined
  const today        = new Date().toISOString().split('T')[0]

  const session = await getSession()
  const announcements = await prisma.visitorAnnouncement.findMany({
    where: {
      status: 'active',
      endsOn: { gte: today },
      // Visibility is enforced here as well as on the page — otherwise a
      // guest could read members-only visits straight off the API while
      // the rendered page correctly hid them.
      ...(session ? {} : { visibility: 'public' }),
      ...(neighborhood ? { neighborhood } : {}),
    },
    orderBy: { startsOn: 'asc' },
    take: 100,
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
  })

  // Strip contact info for anonymous viewers — sign-up gate is the conversion
  // funnel and discourages scraping for outreach lists.
  const isMember = !!session
  const cleaned = announcements.map(a => ({
    ...a,
    email:   isMember ? a.email   : null,
    contact: isMember ? a.contact : null,
  }))

  return NextResponse.json({ announcements: cleaned, isMember })
}

export async function POST(req: NextRequest) {
  try {
    const ip = getIp(req)
    if (!await rateLimit(`visitor:${ip}`, 3, 24 * 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many posts from this IP. Try again later.' }, { status: 429 })
    }

    const session = await getSession()
    const body = await req.json()
    const { name, email, fromCity, intro, startsOn, endsOn, neighborhood, contact, _cf,
      travelerType, languages, lookingFor, visibility } = body

    // Turnstile required for anonymous posts; members are already gated by login.
    if (!session) {
      if (!await verifyTurnstile(_cf ?? '', ip)) {
        return NextResponse.json({ error: 'Human verification failed.' }, { status: 400 })
      }
    }

    if (!name?.trim() || !intro?.trim() || !startsOn || !endsOn) {
      return NextResponse.json({ error: 'Name, intro, and dates are required' }, { status: 400 })
    }
    if (name.length > 80 || intro.length > 1000) {
      return NextResponse.json({ error: 'Name or intro too long' }, { status: 400 })
    }

    // ISO date sanity
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) {
      return NextResponse.json({ error: 'Dates must be YYYY-MM-DD' }, { status: 400 })
    }
    if (endsOn < startsOn) {
      return NextResponse.json({ error: 'End date must be after start' }, { status: 400 })
    }
    const today = new Date().toISOString().split('T')[0]
    if (endsOn < today) {
      return NextResponse.json({ error: 'Trip ends in the past' }, { status: 400 })
    }

    const safeNeighborhood = typeof neighborhood === 'string'
      && (ISTANBUL_NEIGHBORHOODS as readonly string[]).includes(neighborhood)
      ? neighborhood : null

    const safeTravelerType = typeof travelerType === 'string'
      && (VISITOR_TRAVELER_TYPES as readonly { value: string }[]).some(t => t.value === travelerType)
      ? travelerType : null

    const LOOKING_FOR_VALUES = new Set((VISITOR_LOOKING_FOR as readonly { value: string }[]).map(t => t.value))
    const safeLookingFor = Array.isArray(lookingFor)
      ? [...new Set(lookingFor.filter((v): v is string => typeof v === 'string' && LOOKING_FOR_VALUES.has(v)))].slice(0, 10)
      : []

    // Anything other than an explicit 'public' falls back to the private
    // default — a malformed or missing value must never accidentally list
    // someone's trip on the public web.
    const safeVisibility = visibility === 'public' ? 'public' : 'members'

    // Free text, no fixed list — capped on count and per-item length so a
    // malicious payload can't stuff an oversized array into the column.
    const safeLanguages = Array.isArray(languages)
      ? [...new Set(languages.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.trim().slice(0, 30)))].slice(0, 8)
      : []

    const created = await prisma.visitorAnnouncement.create({
      data: {
        userId:       session?.id ?? null,
        name:         name.trim().slice(0, 80),
        email:        typeof email === 'string' ? email.trim().slice(0, 200) || null : null,
        fromCity:     typeof fromCity === 'string' ? fromCity.trim().slice(0, 80) || null : null,
        intro:        intro.trim().slice(0, 1000),
        startsOn,
        endsOn,
        neighborhood: safeNeighborhood,
        contact:      typeof contact === 'string' ? contact.trim().slice(0, 200) || null : null,
        travelerType: safeTravelerType,
        languages:    safeLanguages,
        lookingFor:   safeLookingFor,
        visibility:   safeVisibility,
      },
    })

    // Bust /visiting's 2-minute list cache so the new post (and the
    // poster's own "events during your visit" view) shows up immediately.
    revalidateTag('visitor-announcements')

    // Push members in the relevant neighborhood — high-intent, low-volume signal.
    // Skip if no neighborhood (avoid spamming everyone).
    if (safeNeighborhood) {
      prisma.user.findMany({
        where:  { neighborhood: safeNeighborhood, status: 'approved' },
        select: { id: true },
      }).then(locals => {
        for (const u of locals) {
          if (u.id === session?.id) continue
          createNotification(
            u.id,
            'visitor_announced',
            `👋 Visitor coming to ${safeNeighborhood}`,
            `${created.name.split(' ')[0]} from ${created.fromCity ?? 'abroad'} — ${created.startsOn} to ${created.endsOn}`,
            `/visiting`,
          ).catch(() => {})
        }
      }).catch(() => {})
    }

    return NextResponse.json({ id: created.id }, { status: 201 })
  } catch (e) {
    console.error('[visitors POST]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
