import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { todayIstanbul } from '@/lib/data'
import { createNotification } from '@/lib/notify'
import { recordCronRun } from '@/lib/cronHealth'

// Weekly nudge: prompt members to review directory businesses they've
// actually visited with Smileys. For every approved+active directory
// business, find members who checked in at a past event held there and
// send ONE in-app notification for their single most-attended (still
// unreviewed) venue — never one per venue, no email; a quiet in-app nudge
// fits the no-spam ethos.
//
// Idempotent by design, which is what makes it safe to run on a schedule:
// skips any member who ever received a `directory_review_nudge`, and any
// (member, business) pair they've already reviewed. Each run only picks up
// members newly eligible since the last run (new check-ins at directory
// venues). Ported from scripts/send-review-nudges.ts.
//
// If a business name and event.location drift apart, re-check the ALIAS
// map below (same convention as scripts/import-event-venues.ts).
//
// Auth: requires `Authorization: Bearer <CRON_SECRET>`. If CRON_SECRET is
// unset, the endpoint refuses so a misconfigured prod doesn't leave the
// sweeper open to the internet.

export const dynamic = 'force-dynamic'

// Cron secret check delegated to lib/cronAuth.ts so the comparison is
// constant-time (timingSafeEqual) instead of `!==`. See that file for
// the rationale.
import { checkCronAuth } from '@/lib/cronAuth'

const ALIAS: Record<string, string> = {
  'Buka': 'Buka Yeldeğirmeni',
  'Blak Coffee Yeldeğirmeni':  'BLAK Coffee Co. Yeldeğirmeni',
  'Blak Yeldeğirmeni':         'BLAK Coffee Co. Yeldeğirmeni',
  'Black Coffee Yeldeğirmeni': 'BLAK Coffee Co. Yeldeğirmeni',
}

const norm = (s: string) => (ALIAS[s.replace(/\s+/g, ' ').trim()] ?? s.replace(/\s+/g, ' ').trim()).toLowerCase()

async function runSweep() {
  const today = todayIstanbul()

  const businesses = await prisma.business.findMany({
    where: { isApproved: true, isActive: true },
    select: { id: true, name: true },
  })
  const byName = new Map(businesses.map(b => [norm(b.name), b]))

  // Checked-in attendance at past, non-cancelled events whose venue has
  // a directory listing.
  const attendance = await prisma.eventAttendee.findMany({
    where: {
      status: 'approved', checkedIn: true,
      event: { date: { lt: today }, cancelledAt: null },
    },
    select: { userId: true, event: { select: { location: true } } },
  })

  // userId → (businessId → visit count)
  const visits = new Map<string, Map<string, number>>()
  for (const a of attendance) {
    const biz = byName.get(norm(a.event.location ?? ''))
    if (!biz) continue
    if (!visits.has(a.userId)) visits.set(a.userId, new Map())
    const m = visits.get(a.userId)!
    m.set(biz.id, (m.get(biz.id) ?? 0) + 1)
  }

  const userIds = [...visits.keys()]
  if (!userIds.length) return { scanned: 0, nudged: 0 }

  const [reviews, nudged, users] = await Promise.all([
    prisma.businessReview.findMany({
      where: { authorId: { in: userIds } },
      select: { authorId: true, businessId: true },
    }),
    prisma.notification.findMany({
      where: { type: 'directory_review_nudge', userId: { in: userIds } },
      select: { userId: true },
    }),
    prisma.user.findMany({
      where: { id: { in: userIds }, status: 'approved' },
      select: { id: true, name: true },
    }),
  ])
  const reviewed     = new Set(reviews.map(r => `${r.authorId}:${r.businessId}`))
  const alreadySent  = new Set(nudged.map(n => n.userId))
  const approvedUser = new Map(users.map(u => [u.id, u]))
  const bizId        = new Map(businesses.map(b => [b.id, b]))

  let sent = 0
  for (const [userId, m] of visits) {
    if (alreadySent.has(userId)) continue
    const user = approvedUser.get(userId)
    if (!user) continue
    // Most-visited business this member hasn't reviewed yet.
    const candidates = [...m.entries()]
      .filter(([businessId]) => !reviewed.has(`${userId}:${businessId}`))
      .sort((a, b) => b[1] - a[1])
    if (!candidates.length) continue
    const [businessId, count] = candidates[0]
    const biz = bizId.get(businessId)!

    await createNotification(
      userId,
      'directory_review_nudge',
      `Been to ${biz.name} with us?`,
      `You've checked in at ${count} Smileys event${count === 1 ? '' : 's'} there — leave the first review and help other members find it.`,
      `/directory/${businessId}`,
    )
    sent++
  }

  if (sent) console.log(`[cron sweep-review-nudges] sent ${sent} nudges`)
  return { scanned: userIds.length, nudged: sent }
}

export async function POST(req: NextRequest) {
  const denied = await checkCronAuth(req)
  if (denied) return denied

  try {
    const result = await runSweep()
    await recordCronRun('sweep-review-nudges', true)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-review-nudges]', e)
    await recordCronRun('sweep-review-nudges', false, e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}

// GET allowed for easy manual testing from a browser when CRON_SECRET is
// passed as ?key=. Keeps prod debugging painless without exposing anything
// the POST doesn't.
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured on server' },
      { status: 503 },
    )
  }
  const key = req.nextUrl.searchParams.get('key') ?? ''
  // Constant-time comparison — see lib/cronAuth.ts.
  const a = Buffer.from(key)
  const b = Buffer.from(expected)
  const { timingSafeEqual } = await import('crypto')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runSweep()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-review-nudges]', e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
