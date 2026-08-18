// Seed Bodrum's History & Culture guide entries (§11 of the Bodrum Guide brief).
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/seed-bodrum-guide-history.ts
// DRY_RUN=1 prints the plan without writing.
//
// WHY ONLY THESE SIX. Everything else in the brief — which bay to swim in, which
// fish place in Gümüşlük, which beach club is worth it — is local knowledge, and
// a guide whose promise is "from people who actually know Bodrum" cannot have it
// invented by a machine. These six are matters of public record: the castle, the
// museum inside it, the Mausoleum site, the ancient theatre, Pedasa and the Zeki
// Müren house are where they are regardless of taste.
//
// EVERY ENTRY LANDS AS A DRAFT, with `take` deliberately EMPTY. The Smileys Take
// is the opinion that separates this from tourist copy; it needs a human who has
// stood there. Nothing appears on /guide until someone writes it and publishes
// in /admin/guide.
//
// Idempotent: keyed on (cityId, kind, slug) — an existing row is left alone, so
// re-running never overwrites an editor's work.
import { prisma } from '@/lib/prisma'

const DRY_RUN = process.env.DRY_RUN === '1'

// collection/moods/seasons use Bodrum's own vocabulary from lib/guide.ts.
// Seasons are left empty unless the entry's own note justifies one — a castle is
// a castle in February. Only Pedasa earns a tag: it's an exposed hilltop walk.
const ENTRIES = [
  {
    slug: 'bodrum-castle',
    title: 'Bodrum Castle & the old town',
    emoji: '🏰',
    tagline: 'The Knights’ castle on the harbour, and the streets behind it.',
    collection: 'history',
    moods: ['history', 'peninsula'],
    cost: '₺',
    time: '2–3 hours',
    when: 'Morning, before the heat',
    neighborhoods: ['Bodrum Merkez'],
    firstTime: true,
    why: 'The Castle of St Peter has stood over the harbour since the fifteenth century, built by the Knights Hospitaller partly from the stones of the Mausoleum up the hill. It is the one building that explains the shape of the town around it.',
    sections: [
      { title: 'Good to know', items: ['Closed one day a week — check before you go.', 'Stone ramps and steps throughout; the harbour views are worth the climb.'] },
    ],
  },
  {
    slug: 'museum-underwater-archaeology',
    title: 'Museum of Underwater Archaeology',
    emoji: '🏺',
    tagline: 'Bronze Age shipwrecks, raised from the sea and rebuilt inside the castle.',
    collection: 'history',
    moods: ['history'],
    cost: '₺',
    time: '1–2 hours',
    when: 'Pair it with the castle — it is inside',
    neighborhoods: ['Bodrum Merkez'],
    firstTime: false,
    why: 'One of the most significant collections of ancient shipwreck finds anywhere, including the Uluburun wreck — a Bronze Age trading ship that sank off this coast over three thousand years ago. It sits inside the castle walls, so one ticket covers the pair.',
    sections: [
      { title: 'Good to know', items: ['Individual halls keep their own hours; some open only part of the day.'] },
    ],
  },
  {
    slug: 'mausoleum-halicarnassus',
    title: 'The Mausoleum at Halicarnassus',
    emoji: '🏛️',
    tagline: 'One of the seven wonders — and the reason the word exists.',
    collection: 'history',
    moods: ['history'],
    cost: '₺',
    time: '45 minutes',
    when: 'Morning or late afternoon',
    neighborhoods: ['Bodrum Merkez'],
    firstTime: false,
    why: 'The tomb of Mausolus was one of the seven wonders of the ancient world, and gave every mausoleum since its name. What survives is a foundation and scattered fragments rather than a monument — worth going for what it was, with that expectation set.',
    sections: [
      { title: 'Good to know', items: ['A site rather than a building — read a little first and it repays the visit.'] },
    ],
  },
  {
    slug: 'ancient-theatre-bodrum',
    title: 'The Ancient Theatre',
    emoji: '🎭',
    tagline: 'A Hellenistic theatre on the hillside, looking down over the town.',
    collection: 'history',
    moods: ['history', 'sunset'],
    cost: 'Free-ish',
    time: '1 hour',
    when: 'Late afternoon for the light',
    neighborhoods: ['Bodrum Merkez'],
    firstTime: false,
    why: 'Cut into the hillside above town, the theatre held thousands and still faces the harbour it was built to overlook. The view from the upper rows is the clearest picture of Bodrum’s geography you can get on foot.',
    sections: [
      { title: 'Good to know', items: ['On the main road above town; little shade on the seating.'] },
    ],
  },
  {
    slug: 'pedasa-ancient-site',
    title: 'Pedasa',
    emoji: '⛰️',
    tagline: 'A Lelegian hill settlement above the peninsula, reached on foot.',
    collection: 'hidden',
    moods: ['history', 'escape'],
    cost: 'Free',
    time: 'Half a day with the walk',
    when: 'Spring and autumn — not midsummer',
    seasons: ['spring', 'autumn'],
    neighborhoods: ['Konacık'],
    firstTime: false,
    why: 'One of the oldest settlements on the peninsula, pre-dating Greek Halicarnassus, on a hilltop with walls, cisterns and a long view. It is a walk-up site rather than a monument, which is most of its appeal.',
    sections: [
      { title: 'Good to know', items: ['Proper shoes and water; the last stretch is a trail, not a path.', 'Little to no shade — avoid the middle of a summer day.'] },
    ],
  },
  {
    slug: 'zeki-muren-museum',
    title: 'Zeki Müren Arts Museum',
    emoji: '🎼',
    tagline: 'The house of Türkiye’s most beloved singer, kept as he left it.',
    collection: 'history',
    // 'different' is Istanbul's vocabulary — Bodrum has no such mood, so the
    // chip would never match. 'people' is the honest one: this museum explains
    // the town's place in Turkish cultural life.
    moods: ['history', 'people'],
    cost: '₺',
    time: '45 minutes',
    when: 'Any time it is open',
    neighborhoods: ['Bodrum Merkez'],
    firstTime: false,
    why: 'Zeki Müren spent his last years in Bodrum, and his house is now a museum of his stage costumes, piano and belongings. It explains something about the town’s place in Turkish cultural life that no ruin can.',
    sections: [
      { title: 'Good to know', items: ['Small house museum — an hour is plenty.'] },
    ],
  },
]

