// Manual runner for the first-RSVP nudge — thin wrapper over the shared matcher
// in lib/firstRsvpNudge.ts (single source of truth; the weekly cron uses the
// same code). Dry run by default. The production path is the Wednesday cron
// (app/api/cron/first-rsvp-nudge); use this only for ad-hoc dry runs / tuning.
//   Dry run:   npx tsx --env-file=.env --env-file=.env.local scripts/first-rsvp-nudge.ts
//   Test send: SEND=1 LIMIT=25 npx tsx --env-file=.env --env-file=.env.local scripts/first-rsvp-nudge.ts
import { prisma } from '../lib/prisma'
import { runFirstRsvpNudge } from '../lib/firstRsvpNudge'

async function main() {
  const dryRun = process.env.SEND !== '1'
  const limit  = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined
  const r = await runFirstRsvpNudge({ dryRun, limit })
  console.log(`\n=== First-RSVP nudge (dry run: ${dryRun}) ===`)
  console.log(`Segment (approved, signed in, never RSVP'd, not nudged in 30d, subscribed): ${r.segment}`)
  console.log(`Candidate events (room + ≥1 going): ${r.candidates}`)
  console.log(`Matched: ${r.matched}  ·  same neighbourhood: ${r.sameHood}  ·  first-timer-friendly: ${r.firstTimerFriendly}`)
  if (!dryRun) console.log(`Emailed: ${r.emailed}  ·  failed: ${r.failed}`)
  else console.log(`(dry run — no emails; set SEND=1 to send)`)
  console.log('')
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
