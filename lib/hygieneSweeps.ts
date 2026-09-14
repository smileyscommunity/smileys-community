import { prisma } from '@/lib/prisma'

// Cleanups that ride on the nightly name-hygiene sweep
// (app/api/cron/sweep-name-hygiene) instead of each getting a cron of its own.
// Every delete is batched (select ids → delete by id with the condition
// repeated) so a large first run never holds one giant statement, and is
// capped per night so a surprise backlog finishes over several runs.

const DAY_MS = 24 * 60 * 60 * 1000
export const TOKEN_GRACE_MS          = DAY_MS
export const STALE_CONNECTION_MS     = 90 * DAY_MS
export const HYGIENE_BATCH_SIZE      = 500
export const HYGIENE_MAX_BATCHES     = 40

async function deleteInBatches(
  findIds: (take: number) => Promise<{ id: string }[]>,
  deleteIds: (ids: string[]) => Promise<{ count: number }>,
): Promise<number> {
  let total = 0
  for (let i = 0; i < HYGIENE_MAX_BATCHES; i++) {
    const rows = await findIds(HYGIENE_BATCH_SIZE)
    if (rows.length === 0) break
    total += (await deleteIds(rows.map(r => r.id))).count
    if (rows.length < HYGIENE_BATCH_SIZE) break
  }
  return total
}

// Password-reset / activation (PasswordResetToken) and email-verification
// tokens are only ever pruned per user when that user asks for a new one, so
// tokens for everyone who never came back piled up (1,484 at the 2026-09 audit).
// A day of grace past expiry keeps a just-expired link's "this link expired"
// answer distinguishable from "invalid" for a little while.
export async function deleteExpiredAuthTokens(now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - TOKEN_GRACE_MS)
  const where = { expiresAt: { lt: cutoff } }
  const passwordReset = await deleteInBatches(
    take => prisma.passwordResetToken.findMany({ where, select: { id: true }, take }),
    ids  => prisma.passwordResetToken.deleteMany({ where: { id: { in: ids }, ...where } }),
  )
  const emailVerification = await deleteInBatches(
    take => prisma.emailVerificationToken.findMany({ where, select: { id: true }, take }),
    ids  => prisma.emailVerificationToken.deleteMany({ where: { id: { in: ids }, ...where } }),
  )
  return { passwordReset, emailVerification }
}

// Connection requests nobody answered in 90 days. Deleted rather than moved to
// a new 'expired' status: every reader treats any non-declined row as live —
// GET /api/connections lists it, the POST fast path returns an existing row
// as-is (so an 'expired' row would lock the pair out of ever connecting), and
// /api/members/[id] shows it as the pair's status. Deleting is exactly the
// requester's own withdraw path, nothing has an FK to the row, and it frees
// the requester's outstanding-request slot. updatedAt, not createdAt: a
// declined row flipped back to pending keeps its original createdAt.
// Declined rows are decline-memory and are never touched.
export async function deleteStaleConnectionRequests(now: Date = new Date()) {
  const where = { status: 'pending', updatedAt: { lt: new Date(now.getTime() - STALE_CONNECTION_MS) } }
  return deleteInBatches(
    take => prisma.memberConnection.findMany({ where, select: { id: true }, take }),
    ids  => prisma.memberConnection.deleteMany({ where: { id: { in: ids }, ...where } }),
  )
}
