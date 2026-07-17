// Moderation routine: scan for connection-request / DM fan-out abuse
// (the "Eric pattern", 2026-07-17: mass requests overwhelmingly targeting
// women, low acceptance, big unanswered backlog — used to suspend 15
// members). Run weekly, or after any complaint about unwanted attention.
//
//   npx tsx --env-file=.env scripts/scan-connection-abuse.ts
//
// Read-only. Interpreting the output:
//   - acceptRate is the discriminator: predators fan out and get ignored
//     (<30%); people connecting with friends they met at events get
//     accepted. Same-gender skew (esp. women->women) is normal friend-
//     seeking — the ⚠️ flag fires only on cross-gender skew >= 75% for
//     male members with 15+ requests.
//   - Live rows understate history: declines older than 2026-07-17 were
//     hard-deleted. cross-check notifications for full send counts.

import { prisma } from '@/lib/prisma'

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

  console.log('--- Connection requests (15+ live rows as requester) ---')
  for (const x of requests) {
    const pctF   = Math.round(100 * x.to_f / x.sent)
    const accPct = Math.round(100 * x.acc / x.sent)
    const flag = x.gender === 'male' && x.role === 'member' && !x.suspended
      && pctF >= 75 && accPct < 30 ? '  ⚠️ REVIEW' : ''
    console.log(`${x.name}${x.suspended ? ' [suspended]' : ''}: sent=${x.sent} toWomen=${pctF}% pending=${x.pend} acceptRate=${accPct}%${flag}`)
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

  console.log('--- DMs (8+ distinct partners, members only) ---')
  for (const x of dms) {
    const pctF = Math.round(100 * x.f / x.partners)
    const flag = x.gender === 'male' && !x.suspended && pctF >= 80 ? '  ⚠️ REVIEW' : ''
    console.log(`${x.name}${x.suspended ? ' [suspended]' : ''}: partners=${x.partners} women=${pctF}% neverReplied=${x.noreply}${flag}`)
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
