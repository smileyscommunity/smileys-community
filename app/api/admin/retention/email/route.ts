import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { requireStepUp } from '@/lib/stepUp'
import { claimOnce, releaseClaim } from '@/lib/rateLimit'
import { writeAudit } from '@/lib/audit'
import { sendBroadcastEmail, recordEmailFailure } from '@/lib/email'
import {
  RETENTION_EMAIL, RETENTION_EMAIL_BATCH, isRetentionEmailKind, retentionQueue, retentionRemaining,
} from '@/lib/retentionEmail'

// POST /api/admin/retention/email { kind: 'never_attended' | 'dormant' } —
// send the next batch of that re-engagement email (lib/retentionEmail) and say
// how many are left. Each press mails at most RETENTION_EMAIL_BATCH members;
// nobody gets the same email twice.
//
// A bulk email to members: admin-only behind the same step-up as a newsletter
// send, and one batch per kind in flight at a time across all admins.

export const dynamic = 'force-dynamic'

// Resend allows about two sends a second.
const GAP_MS = 550

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const stepUp = requireStepUp(session)
  if (stepUp) return stepUp

  const body = await req.json().catch(() => ({}))
  const kind = body?.kind
  if (!isRetentionEmailKind(kind)) {
    return NextResponse.json({ error: 'Unknown email kind' }, { status: 400 })
  }
  const { action, subject, message } = RETENTION_EMAIL[kind]

  // Not per admin: two admins pressing at once would both read the same
  // queue before either had recorded a send.
  const runKey = `retention-email:${kind}`
  if (!(await claimOnce(runKey, 5 * 60_000))) {
    return NextResponse.json({ error: 'A batch is already sending — wait for it to finish.' }, { status: 409 })
  }

  try {
    const batch = await retentionQueue(kind, new Date(), RETENTION_EMAIL_BATCH)

    let sent = 0
    let failed = 0
    for (const [i, user] of batch.entries()) {
      try {
        await sendBroadcastEmail(user.id, user.email, user.name ?? '', subject, message)
        // The audit row is the "already emailed" record, so it is written only
        // after the send: a failed one stays in the queue for the next press.
        await writeAudit(session.id, session.name, action, user.id, 'user', { kind }, `Re-engagement email (${kind.replace('_', ' ')})`)
        sent++
      } catch (e) {
        failed++
        await recordEmailFailure({ helper: 'sendBroadcastEmail', recipient: user.email, error: e, context: { userId: user.id, kind } })
      }
      if (i < batch.length - 1) await new Promise(r => setTimeout(r, GAP_MS))
    }

    const remaining = await retentionRemaining(kind)
    return NextResponse.json({ sent, failed, remaining })
  } finally {
    await releaseClaim(runKey)
  }
}
