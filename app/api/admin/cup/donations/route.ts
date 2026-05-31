import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

// GET  /api/admin/cup/donations         — list (default: pending first)
// PATCH /api/admin/cup/donations        — body: { id, action, reviewNote? }
//   actions:
//     'approve' → flips status to 'approved'. Caller can then
//                 create the matching Sponsor + Prize via the
//                 dedicated routes; this endpoint doesn't auto-
//                 create them so admin keeps full control over
//                 copy + logo + ranking.
//     'decline' → status='declined'. The row stays as history.
//
// Auth: admin OR moderator.

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const donations = await prisma.cupPrizeDonation.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],  // 'approved' < 'declined' < 'pending' alphabetically… we want pending first → sort in JS below
    select: {
      id: true, donorName: true, donorEmail: true, donorOrganization: true, donorPhone: true,
      prizeTitle: true, prizeDescription: true, estimatedValue: true, notes: true,
      status: true, reviewedAt: true, reviewNote: true,
      reviewedBy: { select: { id: true, name: true } },
      linkedSponsorId: true, linkedPrizeId: true,
      createdAt: true,
    },
  })

  // Sort: pending first (descending by createdAt), then approved
  // + declined together by createdAt desc. Postgres alphabetical
  // ordering of statuses isn't what admins want here.
  const ORDER = { pending: 0, approved: 1, declined: 2 } as const
  donations.sort((a, b) => {
    const oa = ORDER[a.status as keyof typeof ORDER] ?? 9
    const ob = ORDER[b.status as keyof typeof ORDER] ?? 9
    if (oa !== ob) return oa - ob
    return b.createdAt.getTime() - a.createdAt.getTime()
  })

  return NextResponse.json({ donations })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  const action = body.action === 'approve' || body.action === 'decline' ? body.action : null
  const reviewNote = typeof body.reviewNote === 'string' ? body.reviewNote.trim().slice(0, 2000) : null
  if (!id || !action) return NextResponse.json({ error: 'id + action required' }, { status: 400 })

  const prior = await prisma.cupPrizeDonation.findUnique({
    where:  { id },
    select: { id: true, status: true, donorName: true, prizeTitle: true },
  })
  if (!prior) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const status = action === 'approve' ? 'approved' : 'declined'
  await prisma.cupPrizeDonation.update({
    where: { id },
    data: {
      status,
      reviewedByUserId: session.id,
      reviewedAt:       new Date(),
      reviewNote,
    },
  })

  writeAudit(session.id, session.name, 'cup.donation_reviewed', id, 'cup_prize_donation',
    { from: prior.status, to: status, donorName: prior.donorName, prizeTitle: prior.prizeTitle },
    `${action === 'approve' ? 'Approved' : 'Declined'} donation: "${prior.prizeTitle}" from ${prior.donorName}`,
  )

  return NextResponse.json({ ok: true, status })
}
