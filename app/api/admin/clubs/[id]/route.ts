import { canManageClubs, isAdminOrModerator } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { writeAudit, getDiff } from '@/lib/audit'
import { computeEventSurveyRollup, aggregateRollup } from '@/lib/survey'
import { CLUB_CATEGORIES } from '@/lib/data'

type Params = { params: Promise<{ id: string }> }

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
