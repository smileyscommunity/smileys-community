import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'

type Params = { params: Promise<{ id: string }> }

const MESSAGE_MAX = 1000

// GET /api/directory/[id]/claim — returns the caller's existing claim
// (if any) for this business. Used by the directory UI to surface
// "Claim pending" / "✓ You own this" / "Claim rejected" instead of
// the bare "Claim this business" button.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ claim: null })
    const { id } = await params
    const claim = await prisma.businessClaim.findUnique({
      where: { businessId_claimantId: { businessId: id, claimantId: session.id } },
      select: { id: true, status: true, message: true, createdAt: true },
    })
    return NextResponse.json({ claim })
  } catch (e) {
    console.error('Directory claim GET error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// POST /api/directory/[id]/claim — submit (or re-submit) a claim of
// ownership for an existing business. One row per (business, claimant);
// re-posting after a 'rejected' status resets to 'pending' so the admin
// can re-evaluate when the claimant provides additional proof.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 3 claims per hour per user across the whole system. Each one
    // pings every admin, so spamming would flood the notification
    // surface — same budget as direct support contacts elsewhere.
    if (!await rateLimit(`directory-claim:${session.id}`, 3, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many claim attempts. Try again later.' }, { status: 429 })
    }

    const { id } = await params
    const business = await prisma.business.findUnique({
      where: { id },
      select: { id: true, name: true, isApproved: true, isActive: true, claimedById: true },
    })
    if (!business || !business.isApproved || !business.isActive) {
      // Don't leak whether the business exists vs is unapproved — both
      // are "not visible" to the claimant.
      return NextResponse.json({ error: 'Business not found' }, { status: 404 })
    }
    if (business.claimedById && business.claimedById !== session.id) {
      return NextResponse.json({ error: 'This business has already been claimed by someone else.' }, { status: 409 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const raw = (body as Record<string, unknown>).message
    if (typeof raw !== 'string' || !raw.trim()) {
      return NextResponse.json({ error: 'Tell us why you own this business (email at the business domain, your name on the lease, etc.)' }, { status: 400 })
    }
    const message = raw.trim().slice(0, MESSAGE_MAX)

    // Upsert: a previous rejection should be reset to pending when the
    // claimant updates the message (they may have new proof). New claim
    // and re-claim both end up in `pending` for admin review.
    const claim = await prisma.businessClaim.upsert({
      where:  { businessId_claimantId: { businessId: id, claimantId: session.id } },
      create: { businessId: id, claimantId: session.id, message, status: 'pending' },
      update: { message, status: 'pending', reviewedById: null, reviewedAt: null },
    })

    // Notify admins. Best-effort — wrapped so a single notify failure
    // doesn't roll back the claim.
    try {
      const admins = await prisma.user.findMany({
        where:  { role: { in: ['admin', 'moderator'] } },
        select: { id: true },
      })
      await Promise.all(admins.map(a => createNotification(
        a.id, 'system',
        'New business claim',
        `${session.name} claims ownership of "${business.name}"`,
        '/admin/directory?status=claims',
      )))
    } catch (e) {
      console.error('Notify-on-claim failed:', e)
    }

    return NextResponse.json({ ok: true, claim: { id: claim.id, status: claim.status } })
  } catch (e) {
    console.error('Directory claim POST error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
