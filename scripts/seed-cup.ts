// Smileys Cup 2026 — seed script.
//
// Run once after deploying the cup schema:
//   npx tsx scripts/seed-cup.ts
//
// Creates the "world-cup-2026" club (idempotent — upsert by slug)
// and seeds the knockout fixture structure with placeholder team
// labels. Group-stage fixtures are NOT seeded — they don't get
// scored in v1, and the bracket pick covers the only thing members
// need from groups (which 4 teams reach the SF). When group play
// concludes (Jun 25), admin uses /admin/cup to fill in actual home/
// away teams for the R32 matchups.
//
// Kickoff times below are placeholders aligned to the published
// schedule shape: R32 starts Jun 27 18:00 ET, knockout rounds
// follow ~3-day cadence, final on Jul 19 15:00 ET (Istanbul +6h).
// Admin can adjust per-fixture as FIFA confirms exact times.

import { prisma } from '@/lib/prisma'

const SLUG = 'world-cup-2026'

async function main() {
  // ── Find or pick a city for the club ───────────────────────────
  // Istanbul is the only live city at seed time; defensive lookup
  // in case the slug ever drifts.
  const city = await prisma.city.findFirst({
    where:  { OR: [{ slug: 'istanbul' }, { name: 'Istanbul' }] },
    select: { id: true },
  })
  if (!city) throw new Error('Istanbul city not found — backfill before seeding cup')

  // ── Upsert the cup club ───────────────────────────────────────
  const club = await prisma.club.upsert({
    where:  { slug: SLUG },
    create: {
      slug:        SLUG,
      name:        'Smileys Cup 2026',
      description: 'Predictions, watch parties, and the trophy. Pick a champion, watch the games with us, climb the leaderboard. Tournament runs Jun 11 – Jul 19.',
      category:    'Sports',
      emoji:       '🏆',
      color:       '#f59e0b',
      bgColor:     '#fef3c7',
      rules:       '· One pick per match — locks at kickoff.\n· Bracket pick (champion + 4 semifinalists) locks at first kickoff.\n· Picks are private until match locks. Leaderboard is public.\n· Tiebreaker: earlier bracket submission.',
      isActive:    true,
      cityId:      city.id,
      memberCount: 0,
    },
    update: {},
    select: { id: true, slug: true },
  })
  console.log(`✓ Cup club: ${club.slug} (${club.id})`)

  // ── Knockout fixtures — seed structure with placeholder labels ─
  // R32 = 16 matches, R16 = 8, QF = 4, SF = 2, Final = 1. We seed
  // every slot so the page can render the bracket from day 1, even
  // though early-round teams are TBD ("Winner Group A"). Admin fills
  // home/awayTeam as group play resolves.
  //
  // Group letters span A–L in the 48-team format. R32 pairings
  // follow the format's standard bracket map (1A vs 2B, 1B vs 1F,
  // etc.) — placeholders here use simplified labels; admin can edit
  // the labels in /admin/cup if FIFA's official map differs.
  type FixtureSeed = {
    id: string; round: 'r32' | 'r16' | 'qf' | 'sf' | 'final'
    homeLabel: string; awayLabel: string; kickoffAt: string; points: number
  }
  const fixtures: FixtureSeed[] = [
    // R32 (Jun 27 – Jul 1) — 16 matches
    ...Array.from({ length: 16 }).map((_, i) => ({
      id:        `2026-WC-R32-${i + 1}`,
      round:     'r32' as const,
      homeLabel: `R32 ${String.fromCharCode(65 + (i * 2) % 12)} winner`,
      awayLabel: `R32 ${String.fromCharCode(65 + (i * 2 + 1) % 12)} runner-up`,
      kickoffAt: new Date(`2026-06-${27 + Math.floor(i / 4)}T${15 + (i % 4) * 3}:00:00+03:00`).toISOString(),
      points:    3,
    })),
    // R16 (Jul 4 – 7) — 8 matches
    ...Array.from({ length: 8 }).map((_, i) => ({
      id:        `2026-WC-R16-${i + 1}`,
      round:     'r16' as const,
      homeLabel: `Winner R32-${i * 2 + 1}`,
      awayLabel: `Winner R32-${i * 2 + 2}`,
      kickoffAt: new Date(`2026-07-${4 + Math.floor(i / 2)}T${17 + (i % 2) * 4}:00:00+03:00`).toISOString(),
      points:    5,
    })),
    // QF (Jul 9 – 12) — 4 matches
    ...Array.from({ length: 4 }).map((_, i) => ({
      id:        `2026-WC-QF-${i + 1}`,
      round:     'qf' as const,
      homeLabel: `Winner R16-${i * 2 + 1}`,
      awayLabel: `Winner R16-${i * 2 + 2}`,
      kickoffAt: new Date(`2026-07-${9 + i}T20:00:00+03:00`).toISOString(),
      points:    10,
    })),
    // SF (Jul 15 – 16) — 2 matches
    {
      id:        '2026-WC-SF-1',
      round:     'sf' as const,
      homeLabel: 'Winner QF-1', awayLabel: 'Winner QF-2',
      kickoffAt: new Date('2026-07-15T21:00:00+03:00').toISOString(),
      points:    20,
    },
    {
      id:        '2026-WC-SF-2',
      round:     'sf' as const,
      homeLabel: 'Winner QF-3', awayLabel: 'Winner QF-4',
      kickoffAt: new Date('2026-07-16T21:00:00+03:00').toISOString(),
      points:    20,
    },
    // Final (Jul 19) — 1 match
    {
      id:        '2026-WC-FINAL',
      round:     'final' as const,
      homeLabel: 'Winner SF-1', awayLabel: 'Winner SF-2',
      kickoffAt: new Date('2026-07-19T22:00:00+03:00').toISOString(),
      points:    40,
    },
  ]

  let created = 0, skipped = 0
  for (const f of fixtures) {
    const existing = await prisma.cupFixture.findUnique({ where: { id: f.id } })
    if (existing) { skipped++; continue }
    await prisma.cupFixture.create({
      data: {
        id:        f.id,
        round:     f.round,
        homeTeam:  null,
        awayTeam:  null,
        homeLabel: f.homeLabel,
        awayLabel: f.awayLabel,
        kickoffAt: new Date(f.kickoffAt),
        points:    f.points,
      },
    })
    created++
  }
  console.log(`✓ Fixtures: ${created} created, ${skipped} already existed`)
  console.log('Done.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
