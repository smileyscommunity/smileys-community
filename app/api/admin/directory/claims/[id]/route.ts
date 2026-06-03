import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

// PATCH /api/admin/directory/claims/[id]
// body: { action: 'approve' | 'reject' }
//
// Approve: flips Business.claimedById to the claimant and stamps
// Business.claimedAt — the directory card then surfaces a "✓ Verified
// owner" badge. Reject: leaves the business untouched and marks the
// claim row as rejected so the claimant can re-submit with more proof
// (which resets it back to pending).
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const body = await req.json().catch(() => null) as { action?: string } | null
    const action = body?.action
    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const claim = await prisma.businessClaim.findUnique({
      where:   { id },
      include: { business: { select: { id: true, name: true, claimedById: true } } },
    })
    if (!claim) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (action === 'approve') {
      // Refuse to overwrite a different existing owner — that would
      // silently transfer ownership. Admin has to clear the old owner
      // first (PATCH /admin/directory with action='unclaim', not yet
      // implemented; for now this surfaces the conflict).
      if (claim.business.claimedById && claim.business.claimedById !== claim.claimantId) {
        return NextResponse.json(
          { error: 'This business already has a different verified owner. Clear the old owner first.' },
          { status: 409 },
        )
      }
      await prisma.$transaction([
        prisma.business.update({
          where: { id: claim.businessId },
          data:  { claimedById: claim.claimantId, claimedAt: new Date() },
        }),
        prisma.businessClaim.update({
          where: { id },
          data:  { status: 'approved', reviewedById: session.id, reviewedAt: new Date() },
        }),
      ])
      await createNotification(
        claim.claimantId, 'system',
        'Your business claim was approved',
        `You're now the verified owner of "${claim.business.name}" in the Smileys directory.`,
        '/directory',
      )
      await writeAudit(
        session.id, session.name,
        'directory.claim_approve',
        claim.id, 'business_claim',
        { businessId: claim.businessId, businessName: claim.business.name, claimantId: claim.claimantId },
      )
      return NextResponse.json({ ok: true })
    }

    // Reject path.
    await prisma.businessClaim.update({
      where: { id },
      data:  { status: 'rejected', reviewedById: session.id, reviewedAt: new Date() },
    })
    await createNotification(
      claim.claimantId, 'system',
      'Business claim not approved',
      `Your claim for "${claim.business.name}" wasn't approved. You can re-submit with more proof.`,
      '/directory',
    )
    await writeAudit(
      session.id, session.name,
      'directory.claim_reject',
      claim.id, 'business_claim',
      { businessId: claim.businessId, businessName: claim.business.name, claimantId: claim.claimantId },
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Admin claim PATCH error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
