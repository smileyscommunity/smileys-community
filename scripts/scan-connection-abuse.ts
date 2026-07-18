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
// Read-only. Interpreting the output:
//   - acceptRate is the discriminator: predators fan out and get ignored
//     (<30%); people connecting with friends they met at events get
//     accepted. ignoreRate (pending/sent) is the companion signal — when
//     targets ignore rather than decline, requests pile up pending and
//     inflate acceptRate, so a big backlog (>=50%) flags on its own.
//     Same-gender skew (esp. women->women) is normal friend-seeking — the
//     ⚠️ flag fires only on cross-gender skew >= 75% for male members with
//     15+ requests, when acceptRate < 30% OR ignoreRate >= 50%.
//   - Live rows understate history: declines older than 2026-07-17 were
//     hard-deleted. cross-check notifications for full send counts.

import { prisma } from '@/lib/prisma'
import { Resend } from 'resend'

// Collected so EMAIL_REPORT can ship the same text it printed.
const report: string[] = []
function log(line: string) {
  report.push(line)
  console.log(line)
}

async function main() {
  const requests: {
    name: string; gender: string | null; role: string; suspended: boolean
    sent: number; to_f: number; pend: number; acc: number
  }[] = await prisma.$queryRaw`
    SELECT u.name, u.gender, u.role,
           (u."suspendedUntil" IS NOT NULL AND u."suspendedUntil" > NOW()) AS suspended,
           COUNT(*)::int AS sent,
           SUM(CASE WHEN r.gender = 'female' THEN 1 ELSE 0 END)::int AS to_f,
           SUM(CASE WHEN mc.status = 'pending'  THEN 1 ELSE 0 END)::int AS pend,
           SUM(CASE WHEN mc.status = 'accepted' THEN 1 ELSE 0 END)::int AS acc
    FROM member_connections mc
    JOIN users u ON u.id = mc."requesterId"
    JOIN users r ON r.id = mc."receiverId"
    GROUP BY u.id
    HAVING COUNT(*) >= 15
    ORDER BY COUNT(*) DESC`

  log('--- Connection requests (15+ live rows as requester) ---')
  for (const x of requests) {
    const pctF   = Math.round(100 * x.to_f / x.sent)
    const accPct = Math.round(100 * x.acc / x.sent)
    // ignoreRate catches the fan-out-and-get-ignored variant: targets who
    // neither accept nor decline just leave the request pending, which
    // *inflates* the denominator of accPct and hides the sender under the
    // <30% accept threshold (e.g. Zabdawi/Ntamen/Khristy, 2026-07-18).
    // Treat a heavy backlog of unanswered requests as its own red flag.
    const ignorePct = Math.round(100 * x.pend / x.sent)
    const flag = x.gender === 'male' && x.role === 'member' && !x.suspended
      && pctF >= 75 && (accPct < 30 || ignorePct >= 50) ? '  ⚠️ REVIEW' : ''
    log(`${x.name}${x.suspended ? ' [suspended]' : ''}: sent=${x.sent} toWomen=${pctF}% pending=${x.pend} (${ignorePct}% ignored) acceptRate=${accPct}%${flag}`)
  }

  // DM fan-out: many one-way threads to women. Requires an accepted
  // connection to even exist, so it catches the "get accepted, then work
  // the inbox" variant the request scan misses.
  const dms: { name: string; gender: string | null; suspended: boolean; partners: number; f: number; noreply: number }[] = await prisma.$queryRaw`
    WITH threads AS (
      SELECT "fromId", "toId", COUNT(*) AS n FROM direct_messages GROUP BY "fromId", "toId"
    )
    SELECT u.name, u.gender,
           (u."suspendedUntil" IS NOT NULL AND u."suspendedUntil" > NOW()) AS suspended,
           COUNT(*)::int AS partners,
           SUM(CASE WHEN p.gender = 'female' THEN 1 ELSE 0 END)::int AS f,
           SUM(CASE WHEN rev."fromId" IS NULL THEN 1 ELSE 0 END)::int AS noreply
    FROM threads t
    JOIN users u ON u.id = t."fromId" AND u.role = 'member'
    JOIN users p ON p.id = t."toId"
    LEFT JOIN threads rev ON rev."fromId" = t."toId" AND rev."toId" = t."fromId"
    GROUP BY u.id
    HAVING COUNT(*) >= 8
    ORDER BY COUNT(*) DESC`

  log('--- DMs (8+ distinct partners, members only) ---')
  for (const x of dms) {
    const pctF = Math.round(100 * x.f / x.partners)
    const flag = x.gender === 'male' && !x.suspended && pctF >= 80 ? '  ⚠️ REVIEW' : ''
    log(`${x.name}${x.suspended ? ' [suspended]' : ''}: partners=${x.partners} women=${pctF}% neverReplied=${x.noreply}${flag}`)
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
