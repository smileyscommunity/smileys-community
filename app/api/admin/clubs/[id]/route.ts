import { canManageClubs, isAdminOrModerator } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { writeAudit, getDiff } from '@/lib/audit'
import { computeEventSurveyRollup, aggregateRollup } from '@/lib/survey'
import { CLUB_CATEGORIES } from '@/lib/data'

type Params = { params: Promise<{ id: string }> }

// Color values used to be free-form strings — anything could land
// in the DB and any unrecognised value would silently render as
// no-style. Restrict to either a Tailwind utility (must match the
// shape tailwind.config.js safelists) or a hex code.
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
function isValidColorString(v: string, prefix: 'text' | 'bg'): boolean {
  if (HEX_RE.test(v)) return true
  // Allow text-<color>-<shade> / bg-<color>-<shade>. Pre/post hyphen
  // shape matches Tailwind utility naming. The safelist in
  // tailwind.config.js ensures these survive the build.
  return new RegExp(`^${prefix}-[a-z]+-[0-9]{2,3}$`).test(v)
}

// GET /api/admin/clubs/[id]
//
// Returns the club row plus an aggregated quality rollup mirroring
// the per-host shape on /api/admin/users/[id]. Scope = every event
// in the club where status ∈ {published, archived}. The recent[]
// slice surfaces the last 6 events with their per-event survey
// numbers so the admin can drill from "club's would-return is
// dipping" into "which event tanked it".
//
// Auth: admin OR moderator. Same gate as the rest of /admin/clubs.
export async function GET(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params

    const club = await prisma.club.findUnique({
      where: { id },
      select: {
        id: true, name: true, description: true, category: true, emoji: true,
        color: true, bgColor: true, coverImage: true, coverImagePosition: true,
        whatsappUrl: true, instagramUrl: true, rules: true, isPrivate: true,
        location: true, foundedAt: true, isActive: true, cityId: true,
      },
    })
    if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Quality rollup — same helper that powers host quality + the
    // per-event survey badge on /admin/events. recent[] keeps the
    // most recent 6 events for in-card drill-down.
    const clubEvents = await prisma.event.findMany({
      where:   { clubId: id, status: { in: ['published', 'archived'] } },
      select:  { id: true, title: true, date: true, emoji: true },
      orderBy: { date: 'desc' },
    })
    let quality: {
      eventsHosted:    number
      surveyResponses: number
      wouldReturnRate: number | null
      anomalyCount:    number
      responseRate:    number | null
      recent:          { id: string; title: string; emoji: string; date: string; wouldReturnRate: number | null; responses: number; anomalyCount: number; responseRate: number | null }[]
    } | null = null

    if (clubEvents.length > 0) {
      const rollupMap = await computeEventSurveyRollup(clubEvents.map(e => e.id))
      const allRows   = Array.from(rollupMap.values())
      const agg       = aggregateRollup(allRows)

      const recent = clubEvents.slice(0, 6).map(e => {
        const r = rollupMap.get(e.id)
        return {
          id:              e.id,
          title:           e.title,
          emoji:           e.emoji,
          date:            e.date,
          responses:       r?.responses        ?? 0,
          wouldReturnRate: r?.wouldReturnRate ?? null,
          anomalyCount:    r?.anomalyCount    ?? 0,
          responseRate:    r?.responseRate    ?? null,
        }
      })

      quality = {
        eventsHosted:    clubEvents.length,
        surveyResponses: agg?.totalResponses  ?? 0,
        wouldReturnRate: agg?.wouldReturnRate ?? null,
        anomalyCount:    agg?.anomalyCount    ?? 0,
        responseRate:    agg?.responseRate    ?? null,
        recent,
      }
    }

    return NextResponse.json({ ...club, quality })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageClubs(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const whitelist = ['name', 'description', 'category', 'emoji', 'color', 'bgColor',
                       'whatsappUrl', 'instagramUrl', 'rules', 'isPrivate', 'coverImage', 'coverImagePosition',
                       'location', 'foundedAt', 'isActive']

    const before = await prisma.club.findUnique({
      where: { id },
      select: Object.fromEntries(whitelist.map(k => [k, true]))
    })
    if (!before) return NextResponse.json({ error: 'Club not found' }, { status: 404 })

    const body = await req.json()
    const allowed: Record<string, unknown> = {}
    for (const key of whitelist) { if (key in body) allowed[key] = body[key] }

    // Category guard — when PUT carries a category, it must be one
    // of the known options. Same reasoning as the POST validator:
    // silent fallbacks make the audit trail lie. Only validate when
    // present so other-field-only PATCHes (like the toggleActive
    // single-field PUT) don't get rejected for missing category.
    if (typeof allowed.category === 'string') {
      const cat = allowed.category.trim()
      if (!(CLUB_CATEGORIES as readonly string[]).includes(cat)) {
        return NextResponse.json({ error: `Category must be one of: ${CLUB_CATEGORIES.join(', ')}` }, { status: 400 })
      }
      allowed.category = cat
    }

    // Color / bgColor guard — these hit the DB as raw strings and
    // get injected into className across ~15 consumers. The schema
    // doesn't constrain them, so an unrecognised Tailwind class
    // would silently render as no-style after a Tailwind purge or
    // major-version upgrade. Restrict writes to one of:
    //   • A known Tailwind utility shape (text-<color>-<shade> /
    //     bg-<color>-<shade>) the build is configured to keep
    //   • A hex code (#rgb or #rrggbb) for the inline-style path
    // Anything else is rejected loudly so the admin can correct
    // before the DB receives a value that won't render.
    if (typeof allowed.color === 'string' && !isValidColorString(allowed.color, 'text')) {
      return NextResponse.json({ error: 'color must be like text-amber-600 or a #hex code' }, { status: 400 })
    }
    if (typeof allowed.bgColor === 'string' && !isValidColorString(allowed.bgColor, 'bg')) {
      return NextResponse.json({ error: 'bgColor must be like bg-amber-50 or a #hex code' }, { status: 400 })
    }

    const club = await prisma.club.update({ where: { id }, data: allowed })

    const diff = getDiff(before, allowed)
    if (diff) {
      writeAudit(session.id, session.name, 'club.update', id, 'club',
        { diff, name: String(before.name ?? '') },
        `Updated club "${before.name}"`
      )
    }

    return NextResponse.json(club)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageClubs(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    await prisma.club.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
