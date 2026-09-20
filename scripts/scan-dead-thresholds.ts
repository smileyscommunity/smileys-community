// Are the admin panel's thresholds reachable by anyone?
//
//   npx tsx --env-file=.env scripts/scan-dead-thresholds.ts
//   EMAIL_REPORT=1 npx tsx --env-file=.env --env-file=.env.local scripts/scan-dead-thresholds.ts
//
// Read-only. Written after three surfaces were found on one day (2026-09-20)
// showing nothing and reading as all-clear:
//
//   - /admin/users "No-shows" filtered >= 3 settled no-shows. The most any
//     member had was 2. Permanently empty, and 23 members with standing
//     offences were invisible there.
//   - /admin/users "Connection request signals" needed 20 requests in 60
//     days. Nobody had sent 20. The query returned nothing, so the panel
//     never rendered at all.
//   - POST /events/[id]/reviews blocked a no-show only if the event carried
//     noShowProcessedAt. Standing stamps no event, so the condition was
//     permanently false and the gate stopped blocking anyone.
//
// Every one looked healthy. A threshold nobody can reach fails silently, and
// an empty list is indistinguishable from a quiet week — which is why this
// reports the DISTANCE to the bar, not just the count above it.
//
// A check is DEAD when the highest value anyone has is below the bar: no row
// can trigger it, today or on any data currently in the table. That is a bug
// in the threshold. EMPTY means reachable but nobody is there right now,
// which is usually good news and never reported as a failure.
//
// The distinction that makes this worth running: a `heuristic` bar is set by
// whoever wrote the UI against a distribution that already exists, so a max
// below it is simply wrong and always was. A `policy` bar is a rule members
// accumulate toward — standing's "two offences is a yellow card" — where a
// max below it means nobody has got there yet, which is the rule working. On
// its first run this scan called standing's yellow card DEAD on exactly that
// confusion; a guard that cries wolf is how the next real one gets ignored.

import { prisma } from '@/lib/prisma'
import { Resend } from 'resend'
import { YELLOW_AFTER_OFFENCES, RED_REVIEW_AT_ATTENDANCES, STANDING_WINDOW_DAYS } from '@/lib/standingPolicy'
import { THRESHOLDS } from '@/lib/connectionAbuse'

const report: string[] = []
const log = (l: string) => { report.push(l); console.log(l) }

interface Check {
  surface:   string   // where a human would go looking
  rule:      string   // the bar, in words
  threshold: number
  // 'heuristic' — a display bar over history that already exists: below the
  //   max means it was never reachable and the bar is wrong.
  // 'policy'    — a count members accumulate toward: below the max means not
  //   yet, and the useful number is how many are one step away.
  kind:      'heuristic' | 'policy'
  /** Every subject's score for this rule, highest first is not required. */
  values:    () => Promise<number[]>
}

// Raw SQL rather than the app's own query, on purpose: if the query and the
// threshold drift apart, a check written on top of the query would drift with
// them and still report "fine".
const nums = async (sql: string): Promise<number[]> =>
  (await prisma.$queryRawUnsafe<{ n: bigint | number }[]>(sql)).map(r => Number(r.n))

const CHECKS: Check[] = [
  {
    surface:   '/admin/users → No-shows tab (and the ✗ badge on member rows)',
    kind:      'heuristic',
    rule:      'settled no-shows per member',
    threshold: YELLOW_AFTER_OFFENCES,
    values: () => nums(`SELECT count(*) n FROM event_attendees
                        WHERE status='approved' AND attendance='no_show' GROUP BY "userId"`),
  },
  {
    surface:   '/admin/abuse → Connection requests',
    kind:      'heuristic',
    rule:      'requests sent per member (lifetime)',
    threshold: THRESHOLDS.MIN_REQUESTS,
    values: () => nums(`SELECT count(*) n FROM member_connections GROUP BY "requesterId"`),
  },
  {
    surface:   '/admin/abuse → Direct messages',
    kind:      'heuristic',
    rule:      'distinct people messaged per member (lifetime)',
    threshold: THRESHOLDS.MIN_DM_PARTNERS,
    values: () => nums(`SELECT count(DISTINCT "toId") n FROM direct_messages GROUP BY "fromId"`),
  },
  {
    surface:   '/admin/standing → yellow card',
    kind:      'policy',
    rule:      `counting offences per member in the last ${STANDING_WINDOW_DAYS} days`,
    threshold: YELLOW_AFTER_OFFENCES,
    values: () => nums(`SELECT count(*) n FROM standing_offences
                        WHERE counts AND "occurredAt" >= now() - interval '${STANDING_WINDOW_DAYS} days'
                        GROUP BY "userId"`),
  },
  {
    surface:   '/admin/standing → red card review',
    kind:      'policy',
    rule:      'check-ins banked toward clearing a card',
    threshold: RED_REVIEW_AT_ATTENDANCES,
    values: () => nums(`SELECT count(*) n FROM event_attendees
                        WHERE status='approved' AND "checkedIn" GROUP BY "userId"`),
  },
]

async function main() {
  log(`Threshold reachability — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`)
  log('DEAD = nobody can reach the bar on current data. EMPTY = reachable, nobody there.')
  log('')
  let dead = 0
  for (const c of CHECKS) {
    const values  = await c.values()
    const max     = values.length ? Math.max(...values) : 0
    const atBar   = values.filter(v => v >= c.threshold).length
    const oneAway = values.filter(v => v === c.threshold - 1).length
    const short   = max < c.threshold
    const verdict = short
      ? (c.kind === 'heuristic' ? 'DEAD ' : 'ARMED')   // policy: nobody there yet
      : atBar === 0 ? 'EMPTY' : 'OK   '
    if (verdict === 'DEAD ') dead++
    log(`${verdict} ${c.surface}`)
    log(`      ${c.rule}: bar ${c.threshold}, highest anyone has ${max}, ${atBar} at or above`)
    if (verdict === 'DEAD ') {
      log(`      → shows nothing and cannot, whatever happens. The bar is wrong, not the data.`)
    }
    if (verdict === 'ARMED') {
      log(`      → nobody has reached it yet; ${oneAway} ${oneAway === 1 ? 'is' : 'are'} one step away. The rule works, it just has not fired.`)
    }
    log('')
  }
  log(dead === 0
    ? `All ${CHECKS.length} thresholds are reachable.`
    : `${dead} of ${CHECKS.length} thresholds cannot be reached by anyone.`)
  return dead
}

async function emailReport(dead: number) {
  if (process.env.EMAIL_REPORT !== '1') return
  // Silence is the point of this scan: mail only when something is wrong, or
  // a weekly "all clear" becomes another thing nobody reads.
  if (dead === 0) { console.log('nothing dead — no email sent'); return }
  const to = process.env.ADMIN_EMAIL
  if (!to || !process.env.RESEND_API_KEY) { console.error('EMAIL_REPORT=1 but ADMIN_EMAIL/RESEND_API_KEY missing'); return }
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: process.env.EMAIL_FROM ?? 'Smileys Community <info@smileyscommunity.com>',
    to,
    subject: `${dead} admin threshold${dead > 1 ? 's' : ''} nobody can reach ⚠️`,
    text: report.join('\n'),
  })
  console.log(`report emailed to ADMIN_EMAIL (${dead} dead)`)
}

main()
  .then(emailReport)
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
