import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { requireStepUp } from '@/lib/stepUp'
import { claimOnce, releaseClaim } from '@/lib/rateLimit'
import { writeAudit } from '@/lib/audit'
import { getCityTz } from '@/lib/city'
import { DEFAULT_TZ } from '@/lib/cityTime'
import { addActivationToken } from '@/lib/activation'
import { approvedWhen } from '@/lib/activationWhatsApp'
import { sendActivationLastCallEmail, recordEmailFailure } from '@/lib/email'
import { lastCallWhere, LAST_CALL_BATCH } from '@/lib/activationLastCall'

// POST /api/admin/retention/last-call — send the next batch of the one-time
// "last call" activation email (lib/activationLastCall) and say how many are
// left. Each press mails at most LAST_CALL_BATCH members; nobody gets it twice.
//
// A bulk email to members: admin-only behind the same step-up as a newsletter
// send, and one press at a time per admin.

export const dynamic = 'force-dynamic'

// Resend allows about two sends a second.
const GAP_MS = 550

export async function POST() {
  const session = await getSession()
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const stepUp = requireStepUp(session)
  if (stepUp) return stepUp

  // One batch in flight per admin: a second tap while the first is still
  // sending gets a clear answer instead of racing it.
  const runKey = `activation-last-call:${session.id}`
  if (!(await claimOnce(runKey, 5 * 60_000))) {
    return NextResponse.json({ error: 'A batch is already sending — wait for it to finish.' }, { status: 409 })
  }

  try {
    const now = new Date()
    const batch = await prisma.user.findMany({
      where:   lastCallWhere(now),
      select:  { id: true, name: true, email: true, joinedAt: true, cityId: true },
      orderBy: { joinedAt: 'desc' },   // most recent approvals first: likeliest to still want in
      take:    LAST_CALL_BATCH,
    })

    const tzCache = new Map<string, string>()
    const tzFor = async (cityId: string | null) => {
      if (!cityId) return DEFAULT_TZ
      if (!tzCache.has(cityId)) tzCache.set(cityId, await getCityTz(cityId).catch(() => DEFAULT_TZ))
      return tzCache.get(cityId)!
    }

    let sent = 0
    let failed = 0
    for (const [i, user] of batch.entries()) {
      // Claim the member first, so two presses (or two admins) can never both
      // email them. Lost the claim = someone else took them; skip.
      const claimed = await prisma.user.updateMany({
        where: { id: user.id, activationLastCallAt: null, password: null },
        data:  { activationLastCallAt: now },
      })
      if (claimed.count === 0) continue

      try {
        const token = await addActivationToken(user.id, now)
        const when  = approvedWhen(user.joinedAt, now, await tzFor(user.cityId))
        await sendActivationLastCallEmail(user.email, user.name ?? '', token, when)
        sent++
      } catch (e) {
        failed++
        // Not sent, so not "had their last call": hand them back to the queue.
        await prisma.user.update({ where: { id: user.id }, data: { activationLastCallAt: null } }).catch(() => {})
        await recordEmailFailure({ helper: 'sendActivationLastCallEmail', recipient: user.email, error: e, context: { userId: user.id } })
      }
      if (i < batch.length - 1) await new Promise(r => setTimeout(r, GAP_MS))
    }

    const remaining = await prisma.user.count({ where: lastCallWhere(new Date()) })
    if (sent > 0) {
      writeAudit(session.id, session.name, 'user.activation_last_call', undefined, undefined,
        { sent, failed, remaining },
        `Sent the last-call activation email to ${sent} member${sent === 1 ? '' : 's'}${failed ? ` (${failed} failed)` : ''}`)
    }
    return NextResponse.json({ sent, failed, remaining })
  } finally {
    await releaseClaim(runKey)
  }
}
