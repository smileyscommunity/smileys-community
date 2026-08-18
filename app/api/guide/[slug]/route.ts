import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { getExperienceAnyCity } from '@/lib/guideContent'

type Params = { params: Promise<{ slug: string }> }

// Viewer state + public recommend count for one experience. Public —
// the experience pages are ISR-cached, so per-viewer state has to come
// from this endpoint via a client island (same pattern as GuideCTA).
export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  // ANY city's experience, not the default city's. getExperience(slug) with no
  // cityId resolves against Istanbul alone, so saving, recommending or marking
  // done on any of Bodrum's twelve pages answered 404 — the buttons were dead
  // the moment a second city published anything.
  const found = await getExperienceAnyCity(slug)
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { cityId } = found

  const session = await getSession()
  const [recommendCount, mine] = await Promise.all([
    // Scoped to the city that owns the experience — the count was network-wide,
    // so a slug reused by two cities would have pooled their recommendations.
    prisma.guideSave.count({ where: { cityId, slug, recommended: true } }),
    session
      ? prisma.guideSave.findUnique({
          where:  { userId_cityId_slug: { userId: session.id, cityId, slug } },
          select: { saved: true, recommended: true, done: true },
        })
      : Promise.resolve(null),
  ])

  return NextResponse.json({
    recommendCount,
    viewer: session ? { saved: mine?.saved ?? false, recommended: mine?.recommended ?? false, done: mine?.done ?? false } : null,
  })
}

// Toggle save or recommend. Member-only. Upsert keeps one row per
// (member, slug) with both flags, so a member can save without
// recommending and vice versa.
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`guide-toggle:${session.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Slow down a little' }, { status: 429 })
  }

  const { slug } = await params
  // ANY city's experience, not the default city's. getExperience(slug) with no
  // cityId resolves against Istanbul alone, so saving, recommending or marking
  // done on any of Bodrum's twelve pages answered 404 — the buttons were dead
  // the moment a second city published anything. The row is written against the
  // owning city, so a member's Bodrum list and Istanbul list stay separate.
  const found = await getExperienceAnyCity(slug)
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { cityId } = found

  const body = await req.json().catch(() => ({}))
  const kind = body.kind === 'recommend' ? 'recommended'
    : body.kind === 'save' ? 'saved'
    : body.kind === 'done' ? 'done'
    : null
  if (!kind) return NextResponse.json({ error: 'kind must be save, recommend or done' }, { status: 400 })

  const existing = await prisma.guideSave.findUnique({
    where: { userId_cityId_slug: { userId: session.id, cityId, slug } },
  })
  const next = !(existing?.[kind] ?? false)

  const row = await prisma.guideSave.upsert({
    where:  { userId_cityId_slug: { userId: session.id, cityId, slug } },
    create: { userId: session.id, cityId, slug, [kind]: true },
    update: { [kind]: next },
  })

  const recommendCount = await prisma.guideSave.count({ where: { cityId, slug, recommended: true } })
  return NextResponse.json({ saved: row.saved, recommended: row.recommended, done: row.done, recommendCount })
}
