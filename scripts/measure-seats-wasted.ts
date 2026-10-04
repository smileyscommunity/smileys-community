// Seats wasted: what an empty chair actually costs, measured the way the
// cancellation plan defines it — (no-shows + late cancellations) ÷ capacity.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/measure-seats-wasted.ts [days]   (default 60)
//
// Read-only. Why this and not "no-show rate": the day-before re-confirm turns
// the forgetful into `auto_released` BEFORE the event, so a no-show rate falls
// for mechanical reasons whether or not behaviour changed. Seats wasted keeps
// the capacity in the denominator, so it is comparable before and after, and it
// is the thing that costs the community a seat. Auto-releases are reported as
// their own line — a high, stable count means the loop is working, not that
// people are flaking.
//
// Deliberately unflattering, like measure-no-show-policy.ts:
//   · capacity-set events only, host and co-hosts excluded from the room;
//   · a ghost (approved, never scanned) is only evidence of a no-show where the
//     door was really used: at least one scan AND at least NO_SHOW_MIN_CHECKIN_RATIO
//     of the room. Events the door never scanned are counted and left out, not
//     read as "nobody came";
//   · late cancels are recorded by the system whether or not anyone scanned, so
//     they are also shown over ALL capacity-set events;
//   · free and paid are split (paid seats never auto-release — payment is the
//     deterrent — so the two should not be averaged).
import { prisma } from '@/lib/prisma'
import { NO_SHOW_MIN_CHECKIN_RATIO } from '@/lib/noShowPolicy'

const DAYS = Math.max(1, Number(process.argv[2]) || 60)

interface Row {
  paid: boolean; events: bigint; capacity: bigint
  ghosts: bigint; late: bigint; released: bigint
  uncredible_events: bigint
}

const pct = (n: number, d: number) => (d > 0 ? `${(100 * n / d).toFixed(1)}%` : 'n/a')

async function main() {
  // `date` is text 'YYYY-MM-DD'; compare as strings. Past events are 'archived'.
  const today = new Date().toISOString().slice(0, 10)
  const from  = new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10)

  const rows = await prisma.$queryRaw<Row[]>`
    WITH room AS (
      SELECT e.id AS event_id, e."totalSpots" AS capacity, (e.price > 0) AS paid,
             a.status, a."checkedIn", a."cancelledBy", a."cancelledLate"
      FROM events e
      JOIN event_attendees a ON a."eventId" = e.id
      WHERE e.status IN ('published', 'archived')
        AND e."limitedSpots" = true AND e."totalSpots" > 0
        AND e.date < ${today} AND e.date >= ${from}
        AND a."userId" <> e."hostId"
        AND NOT EXISTS (SELECT 1 FROM event_cohosts c WHERE c."eventId" = e.id AND c."userId" = a."userId")
    ), per_event AS (
      SELECT event_id, capacity, paid,
        count(*) FILTER (WHERE status = 'approved')                                              AS seats,
        count(*) FILTER (WHERE status = 'approved' AND "checkedIn")                              AS checked,
        count(*) FILTER (WHERE status = 'approved' AND NOT "checkedIn")                          AS ghosts,
        count(*) FILTER (WHERE status = 'cancelled' AND "cancelledBy" = 'member' AND "cancelledLate" IS TRUE) AS late,
        count(*) FILTER (WHERE status = 'removed' AND "cancelledBy" = 'system')                  AS released
      FROM room GROUP BY event_id, capacity, paid
    )
    SELECT paid,
      count(*) FILTER (WHERE checked > 0 AND checked::float >= seats * ${NO_SHOW_MIN_CHECKIN_RATIO}) AS events,
      coalesce(sum(capacity) FILTER (WHERE checked > 0 AND checked::float >= seats * ${NO_SHOW_MIN_CHECKIN_RATIO}), 0) AS capacity,
      coalesce(sum(ghosts)   FILTER (WHERE checked > 0 AND checked::float >= seats * ${NO_SHOW_MIN_CHECKIN_RATIO}), 0) AS ghosts,
      coalesce(sum(late)     FILTER (WHERE checked > 0 AND checked::float >= seats * ${NO_SHOW_MIN_CHECKIN_RATIO}), 0) AS late,
      coalesce(sum(released) FILTER (WHERE checked > 0 AND checked::float >= seats * ${NO_SHOW_MIN_CHECKIN_RATIO}), 0) AS released,
      count(*) FILTER (WHERE NOT (checked > 0 AND checked::float >= seats * ${NO_SHOW_MIN_CHECKIN_RATIO})) AS uncredible_events
    FROM per_event GROUP BY paid ORDER BY paid`

  console.log(`Seats wasted — capacity-set events ${from} → ${today} (${DAYS} days), host and co-hosts excluded\n`)
  for (const r of rows) {
    const events = Number(r.events), cap = Number(r.capacity), ghosts = Number(r.ghosts)
    const late = Number(r.late), released = Number(r.released)
    console.log(`${r.paid ? 'PAID' : 'FREE'}  —  ${events} events with credible check-in, ${Number(r.uncredible_events)} left out (door not really used)`)
    console.log(`  capacity            ${cap}`)
    console.log(`  ghosts (no-shows)   ${ghosts}`)
    console.log(`  late cancels        ${late}`)
    console.log(`  SEATS WASTED        ${ghosts + late}  =  ${pct(ghosts + late, cap)} of capacity`)
    console.log(`  auto-released       ${released}  (own line: ${pct(released, cap)} of capacity; not a no-show, not wasted)\n`)
  }
  if (rows.length === 0) console.log('No capacity-set events in the window.')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
