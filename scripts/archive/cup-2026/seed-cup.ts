// Smileys Cup 2026 — fixture seed.
//
// Run on every deploy via deploy.sh — idempotent. The cup lives at
// /cup as a standalone page (no parent Club), so this script only
// touches CupFixture rows:
//   1. Seed the 12 × 6 = 72 group-stage fixtures (real teams from
//      the Dec 5 2025 draw, standard MD1–MD3 rotation)
//   2. Seed the 31 knockout placeholders (R32 → Final with TBD
//      labels — admin fills in country codes as group play resolves)
//
// Schedule notes:
//   - Group MD1: Jun 11–17 (matchday 1 spread over a week, two
//     matches per group separated by ~3 hours)
//   - Group MD2: Jun 18–23
//   - Group MD3: Jun 24–25 (last two simultaneous per FIFA standard)
//   - R32: Jun 27 – Jul 1
//   - R16: Jul 4 – 7
//   - QF:  Jul 9 – 12
//   - SF:  Jul 15 – 16
//   - Final: Jul 19
// Times below are placeholders aligned to common kickoff slots in
// Istanbul (UTC+3). FIFA-confirmed exact times can be edited
// per-fixture in /admin/cup later.

import { prisma } from '@/lib/prisma'
import { CUP_GROUPS, ROUND_POINTS } from '@/lib/cup'

