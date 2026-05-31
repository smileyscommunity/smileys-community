import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'

// POST /api/cup/donate
//
// Public form submission for the "Donate a prize" CTA on /cup.
// Anyone can submit — no auth required, since a friend of the
// community might want to offer a prize without joining first.
// Rate limited per IP (and per user when logged in) so a script
// can't spam the queue.
//
// Stored as a CupPrizeDonation with status='pending'. Admin
// triages in /admin/campaigns/<cup-id> (Donations tab); on
// approval the shared <DonationRow /> publish form converts it
// into a CupSponsor + CupPrize in one transaction.
//
// Notifications: all admins get a notification on each new
// donation so a polite-but-firm review window can be hit (donors
// expect a reply within a day or two).

export const dynamic = 'force-dynamic'

const MAX_STR = 200
const MAX_TXT = 2000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().slice(0, max)
  return s.length > 0 ? s : null
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  const ip      = getIp(req)

  // Two-layer rate limit: per-IP (covers anonymous abuse) and
  // per-user when authenticated (covers logged-in spam). Both
  // soft enough that a sincere donor can re-submit if they
  // typed something wrong.
  if (!await rateLimit(`cup-donate-ip:${ip}`,  5, 60 * 60_000))         return NextResponse.json({ error: 'Too many submissions from this network — try again later.' }, { status: 429 })
  if (!await rateLimit(`cup-donate-ip-day:${ip}`, 15, 24 * 60 * 60_000)) return NextResponse.json({ error: 'Daily submission cap reached.' }, { status: 429 })
  if (session) {
    if (!await rateLimit(`cup-donate-user:${session.id}`, 10, 24 * 60 * 60_000)) return NextResponse.json({ error: 'You\'ve submitted plenty for today — pause and come back tomorrow.' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))

  const donorName        = clean(body.donorName, MAX_STR)
  const donorEmail       = clean(body.donorEmail, MAX_STR)
  const donorOrganization = clean(body.donorOrganization, MAX_STR)
  const donorPhone       = clean(body.donorPhone, MAX_STR)
  const prizeTitle       = clean(body.prizeTitle, MAX_STR)
  const prizeDescription = clean(body.prizeDescription, MAX_TXT)
  const notes            = clean(body.notes, MAX_TXT)
  const estimatedValue   = typeof body.estimatedValue === 'number' && Number.isInteger(body.estimatedValue) && body.estimatedValue >= 0 && body.estimatedValue <= 1_000_000
    ? body.estimatedValue
    : null

  if (!donorName)        return NextResponse.json({ error: 'Your name is required' }, { status: 400 })
  if (!donorEmail || !EMAIL_RE.test(donorEmail)) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  if (!prizeTitle)       return NextResponse.json({ error: 'What you\'re donating is required' }, { status: 400 })
  if (!prizeDescription) return NextResponse.json({ error: 'A short description is required' }, { status: 400 })

  // Stamp the donation with the world-cup-2026 campaignId so the
  // admin queue can filter cleanly across campaigns once we add
  // more. Lookup is cheap (one indexed row).
  const campaign = await prisma.campaign.findUnique({
    where:  { slug: 'world-cup-2026' },
    select: { id: true },
  })

  await prisma.cupPrizeDonation.create({
    data: {
      donorName, donorEmail, donorOrganization, donorPhone,
      prizeTitle, prizeDescription, estimatedValue, notes,
      campaignId: campaign?.id ?? null,
    },
  })

  // Notify admins — fire-and-forget so a notify outage doesn't
  // block a donor's submission. Capped to admin role; moderators
  // can see the queue via the page but don't need a ping. The
  // notification URL deep-links into the cup campaign's Donations
  // tab so a single tap lands the admin on the row to review.
  const adminUrl = campaign?.id ? `/admin/campaigns/${campaign.id}` : '/admin/campaigns'
  ;(async () => {
    const admins = await prisma.user.findMany({ where: { role: 'admin' }, select: { id: true } })
    await Promise.all(admins.map(a =>
      createNotification(a.id, 'host_message',
        '🎁 New cup prize donation',
        `${donorName} offered "${prizeTitle}" — review the queue`,
        adminUrl,
      ),
    ))
  })().catch(() => {})

  return NextResponse.json({ ok: true })
}
