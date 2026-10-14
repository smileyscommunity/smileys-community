// Email members who joined, set up their account and have never been to an
// event (Retention > Never attended), in batches. The audience is the same
// one the newsletter's "Never attended" segments use (lib/newsletterSegments):
// activated, opted in to email, verified, approved, joined over 7 days ago.
// Anyone who unsubscribed from newsletters is therefore left out.
//
// Each member is emailed once, ever. A send is recorded as an audit row
// (action retention.never_attended_email) and the selection skips anyone who
// has one, so re-running the script just takes the next batch.
//
//   DRY_RUN (default): list who the next batch would reach, send nothing.
//   DRY_RUN=0:         send the batch.
//   TEST_TO=you@x.com: send ONE copy to that member's address, no audit row,
//                      ignoring the audience filter. Use this to proof the copy.
//   COHORT=new|old|both  new = joined 7–60d ago, old = 60d+ (default new: the
//                      warmer group first, as the newsletter segments do).
//   BATCH=50:          members per run (default 50).
//   SUBJECT / MESSAGE: override the copy below. MESSAGE separates paragraphs
//                      with a blank line.
//
// Run on the server with both env files:
//   npx tsx --env-file=.env --env-file=.env.local scripts/email-never-attended.ts

import { prisma } from '../lib/prisma'
import { sendBroadcastEmail } from '../lib/email'
import { recipientWhere } from '../lib/newsletterSegments'
import { writeAudit, SCRIPT_ACTOR } from '../lib/audit'
import { RETENTION_EMAIL } from '../lib/retentionEmail'

const DRY_RUN = process.env.DRY_RUN !== '0'
const TEST_TO = process.env.TEST_TO?.trim().toLowerCase() || null
const COHORT  = process.env.COHORT ?? 'new'
const BATCH   = Math.max(1, Number(process.env.BATCH ?? 50))
const ACTION  = RETENTION_EMAIL.never_attended.action

// Same copy and audit action as the Retention page's First-event email button,
// so the two never double-send.
const SUBJECT = process.env.SUBJECT ?? RETENTION_EMAIL.never_attended.subject
const MESSAGE = process.env.MESSAGE ?? RETENTION_EMAIL.never_attended.message

async function main() {
  if (!['new', 'old', 'both'].includes(COHORT)) throw new Error(`COHORT must be new, old or both (got "${COHORT}")`)

  if (TEST_TO) {
    const u = await prisma.user.findFirst({ where: { email: { equals: TEST_TO, mode: 'insensitive' } }, select: { id: true, name: true, email: true } })
    if (!u) throw new Error(`No member with email ${TEST_TO}`)
    console.log(`TEST — subject: ${SUBJECT}`)
    if (DRY_RUN) { console.log(`Would send one test copy to ${u.email}. Re-run with DRY_RUN=0 to send.`); return }
    await sendBroadcastEmail(u.id, u.email, u.name, SUBJECT, MESSAGE)
    console.log(`Test sent to ${u.email}. No audit row written.`)
    return
  }

  const now   = new Date()
  const where = COHORT === 'both'
    ? { OR: [recipientWhere('never_attended_new', undefined, now), recipientWhere('never_attended_old', undefined, now)] }
    : recipientWhere(COHORT === 'old' ? 'never_attended_old' : 'never_attended_new', undefined, now)

  const done = new Set(
    (await prisma.auditLog.findMany({ where: { action: ACTION, targetType: 'user' }, select: { targetId: true } }))
      .map(r => r.targetId).filter((x): x is string => !!x),
  )

  const all = await prisma.user.findMany({
    where,
    select: { id: true, name: true, email: true, joinedAt: true },
    orderBy: { joinedAt: 'desc' }, // most recently joined first: the warmest
  })
  const todo  = all.filter(u => !done.has(u.id))
  const batch = todo.slice(0, BATCH)

  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}cohort=${COHORT}: ${all.length} in audience, ${all.length - todo.length} already emailed, ${todo.length} still to send; this batch = ${batch.length}`)
  console.log(`Subject: ${SUBJECT}\n`)
  for (const u of batch) console.log(`  ${u.joinedAt.toISOString().slice(0, 10)}  ${u.email}`)
  if (DRY_RUN) { console.log('\nNothing sent. Re-run with DRY_RUN=0 to send this batch.'); return }

  let sent = 0, failed = 0
  for (const u of batch) {
    try {
      await sendBroadcastEmail(u.id, u.email, u.name, SUBJECT, MESSAGE)
      await writeAudit(SCRIPT_ACTOR.id, SCRIPT_ACTOR.name, ACTION, u.id, 'user', { cohort: COHORT }, 'Never-attended re-engagement email')
      sent++
      // Resend allows ~2 requests a second.
      await new Promise(r => setTimeout(r, 600))
    } catch (e) {
      failed++
      console.error(`  FAILED ${u.email}:`, e)
    }
  }
  console.log(`\nsent=${sent} failed=${failed} remaining=${todo.length - sent} (failed ones stay in the queue)`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
