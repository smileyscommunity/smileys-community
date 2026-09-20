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
//   - LIFETIME. This ranked on a 60-day window, so an offender who stopped
//     dropped off it — the 2026-07 case the scan was built for had aged out
//     of its own report by September. Nothing ages out now; `last=` on each
//     line is what tells a live spree from settled history.

import { prisma } from '@/lib/prisma'
import { Resend } from 'resend'
import {
  THRESHOLDS as t, requestScanSql, dmScanSql,
  requestReasons, dmReasons, pct, type RequestRow, type DmRow,
} from '@/lib/connectionAbuse'

// Collected so EMAIL_REPORT can ship the same text it printed.
const report: string[] = []
function log(line: string) {
  report.push(line)
  console.log(line)
}

const day = (d: Date) => new Date(d).toISOString().slice(0, 10)

async function main() {
  const requests: RequestRow[] = await prisma.$queryRaw(requestScanSql())

  // Said in the report so a reviewer checks it before acting: a misclick on
  // /apply stays on the record, and a profile edit doesn't change it.
  log('Gender is the one given on the application (else before the first profile edit) — confirm before acting on a flag.')
  log(`--- Connection requests (${t.MIN_REQUESTS}+ ever, as requester) ---`)
  for (const x of requests) {
    const reasons = requestReasons(x)
    const flag = reasons.length ? `  ⚠️ REVIEW (${reasons.join(', ')})` : ''
    log(`${x.name}${x.suspended ? ' [suspended]' : ''}: sent=${x.sent} toWomen=${pct(x.toFemale, x.sent)}% toMen=${pct(x.toMale, x.sent)}% pending=${x.pending} (${pct(x.pending, x.sent)}% ignored) acceptRate=${pct(x.accepted, x.sent)}% last=${day(x.lastAt)}${flag}`)
  }

  const dms: DmRow[] = await prisma.$queryRaw(dmScanSql())

  log(`--- DMs (${t.MIN_DM_PARTNERS}+ distinct partners ever, members only) ---`)
  for (const x of dms) {
    const reasons = dmReasons(x)
    const flag = reasons.length ? `  ⚠️ REVIEW (${reasons.join(', ')})` : ''
    log(`${x.name}${x.suspended ? ' [suspended]' : ''}: partners=${x.partners} women=${pct(x.toFemale, x.partners)}% men=${pct(x.toMale, x.partners)}% neverReplied=${x.noReply} last=${day(x.lastAt)}${flag}`)
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
