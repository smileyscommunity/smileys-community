import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'

// One way to move a payment between statuses, for the two places that do it:
// /admin/payments and the event participants checklist. They had drifted —
// the checklist wrote a PaymentLog but no audit row (so its changes were
// missing from the Audit Log and the admin home's recent activity), and both
// read the row and then updated it unconditionally, so two tabs or two admins
// acting at once could both pass the checks and both apply.
//
// The update is conditional on the status the caller read (compare-and-set):
// if someone else changed it first, nothing is written and the caller gets
// null — answer 409 and let the admin reload.

export const TERMINAL_PAYMENT_STATUSES = new Set(['refunded', 'cancelled'])

export async function changePaymentStatus(args: {
  paymentId: string
  from:      string
  to:        string
  actor:     { id: string; name: string }
  logNote:   string
  // Extra columns written in the same conditional update (e.g. notes).
  extra?:    Record<string, unknown>
  // Extra fields for the audit row's meta.
  auditMeta?: Record<string, unknown>
  auditDescription?: string
}): Promise<boolean> {
  const { paymentId, from, to, actor } = args
  const res = await prisma.payment.updateMany({
    where: { id: paymentId, status: from },
    data:  { status: to, ...(args.extra ?? {}) },
  })
  if (res.count === 0) return false
  await prisma.paymentLog.create({
    data: { paymentId, adminId: actor.id, adminName: actor.name, fromStatus: from, toStatus: to, note: args.logNote },
  })
  writeAudit(actor.id, actor.name, 'payment.status', paymentId, 'payment',
    { from, to, ...(args.auditMeta ?? {}) },
    args.auditDescription ?? `Payment status changed from ${from} to ${to}`)
  return true
}
