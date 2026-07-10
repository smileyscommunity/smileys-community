/**
 * One-off: re-send a newsletter to recipients whose original send FAILED
 * (rate-limit 429s from the pre-batch sender), skipping everyone who already
 * received it. The "missed" set is authoritative from email_failures, which is
 * disjoint from newsletter_email_logs (a recipient either got a Resend id or
 * failed) — so this cannot double-send to the 218 who already have it.
 *
 * Run (server, both env files):
 *   DRY_RUN=true  npx tsx --env-file=.env --env-file=.env.local scripts/resend-missed-newsletter.ts
 *   DRY_RUN=false npx tsx --env-file=.env --env-file=.env.local scripts/resend-missed-newsletter.ts
 */
import { prisma } from '@/lib/prisma'
import { sendNewsletterBatch, recordEmailFailure } from '@/lib/email'

const NEWSLETTER_ID = 'cmren0ibo0024296fz6ps4cf8' // "This week at Smileys 📅"
const ORIGINAL_HELPER = 'sendNewsletterEmail'      // helper name the 840 failures were logged under
const DRY_RUN = process.env.DRY_RUN !== 'false'    // must explicitly pass DRY_RUN=false to send
const SAFETY_CAP = 900                             // abort if the target set is unexpectedly large

async function main() {
  const nl = await prisma.newsletter.findUnique({
    where: { id: NEWSLETTER_ID },
    select: { id: true, subject: true, bodyHtml: true },
  })
  if (!nl) throw new Error(`Newsletter ${NEWSLETTER_ID} not found`)

  // Missed-but-still-eligible: eligible today AND email appears in the original
  // failure log. lower() both sides so casing mismatches don't slip anyone.
  const recipients = await prisma.$queryRaw<{ id: string; email: string; name: string }[]>`
    SELECT u.id, u.email, u.name
    FROM users u
    WHERE u."emailMarketing" = true
      AND u."emailVerified"  = true
      AND u.status = 'approved'
      AND lower(u.email) IN (
        SELECT DISTINCT lower(recipient) FROM email_failures WHERE helper = ${ORIGINAL_HELPER}
      )
    ORDER BY u.email
  `

  console.log(`Newsletter: "${nl.subject}"`)
  console.log(`Target recipients (missed + still eligible): ${recipients.length}`)
  console.log(`Sample:`)
  for (const r of recipients.slice(0, 8)) console.log(`  - ${r.email} (${r.name})`)
  if (recipients.length > 8) console.log(`  … and ${recipients.length - 8} more`)

  if (recipients.length > SAFETY_CAP) {
    throw new Error(`Refusing to send: ${recipients.length} exceeds safety cap ${SAFETY_CAP}`)
  }
  if (recipients.length === 0) {
    console.log('Nothing to send.')
    return
  }

  if (DRY_RUN) {
    console.log('\nDRY_RUN — no emails sent. Re-run with DRY_RUN=false to send.')
    return
  }

  console.log('\nSending via Resend Batch API…')
  const { sent, resendLogs, failed } = await sendNewsletterBatch(recipients, nl.subject, nl.bodyHtml, nl.id)

  if (resendLogs.length > 0) {
    await prisma.newsletterEmailLog.createMany({ data: resendLogs, skipDuplicates: true })
  }
  // Log any NEW failures under a distinct helper so the original 840-set stays stable.
  for (const f of failed) {
    await recordEmailFailure({ helper: 'sendNewsletterEmail (resend)', recipient: f.email, error: f.error }).catch(() => {})
  }

  // Bump recipientCount to reflect the total now delivered (218 original + this run).
  await prisma.newsletter.update({
    where: { id: nl.id },
    data:  { recipientCount: { increment: sent } },
  })

  console.log(`\nDone. sent=${sent}, failed=${failed.length}, logged=${resendLogs.length}`)
  if (failed.length > 0) {
    console.log('First few failures:')
    for (const f of failed.slice(0, 5)) console.log(`  - ${f.email}: ${f.error}`)
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