async function main() {
  const city = await prisma.city.findUnique({ where: { slug: 'bodrum' }, select: { id: true, name: true } })
  if (!city) {
    console.error('✗ no bodrum city row')
    process.exit(1)
  }

  console.log(`→ ${ENTRIES.length} history entries for ${city.name}${DRY_RUN ? '  (DRY RUN)' : ''}`)
  let created = 0, skipped = 0

  for (const [i, e] of ENTRIES.entries()) {
    const existing = await prisma.guideEntry.findUnique({
      where:  { cityId_kind_slug: { cityId: city.id, kind: 'experience', slug: e.slug } },
      select: { id: true, status: true },
    })
    if (existing) {
      console.log(`   skip    ${e.slug} (exists, ${existing.status})`)
      skipped++
      continue
    }
    console.log(`   create  ${e.slug}  [draft, take empty]`)
    created++
    if (!DRY_RUN) {
      await prisma.guideEntry.create({
        data: {
          cityId: city.id,
          kind:   'experience',
          slug:   e.slug,
          title:  e.title,
          emoji:  e.emoji,
          tagline: e.tagline,
          collection: e.collection,
          moods:  e.moods,
          cost:   e.cost,
          time:   e.time,
          when:   e.when,
          neighborhoods: e.neighborhoods,
          seasons: 'seasons' in e ? (e as { seasons: string[] }).seasons : [],
          firstTime: e.firstTime,
          // take: '' on purpose — a human writes the opinion before this goes live.
          content: { why: e.why, take: '', sections: e.sections },
          status: 'draft',
          sortOrder: 100 + i,
        },
      })
    }
  }

  console.log(`\n${DRY_RUN ? `✓ dry run — ${created} would be created` : `✓ ${created} created`}, ${skipped} already present`)
  console.log('  Next: write The Smileys Take for each in /admin/guide, then publish.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
