// Re-invite approved members who never activated and are past the login
// nudge's reach (nudges stop 60 days after approval). Each gets a fresh 7-day
// activation link by email, once.
//
//   DRY_RUN (default): list who would be emailed, send nothing.
//   DRY_RUN=0:         issue tokens and send.
//   MAX_AGE_DAYS=180:  ignore approvals older than this (default 180).
//
// Run on the server with both env files:
//   npx tsx --env-file=.env --env-file=.env.local scripts/reinvite-unactivated.ts

import { prisma } from '../lib/prisma'
import { issueActivationToken } from '../lib/activation'
import { sendNewActivationLinkEmail } from '../lib/email'

const DRY_RUN      = process.env.DRY_RUN !== '0'
const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS ?? 180)
const DAY          = 24 * 60 * 60 * 1000

async function main() {
  const now    = new Date()
  const oldest = new Date(now.getTime() - MAX_AGE_DAYS * DAY)
  const cutoff = new Date(now.getTime() - 60 * DAY)

  const users = await prisma.user.findMany({
    where: {
      status: 'approved', password: null, lastActive: null,
      joinedAt: { gte: oldest, lte: cutoff },
    },
    select: { id: true, name: true, email: true, joinedAt: true, nudgesSent: true },
    orderBy: { joinedAt: 'asc' },
  })

  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}${users.length} approved, never-activated members approved ${MAX_AGE_DAYS}–60 days ago`)
  for (const u of users) console.log(`  ${u.joinedAt.toISOString().slice(0, 10)}  nudges=${u.nudgesSent}  ${u.email}`)
  if (DRY_RUN) { console.log('Nothing sent. Re-run with DRY_RUN=0 to send.'); return }

  let sent = 0, failed = 0
  for (const u of users) {
    try {
      const token = await issueActivationToken(u.id, now)
      await sendNewActivationLinkEmail(u.email, u.name, token)
      await prisma.user.update({ where: { id: u.id }, data: { nudgesSent: { increment: 1 }, lastNudgedAt: now } })
      sent++
      // Resend's rate limit is per second; a short gap keeps a batch safe.
      await new Promise(r => setTimeout(r, 600))
    } catch (e) {
      failed++
      console.error(`  FAILED ${u.email}:`, e)
    }
  }
  console.log(`sent=${sent} failed=${failed}`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
