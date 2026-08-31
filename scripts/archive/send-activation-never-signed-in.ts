/**
 * One-off: resend the activation email to every APPROVED member who has
 * never signed in (lastActive IS NULL) and never set a password
 * (password IS NULL). Same mechanism as the admin "Resend approval"
 * button (app/api/admin/users/[id]/resend-approval): invalidate old
 * tokens → fresh 7-day activation token → sendActivationEmail.
 *
 * Sets lastNudgedAt=now so the automated login-nudge cron won't
 * double-email these users within its 7-day cooldown.
 *
 * Run on the server:  npx tsx --env-file=.env scripts/send-activation-never-signed-in.ts
 * Add DRY_RUN=1 to list recipients without sending.
 */
import { prisma } from '@/lib/prisma'
import { sendActivationEmail, recordEmailFailure } from '@/lib/email'
import { hashToken } from '@/lib/tokenHash'
import { randomBytes } from 'crypto'

const DRY_RUN = process.env.DRY_RUN === '1'
const DELAY_MS = 350

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  // ONLY_EMAIL restricts the run to one recipient (e.g. re-sending after an
  // email correction) without re-emailing the whole cohort.
  const only = process.env.ONLY_EMAIL
  const users = await prisma.user.findMany({
    where: only
      ? { email: only, status: 'approved', lastActive: null, password: null }
      : { status: 'approved', lastActive: null, password: null },
    select: { id: true, name: true, email: true },
    orderBy: { joinedAt: 'desc' },
  })

  console.log(`${users.length} approved members who never signed in${DRY_RUN ? ' (DRY RUN — no emails)' : ''}`)

  let sent = 0, failed = 0
  for (const [i, user] of users.entries()) {
    const label = `[${i + 1}/${users.length}] ${user.email}`
    if (DRY_RUN) { console.log(`  would send → ${label}`); continue }
    try {
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } })
      const token     = randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      await prisma.passwordResetToken.create({ data: { userId: user.id, token: hashToken(token), expiresAt } })
      await sendActivationEmail(user.email, user.name ?? 'Member', token)
      await prisma.user.update({ where: { id: user.id }, data: { lastNudgedAt: new Date() } })
      sent++
      console.log(`  ✓ ${label}`)
    } catch (e) {
      failed++
      console.log(`  ✗ ${label} — ${(e as Error).message}`)
      await recordEmailFailure({ helper: 'sendActivationEmail', recipient: user.email, error: e, context: { userId: user.id, script: 'send-activation-never-signed-in' } })
    }
    await sleep(DELAY_MS)
  }

  console.log(`\nDone. sent=${sent} failed=${failed} total=${users.length}`)
  await prisma.$disconnect()
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
