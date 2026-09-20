// Moderation routine: scan for connection-request / DM fan-out abuse
// (the "Eric pattern", 2026-07-17: mass requests overwhelmingly targeting
// women, low acceptance, big unanswered backlog — used to suspend 15
// members). Run weekly, or after any complaint about unwanted attention.
//
//   npx tsx --env-file=.env scripts/scan-connection-abuse.ts
//
// With EMAIL_REPORT=1 (and .env.local for RESEND_API_KEY), the report is
// also emailed to ADMIN_EMAIL — this is how the weekly cron delivers it:
//   EMAIL_REPORT=1 npx tsx --env-file=.env --env-file=.env.local scripts/scan-connection-abuse.ts
//
// Read-only. The thresholds and the flag rules live in lib/connectionAbuse,
// shared with the live admin panel (/app/admin/users) so the two cannot drift
// apart again — they had, and the panel was the stricter of the two while
// claiming parity. Interpreting the output:
//   - acceptRate is the discriminator: predators fan out and get ignored;
//     people connecting with friends they met at events get accepted.
//     ignoreRate (pending/sent) is the companion — when targets ignore
//     rather than decline, requests pile up pending and inflate acceptRate.
//   - Live rows understate history: declines older than 2026-07-17 were
//     hard-deleted. Cross-check notifications for full send counts.
//   - WINDOWED. Ranking on ALL-TIME rows buried a live 2026-09 cohort
//     (10-request sprays to women, brand-new accounts) under last quarter's
//     high-volume history, and kept resurfacing suspended-then-returned
//     members whose flagged rows predate their suspension. So the scan ranks
//     on the last WINDOW_DAYS (default 60) only: an offender who has stopped
//     drops off, and a low-volume active one rises.
//     WINDOW_DAYS=0 restores the all-time view for a historical audit.

import { prisma } from '@/lib/prisma'
import { Resend } from 'resend'
import {
  thresholds, cutoffFor, DEFAULT_WINDOW_DAYS, requestScanSql, dmScanSql,
  requestReasons, dmReasons, pct, type RequestRow, type DmRow,
} from '@/lib/connectionAbuse'

// Collected so EMAIL_REPORT can ship the same text it printed.
const report: string[] = []
function log(line: string) {
  report.push(line)
  console.log(line)
}

async function main() {
  const WINDOW_DAYS = process.env.WINDOW_DAYS === undefined ? DEFAULT_WINDOW_DAYS : Number(process.env.WINDOW_DAYS)
  const cutoff = cutoffFor(WINDOW_DAYS)
  const t = thresholds(WINDOW_DAYS)
  const windowLabel = WINDOW_DAYS > 0 ? `last ${WINDOW_DAYS} days` : 'all time'

  const requests: RequestRow[] = await prisma.$queryRaw(requestScanSql(cutoff, t.MIN_REQUESTS))

  // Said in the report so a reviewer checks it before acting: a misclick on
  // /apply stays on the record, and a profile edit doesn't change it.
  log('Gender is the one given on the application (else before the first profile edit) — confirm before acting on a flag.')
  log(`--- Connection requests (${t.MIN_REQUESTS}+ in ${windowLabel}, as requester) ---`)
  for (const x of requests) {
    const reasons = requestReasons(x, t)
    const flag = reasons.length ? `  ⚠️ REVIEW (${reasons.join(', ')})` : ''
    log(`${x.name}${x.suspended ? ' [suspended]' : ''}: sent=${x.sent} toWomen=${pct(x.toFemale, x.sent)}% toMen=${pct(x.toMale, x.sent)}% pending=${x.pending} (${pct(x.pending, x.sent)}% ignored) acceptRate=${pct(x.accepted, x.sent)}%${flag}`)
  }

  const dms: DmRow[] = await prisma.$queryRaw(dmScanSql(cutoff, t.MIN_DM_PARTNERS))

  log(`--- DMs (${t.MIN_DM_PARTNERS}+ distinct partners in ${windowLabel}, members only) ---`)
  for (const x of dms) {
    const reasons = dmReasons(x, t)
    const flag = reasons.length ? `  ⚠️ REVIEW (${reasons.join(', ')})` : ''
    log(`${x.name}${x.suspended ? ' [suspended]' : ''}: partners=${x.partners} women=${pct(x.toFemale, x.partners)}% men=${pct(x.toMale, x.partners)}% neverReplied=${x.noReply}${flag}`)
  }
}

async function emailReport() {
  if (process.env.EMAIL_REPORT !== '1') return
  const to = process.env.ADMIN_EMAIL
  if (!to || !process.env.RESEND_API_KEY) { console.error('EMAIL_REPORT=1 but ADMIN_EMAIL/RESEND_API_KEY missing'); return }
  const flagged = report.filter(l => l.includes('REVIEW')).length
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: process.env.EMAIL_FROM ?? 'Smileys Community <info@smileyscommunity.com>',
    to,
    subject: `Weekly connection-abuse scan: ${flagged ? flagged + ' member(s) flagged ⚠️' : 'all clear ✅'}`,
    text: report.join('\n'),
  })
  console.log(`report emailed to ADMIN_EMAIL (${flagged} flagged)`)
}

main()
  .then(emailReport)
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