async function main() {
  // ── Campaign — the world-cup-2026 row + backfill ──────────────
  // Every Sponsor/Prize/Donation belongs to a Campaign. The cup
  // is the first one. Idempotent: upsert by slug, then sweep any
  // pre-existing prize/sponsor/donation rows with NULL campaignId
  // into this campaign.
  const cupCampaign = await prisma.campaign.upsert({
    where:  { slug: 'world-cup-2026' },
    create: {
      slug:       'world-cup-2026',
      name:       'Smileys World Cup 2026',
      emoji:      '⚽',
      tagline:    'Predict every match. Win prizes.',
      description: 'Predictions, sponsored prizes, and bragging rights. Open to every approved Smileys member. Jun 11 → Jul 19.',
      status:     'active',
      startsAt:   new Date('2026-06-11T19:00:00+03:00'),
      endsAt:     new Date('2026-07-19T22:00:00+03:00'),
      routeSlug:  'cup',
      hasFixtures: true,
    },
    // Idempotent backfill: only sets fields the admin couldn't have
    // changed (hasFixtures is a "this campaign has a fixtures admin
    // surface" structural flag, not editorial copy). Existing copy
    // — name, emoji, tagline, description — is left intact.
    update: { hasFixtures: true },
    select: { id: true, slug: true },
  })
  console.log(`✓ Campaign: ${cupCampaign.slug} (${cupCampaign.id})`)

  const [sweptSponsors, sweptPrizes, sweptDonations] = await Promise.all([
    prisma.cupSponsor.updateMany({         where: { campaignId: null }, data: { campaignId: cupCampaign.id } }),
    prisma.cupPrize.updateMany({           where: { campaignId: null }, data: { campaignId: cupCampaign.id } }),
    prisma.cupPrizeDonation.updateMany({   where: { campaignId: null }, data: { campaignId: cupCampaign.id } }),
  ])
  if (sweptSponsors.count || sweptPrizes.count || sweptDonations.count) {
    console.log(`✓ Backfilled campaignId: ${sweptSponsors.count} sponsors · ${sweptPrizes.count} prizes · ${sweptDonations.count} donations`)
  }

  // ── Group-stage fixtures (72) ─────────────────────────────────
  // Standard rotation per group:
  //   MD1: T1×T2, T3×T4
  //   MD2: T1×T3, T2×T4
  //   MD3: T1×T4, T2×T3   (simultaneous per FIFA standard)
  // T1..T4 follow the seed order in CUP_GROUPS (pot 1 → pot 4).
  type FixtureSeed = {
    id: string; round: 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'final'
    group?: string
    homeTeam?: string; awayTeam?: string
    homeLabel?: string; awayLabel?: string
    kickoffAt: string; points: number
  }
  const fixtures: FixtureSeed[] = []

  const groupLetters = Object.keys(CUP_GROUPS).sort()
  const PAIRINGS: [number, number][][] = [
    [[0, 1], [2, 3]],  // MD1
    [[0, 2], [1, 3]],  // MD2
    [[0, 3], [1, 2]],  // MD3 (simultaneous)
  ]

  // MD1 spans Jun 11–17 (12 groups × 2 matches = 24 matches; ~3-4 per day).
  // MD2 spans Jun 18–23. MD3 fits Jun 24–25.
  const MD_WINDOWS: { start: string; days: number; baseHour: number; spacingMin: number }[] = [
    { start: '2026-06-11', days: 7, baseHour: 21, spacingMin: 180 }, // MD1 — Istanbul 21:00 + 3h slots
    { start: '2026-06-18', days: 6, baseHour: 21, spacingMin: 180 }, // MD2
    { start: '2026-06-24', days: 2, baseHour: 21, spacingMin: 180 }, // MD3 — last 2 simultaneous
  ]

  // One day in milliseconds — used to advance day-by-day inside a
  // matchday window without doing month/year arithmetic ourselves.
  const DAY_MS = 24 * 60 * 60 * 1000

  for (let md = 0; md < 3; md++) {
    const window = MD_WINDOWS[md]
    const start = new Date(`${window.start}T${String(window.baseHour).padStart(2, '0')}:00:00+03:00`)
    let matchIndex = 0
    // Iterate by pairing slot then by group so MD1's "A1×A2" lands
    // before "A3×A4", giving a more natural ordering on the page.
    // For each match, decide which day of the window it falls on
    // (24 matches spread across `window.days` days) and then offset
    // within that day by spacingMin minutes per slot. All arithmetic
    // in milliseconds so the resulting Date is always valid.
    const matchesPerDay = Math.ceil(24 / window.days)
    for (const pairing of PAIRINGS[md]) {
      for (const letter of groupLetters) {
        const teams = CUP_GROUPS[letter]
        const home  = teams[pairing[0]]
        const away  = teams[pairing[1]]
        const dayIndex = Math.floor(matchIndex / matchesPerDay)
        const slotInDay = matchIndex % matchesPerDay
        const offset = dayIndex * DAY_MS + slotInDay * window.spacingMin * 60 * 1000
        const kickoffAt = new Date(start.getTime() + offset).toISOString()
        fixtures.push({
          id:        `2026-WC-G-${letter}-MD${md + 1}-${pairing[0] + 1}v${pairing[1] + 1}`,
          round:     'group',
          group:     letter,
          homeTeam:  home,
          awayTeam:  away,
          kickoffAt,
          points:    ROUND_POINTS.group,
        })
        matchIndex++
      }
    }
  }

  // ── Knockout placeholders (31) ────────────────────────────────
  // R32 = 16, R16 = 8, QF = 4, SF = 2, Final = 1. Labels use the
  // standard bracket map; admin can edit them and fill in homeTeam/
  // awayTeam in /admin/cup once group standings firm up.
  for (let i = 0; i < 16; i++) {
    // 4 slots/day × 4 days. Hours 15, 17, 19, 21 — the previous
    // formula (15, 18, 21, 24) overflowed at slot 3 (hour 24 is
    // not a valid ISO time) which broke the seed.
    const day  = 27 + Math.floor(i / 4)
    const hour = 15 + (i % 4) * 2
    fixtures.push({
      id:        `2026-WC-R32-${i + 1}`,
      round:     'r32',
      homeLabel: `R32 ${String.fromCharCode(65 + (i * 2) % 12)} winner`,
      awayLabel: `R32 ${String.fromCharCode(65 + (i * 2 + 1) % 12)} runner-up`,
      kickoffAt: new Date(`2026-06-${day}T${String(hour).padStart(2, '0')}:00:00+03:00`).toISOString(),
      points:    ROUND_POINTS.r32,
    })
  }
  // Helper: pad both day and hour. ISO 8601 strict-mode parsers
  // reject "2026-07-4" — the day component must be two digits.
  const pad2 = (n: number) => String(n).padStart(2, '0')
  for (let i = 0; i < 8; i++) {
    const day  = 4 + Math.floor(i / 2)
    const hour = 17 + (i % 2) * 4
    fixtures.push({
      id:        `2026-WC-R16-${i + 1}`,
      round:     'r16',
      homeLabel: `Winner R32-${i * 2 + 1}`,
      awayLabel: `Winner R32-${i * 2 + 2}`,
      kickoffAt: new Date(`2026-07-${pad2(day)}T${pad2(hour)}:00:00+03:00`).toISOString(),
      points:    ROUND_POINTS.r16,
    })
  }
  for (let i = 0; i < 4; i++) {
    const day = 9 + i
    fixtures.push({
      id:        `2026-WC-QF-${i + 1}`,
      round:     'qf',
      homeLabel: `Winner R16-${i * 2 + 1}`,
      awayLabel: `Winner R16-${i * 2 + 2}`,
      kickoffAt: new Date(`2026-07-${pad2(day)}T20:00:00+03:00`).toISOString(),
      points:    ROUND_POINTS.qf,
    })
  }
  fixtures.push({
    id: '2026-WC-SF-1', round: 'sf',
    homeLabel: 'Winner QF-1', awayLabel: 'Winner QF-2',
    kickoffAt: new Date('2026-07-15T21:00:00+03:00').toISOString(),
    points: ROUND_POINTS.sf,
  })
  fixtures.push({
    id: '2026-WC-SF-2', round: 'sf',
    homeLabel: 'Winner QF-3', awayLabel: 'Winner QF-4',
    kickoffAt: new Date('2026-07-16T21:00:00+03:00').toISOString(),
    points: ROUND_POINTS.sf,
  })
  fixtures.push({
    id: '2026-WC-FINAL', round: 'final',
    homeLabel: 'Winner SF-1', awayLabel: 'Winner SF-2',
    kickoffAt: new Date('2026-07-19T22:00:00+03:00').toISOString(),
    points: ROUND_POINTS.final,
  })

  let created = 0, skipped = 0
  for (const f of fixtures) {
    const existing = await prisma.cupFixture.findUnique({ where: { id: f.id } })
    if (existing) { skipped++; continue }
    await prisma.cupFixture.create({
      data: {
        id:        f.id,
        round:     f.round,
        group:     f.group ?? null,
        homeTeam:  f.homeTeam ?? null,
        awayTeam:  f.awayTeam ?? null,
        homeLabel: f.homeLabel ?? null,
        awayLabel: f.awayLabel ?? null,
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
