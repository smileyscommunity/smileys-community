import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'

export const dynamic = 'force-dynamic'

// Member self-submitted quote, from the dashboard nudge. Lands HIDDEN
// (active: false) in the same queue /admin/stories already manages — an
// admin flips it live exactly like an admin-authored one. One quote per
// member: the testimonials wall is a chorus, not anyone's feed.
const QUOTE_MIN = 20
const QUOTE_MAX = 300
// Same allowlist the admin testimonial routes enforce for photo paths.
const PHOTO_PATH_RE = /^\/app\/api\/files\/[a-zA-Z0-9\-_/]+\.(jpg|jpeg|png|webp|gif)$/i

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!await rateLimit(`testimonial-submit:${session.id}`, 3, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many submissions this hour' }, { status: 429 })
    }

    const body = await req.json().catch(() => null)
    const quote = typeof body?.quote === 'string' ? body.quote.trim() : ''
    if (quote.length < QUOTE_MIN) return NextResponse.json({ error: 'Tell us a little more — a sentence or two.' }, { status: 400 })
    if (quote.length > QUOTE_MAX) return NextResponse.json({ error: `Keep it under ${QUOTE_MAX} characters.` }, { status: 400 })

    const already = await prisma.testimonial.count({ where: { userId: session.id } })
    if (already > 0) return NextResponse.json({ error: 'You already shared a quote — thank you!' }, { status: 409 })

    const user = await prisma.user.findUnique({
      where:  { id: session.id },
      select: { name: true, profilePhoto: true, joinedAt: true, cityId: true },
    })
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // "Sara K." — the wall's existing name format; never the full surname.
    const parts = user.name.trim().split(/\s+/)
    const memberName = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0]
    const role = user.joinedAt ? `Member since ${user.joinedAt.getFullYear()}` : null

    const maxOrder = await prisma.testimonial.aggregate({ _max: { order: true } })
    const testimonial = await prisma.testimonial.create({
      data: {
        memberName,
        role,
        quote,
        category: 'general',
        // The member's avatar only if it's a path our file route serves —
        // anything else (legacy external URLs) is dropped, matching the
        // admin routes' allowlist.
        photo:  user.profilePhoto && PHOTO_PATH_RE.test(user.profilePhoto) ? user.profilePhoto : null,
        active: false,
        order:  (maxOrder._max.order ?? 0) + 1,
        cityId: user.cityId,
        userId: session.id,
      },
      select: { id: true },
    })

    // Same admin fan-out shape as directory submissions.
    const admins = await prisma.user.findMany({ where: { role: { in: ['admin', 'moderator'] } }, select: { id: true } })
    await Promise.all(admins.map(a => createNotification(
      a.id, 'testimonial_submission',
      'New member quote',
      `${memberName} shared a quote for the testimonials wall`,
      '/admin/stories',
    ))).catch(e => console.error('Testimonial admin notify failed:', e))

    return NextResponse.json({ ok: true, id: testimonial.id })
  } catch (e) {
    console.error('Testimonial submit error:', e)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
