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
      // silently transfer ownership. Pre-check + the conditional
      // updateMany inside the transaction together close the race
      // where two admins approve competing claims concurrently
      // (without the where-guard, the second update would silently
      // overwrite the first).
      if (claim.business.claimedById && claim.business.claimedById !== claim.claimantId) {
        return NextResponse.json(
          { error: 'This business already has a different verified owner. Clear the old owner first.' },
          { status: 409 },
        )
      }
      try {
        await prisma.$transaction(async (tx) => {
          const { count } = await tx.business.updateMany({
            where: {
              id: claim.businessId,
              // Guard: only succeed if the business is still unclaimed
              // OR already claimed by THIS claimant. If a competing
              // admin's approval slipped in between our pre-check and
              // the transaction, count === 0 and we abort.
              OR: [{ claimedById: null }, { claimedById: claim.claimantId }],
            },
            data: { claimedById: claim.claimantId, claimedAt: new Date() },
          })
          if (count === 0) throw new Error('CLAIM_RACED')
          await tx.businessClaim.update({
            where: { id },
            data:  { status: 'approved', reviewedById: session.id, reviewedAt: new Date() },
          })
        })
      } catch (e) {
        if (e instanceof Error && e.message === 'CLAIM_RACED') {
          return NextResponse.json(
            { error: 'A competing claim was approved by another admin. Reload the queue.' },
            { status: 409 },
          )
        }
        throw e
      }
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
