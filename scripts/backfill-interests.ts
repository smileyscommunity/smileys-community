// Normalize User.interests to the canonical vocabulary (lib/profileOptions
// INTERESTS = interest_tag_map keys). The registration free-text field wrote
// a junk tail ("Travel" ×191, "Hiking" ×132, "Coffee" ×103, …) that matches
// zero event tags and personalizes nothing. Maps the obvious synonyms to
// canonical slugs and drops the rest.
//
// Run on the server (both env files, per CLAUDE.md):
//   npx tsx --env-file=.env --env-file=.env.local scripts/backfill-interests.ts          # dry run
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/backfill-interests.ts  # write
//
// Idempotent: a second run finds nothing to change.

import { prisma } from '../lib/prisma'
import { INTEREST_VALUES } from '../lib/profileOptions'

// Case-insensitive synonym → canonical slug. Anything not canonical and not
// mapped here is dropped. Deliberately conservative — an ambiguous term
// ("Travel") is dropped rather than guessed into the wrong bucket.
const SYNONYMS: Record<string, string> = {
  'hiking': 'outdoor', 'walking': 'outdoor', 'nature': 'outdoor', 'camping': 'outdoor',
  'sports': 'outdoor', 'fitness': 'wellness', 'yoga': 'wellness', 'meditation': 'wellness',
  'food': 'dining', 'food & drink': 'dining', 'restaurants': 'dining', 'brunch': 'dining',
  'cooking': 'dining', 'coffee': 'dining', 'wine': 'dining',
  'language learning': 'languages', 'language exchange': 'languages',
  'business': 'networking', 'startups': 'networking', 'entrepreneurship': 'networking',
  'parties': 'social', 'nightlife': 'social', 'meetups': 'social', 'music': 'social',
  'board games': 'games', 'trivia': 'games', 'chess': 'games',
  'boats': 'sailing', 'boating': 'sailing', 'sea': 'sailing',
  'cycling': 'outdoor', 'swimming': 'outdoor', 'running': 'outdoor',
  'gaming': 'games', 'pingpong': 'games', 'ping pong': 'games',
  'pilates': 'wellness', 'taichi': 'wellness', 'tai chi': 'wellness',
  'live music': 'social', 'socializing': 'social',
  'natural wine': 'dining',
}

async function main() {
  const apply = process.env.APPLY === '1'
  const users = await prisma.user.findMany({
    select: { id: true, interests: true },
    where:  { interests: { isEmpty: false } },
  })

  let changed = 0
  const droppedTally = new Map<string, number>()

  for (const u of users) {
    const next = [...new Set(u.interests.map(raw => {
      if (INTEREST_VALUES.has(raw)) return raw
      const lower = raw.trim().toLowerCase()
      // Capitalized canonical ("Sailing") folds to its own slug.
      if (INTEREST_VALUES.has(lower)) return lower
      const mapped = SYNONYMS[lower]
      if (mapped) return mapped
      droppedTally.set(raw, (droppedTally.get(raw) ?? 0) + 1)
      return null
    }).filter((v): v is string => v !== null))]

    if (next.length === u.interests.length && next.every((v, i) => v === u.interests[i])) continue
    changed++
    if (apply) {
      // Guarded on current value so a concurrent profile edit wins.
      await prisma.user.updateMany({
        where: { id: u.id, interests: { equals: u.interests } },
        data:  { interests: next },
      })
    }
  }

  const dropped = [...droppedTally.entries()].sort((a, b) => b[1] - a[1])
  console.log(`${apply ? 'APPLIED' : 'DRY RUN'}: ${changed}/${users.length} users would change`)
  console.log('Dropped terms (not canonical, no synonym):')
  for (const [term, n] of dropped.slice(0, 40)) console.log(`  ${String(n).padStart(5)}  ${term}`)
  if (dropped.length > 40) console.log(`  … and ${dropped.length - 40} more distinct terms`)
}

main().finally(() => prisma.$disconnect())
