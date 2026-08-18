// Fill The Smileys Take on Bodrum's six seeded history entries.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/write-bodrum-takes.ts
// DRY_RUN=1 prints without writing.
//
// PROVENANCE, because it matters for this field specifically: these are drafted
// from the public record — what each site is, what survives of it, how the light
// and the heat work, what the museum holds. They are opinions about how to
// approach a visit, not insider knowledge. Nobody who wrote them has stood on
// the hill at Pedasa. They name no restaurant, no boat, no beach club and no
// price, because that is exactly the kind of detail this file has no business
// inventing.
//
// Treat them as a first pass for a Bodrum host to correct. Entries stay DRAFT:
// writing the Take makes publishing possible, it doesn't make the decision.
//
// Guarded per row on an empty take, so a human edit is never overwritten and a
// re-run is a no-op.
import { prisma } from '@/lib/prisma'

const DRY_RUN = process.env.DRY_RUN === '1'

const TAKES: Record<string, string> = {
  'bodrum-castle':
    "Go early — before the cruise groups and before the stone starts throwing heat back at you. The castle is why the town looks the way it does: the Knights quarried the Mausoleum up the hill to build it, so you're walking around the tomb's afterlife. Leave time for the streets behind the harbour afterwards. That's where the town stops performing.",

  'museum-underwater-archaeology':
    "The rare museum that earns a second hour. The Uluburun ship went down off this coast carrying copper, glass and ivory more than three thousand years ago, and seeing the hold rebuilt does something no caption manages. Individual halls keep their own hours, so ask what's open when you buy the ticket rather than discovering it at a locked door.",

  'mausoleum-halicarnassus':
    "Know what you're walking into: a foundation, some fragments and a quiet garden. The wonder itself was pulled apart centuries ago and much of it is in the castle down the hill. Go anyway — but go for the idea, and read one paragraph about Mausolus first. Twenty minutes with context beats an hour without it.",

  'ancient-theatre-bodrum':
    "Come late in the day. It faces the harbour, so the light does the work and the seating has stopped radiating heat. Climb to the top row before you settle anywhere — from up there the peninsula's geography finally makes sense: the bays, the castle, the sea past both.",

  'pedasa-ancient-site':
    "This is a walk with ruins at the end, not a monument with a car park. Proper shoes, more water than you think, and not in August. What you get for it is the oldest thing on the peninsula and, most days, nobody else up there.",

  'zeki-muren-museum':
    "If the name means nothing to you, that's the reason to go. An hour in this house explains more about modern Turkish life than any ruin on the peninsula — it's kept much as he left it, and it's small enough that an hour is genuinely enough. Put something of his on for the walk over.",
}

async function main() {
  const city = await prisma.city.findUnique({ where: { slug: 'bodrum' }, select: { id: true } })
  if (!city) { console.error('✗ no bodrum city row'); process.exit(1) }

  let written = 0, skipped = 0
  for (const [slug, take] of Object.entries(TAKES)) {
    const row = await prisma.guideEntry.findUnique({
      where:  { cityId_kind_slug: { cityId: city.id, kind: 'experience', slug } },
      select: { id: true, status: true, content: true },
    })
    if (!row) { console.log(`   missing  ${slug}`); continue }

    const content = (row.content ?? {}) as Record<string, unknown>
    if (String(content.take ?? '').trim()) { console.log(`   skip     ${slug} (already has a take)`); skipped++; continue }

    console.log(`   write    ${slug}`)
    console.log(`            "${take.slice(0, 96)}…"`)
    written++
    if (!DRY_RUN) {
      await prisma.guideEntry.updateMany({
        // Guarded: only while the take is still empty.
        where: { id: row.id },
        data:  { content: { ...content, take } },
      })
    }
  }
  console.log(`\n${DRY_RUN ? `✓ dry run — ${written} would be written` : `✓ ${written} written`}, ${skipped} left alone`)
  console.log('  Entries remain DRAFT. Review in /admin/guide-entries and publish there.')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
