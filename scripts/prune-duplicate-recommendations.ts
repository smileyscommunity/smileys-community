// Prune duplicate event_recommendations rows: one row per (userId, eventId).
//
// Keeper: the earliest row (createdAt, then id) — admin analytics reads each
// member's first showing from it. Any clickedAt / rsvpedAt a loser carries
// that the keeper lacks is copied onto the keeper (earliest wins) BEFORE the
// loser goes, so no click or RSVP attribution is lost.
//
//   DRY RUN (default): complete counts (groups, rows to delete, rows kept,
//                      stamps that would be folded) + a sample of 20 groups.
//   APPLY=1:           runs the same batched prune as the nightly cron
//                      (lib/eventRecommendations.prunePairs): rows locked
//                      FOR UPDATE, plan re-made from the locked read, only
//                      those losers deleted whose keeper is locked and whose
//                      stamps landed on it. Re-runnable; prints counts after.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/prune-duplicate-recommendations.ts
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/prune-duplicate-recommendations.ts

import { prisma } from '@/lib/prisma'
import {
  listDuplicatePairs, planRecommendationPrune, pruneDuplicateRecommendations,
  type PruneGroupPlan, type RecommendationPair, type RecommendationRow,
} from '@/lib/eventRecommendations'

const APPLY = process.env.APPLY === '1'
const LOAD_PAIRS = 500

export type PruneSummary = {
  groups:        number
  rowsInGroups:  number
  rowsToDelete:  number
  rowsKept:      number
  stampFills:    number
  stampedLosers: number
  sample:        PruneGroupPlan[]
}

/** Pure: totals over the full plan plus the first `sampleSize` groups. */
export function summarizePrunePlan(plans: PruneGroupPlan[], rows: RecommendationRow[], sampleSize = 20): PruneSummary {
  const losers = new Set(plans.flatMap(p => p.loserIds))
  const rowsToDelete = losers.size
  return {
    groups:        plans.length,
    rowsInGroups:  rowsToDelete + plans.length,
    rowsToDelete,
    rowsKept:      plans.length,
    stampFills:    plans.filter(p => p.fill.clickedAt || p.fill.rsvpedAt).length,
    stampedLosers: rows.filter(r => losers.has(r.id) && (r.clickedAt || r.rsvpedAt)).length,
    sample:        plans.slice(0, sampleSize),
  }
}

async function loadRows(pairs: RecommendationPair[]): Promise<RecommendationRow[]> {
  const rows: RecommendationRow[] = []
  for (let i = 0; i < pairs.length; i += LOAD_PAIRS) {
    const chunk = pairs.slice(i, i + LOAD_PAIRS)
    rows.push(...await prisma.eventRecommendation.findMany({
      where:  { OR: chunk.map(p => ({ userId: p.userId, eventId: p.eventId })) },
      select: { id: true, userId: true, eventId: true, createdAt: true, clickedAt: true, rsvpedAt: true },
    }))
  }
  return rows
}

const iso = (d?: Date | null) => (d ? d.toISOString() : '-')

async function report(label: string) {
  const [total, pairs] = await Promise.all([prisma.eventRecommendation.count(), listDuplicatePairs()])
  const rows = await loadRows(pairs)
  const s = summarizePrunePlan(planRecommendationPrune(rows), rows)
  // groupBy and the row-level plan are read separately; say so if they disagree.
  const groupByDelete = pairs.reduce((n, p) => n + p.rows - 1, 0)
  console.log(`\n${label}: ${total} rows in event_recommendations`)
  console.log(`  duplicate groups:        ${s.groups}`)
  console.log(`  rows in those groups:    ${s.rowsInGroups}`)
  console.log(`  rows to delete:          ${s.rowsToDelete}${groupByDelete !== s.rowsToDelete ? `  (groupBy says ${groupByDelete} — table changed mid-read)` : ''}`)
  console.log(`  rows kept (one a group): ${s.rowsKept}`)
  console.log(`  keepers gaining a stamp: ${s.stampFills}`)
  console.log(`  stamped losers (folded): ${s.stampedLosers}`)
  return s
}

async function main() {
  console.log(APPLY ? 'APPLY — pruning duplicates' : 'DRY RUN — nothing is written (APPLY=1 to prune)')
  const before = await report('before')

  if (!APPLY) {
    if (before.sample.length) console.log(`\nsample (${before.sample.length} of ${before.groups} groups):`)
    for (const p of before.sample) {
      console.log(`  user ${p.userId}  event ${p.eventId}  keep ${p.keeperId}  delete ${p.loserIds.length}` +
        (p.fill.clickedAt || p.fill.rsvpedAt ? `  fill clickedAt=${iso(p.fill.clickedAt)} rsvpedAt=${iso(p.fill.rsvpedAt)}` : ''))
    }
    return
  }

  const r = await pruneDuplicateRecommendations({ budgetMs: Number.POSITIVE_INFINITY })
  console.log(`\napplied: ${r.batches} batch(es), ${r.groups} group(s), ${r.deleted} row(s) deleted, ` +
    `${r.filled} keeper(s) filled, ${r.skipped} skipped${r.done ? '' : ' — stopped before the table was clean'}`)
  await report('after')
}

// Only run as a CLI — tests import summarizePrunePlan.
if (/prune-duplicate-recommendations\.ts$/.test(process.argv[1] ?? '')) {
  main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
}
