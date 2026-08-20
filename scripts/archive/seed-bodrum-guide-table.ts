// Bodrum's two remaining shelves — §8 Taste Bodrum, §9 Bodrum After Dark.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/seed-bodrum-guide-table.ts
// DRY_RUN=1 prints the plan without writing.
//
// THE HARD PART, stated plainly. Food and nightlife are the two subjects that
// most want a name attached, and a name is the one thing this file must not
// invent: which fish place in Gümüşlük, which beach club is worth it, which
// meyhane the locals actually use. Get that wrong and the guide is worse than
// empty — it sends people somewhere on false authority.
//
// So these describe FORMS rather than venues: what a long fish dinner by the
// water is, what a meze table is for, what the marina does after dark, what
// Bar Street actually is. Places named are streets and neighborhoods from
// Bodrum's own registry, never businesses. Each Take says what to expect,
// including when the honest answer is "this is the touristy one".
//
// Written at Nate's request, after the limit was flagged. A Bodrum host adding
// three restaurant names to these entries turns them from decent into the thing
// the guide promises.
import { prisma } from '@/lib/prisma'

const DRY_RUN = process.env.DRY_RUN === '1'

const ENTRIES = [
  // ── §8 Taste Bodrum ──────────────────────────────────────────────────────
  {
    slug: 'a-long-fish-dinner-by-the-water',
    title: 'A long fish dinner by the water',
    emoji: '🐟',
    tagline: 'Tables at the waterline, one fish, and no hurry.',
    collection: 'eat',
    moods: ['eat', 'sunset'],
    seasons: [],
    cost: '₺₺₺',
    time: 'A whole evening',
    when: 'Book the sunset slot',
    neighborhoods: ['Gümüşlük', 'Bodrum Merkez'],
    firstTime: true,
    why: 'The Aegean fish dinner is a form: cold meze first, then one fish for the table, then fruit, spread across hours rather than courses. Gümüşlük built its reputation on doing it with tables almost in the water.',
    take: "Order the meze slowly and one fish between two — the mistake is filling up before the fish arrives. Ask what came in that day rather than reading down the menu; the answer changes the price and the meal. Sunset seats go first, so the call is worth making in the morning.",
    sections: [
      { title: 'Good to know', items: [
        'Fish is usually sold by weight — ask the price before it goes on the grill.',
        'Peak summer needs a booking for anything at the waterline.',
      ] },
    ],
  },
  {
    slug: 'a-proper-aegean-breakfast',
    title: 'A proper Aegean breakfast',
    emoji: '🍅',
    tagline: 'The spread, with the herbs and olive oil this coast is actually known for.',
    collection: 'eat',
    moods: ['eat', 'escape'],
    seasons: [],
    cost: '₺₺',
    time: '2 hours',
    when: 'Late morning, and never alone',
    neighborhoods: ['Bitez', 'Ortakent', 'Yalıçiftlik'],
    firstTime: true,
    why: 'Turkish breakfast on the Aegean leans on what grows here: olives and olive oil, wild herbs, tomatoes, village cheeses, gözleme cooked in front of you. Inland and in the villages it is a slower, cheaper and better version of the same thing you get on the front.',
    take: "Go inland for this. The breakfast places away from the water are where the herbs and the oil are local rather than ordered in, and you will pay half. Go with people and order for the table — a Turkish breakfast for one is a sad, expensive plate.",
    sections: [
      { title: 'Good to know', items: [
        'It is a two-hour institution, not a quick stop.',
        'Unlimited tea is normal; ask before assuming it is charged per glass.',
      ] },
    ],
  },
  {
    slug: 'meze-and-raki-in-town',
    title: 'A meze table and a bottle of rakı',
    emoji: '🫒',
    tagline: 'The Turkish evening that is a conversation, not a meal.',
    collection: 'eat',
    moods: ['eat', 'people'],
    seasons: [],
    cost: '₺₺',
    time: 'Four hours, minimum',
    when: 'Evening, any season',
    neighborhoods: ['Bodrum Merkez', 'Turgutreis'],
    firstTime: false,
    why: 'A meyhane night is a Turkish institution: a table of cold meze, rakı with water, and hours of talking. It is the same ritual in Bodrum as in Istanbul, with more sea in the meze.',
    take: "Pace yourself on the cold meze — the tray is the opening argument, not the menu. Rakı is drunk slowly, with water and food, across a whole evening; treating it as a shot is how a good night ends early. This is the single easiest way to spend an evening with people rather than beside them.",
    sections: [
      { title: 'Good to know', items: [
        'Meze arrive on a tray to choose from — you are picking, not ordering blind.',
        'The bill is usually per meze, so a big tray adds up faster than it looks.',
      ] },
    ],
  },

  // ── §9 Bodrum After Dark ─────────────────────────────────────────────────
  {
    slug: 'the-marina-after-dark',
    title: 'The marina after dark',
    emoji: '🌙',
    tagline: 'Boats lit up, the castle behind, and a walk that costs nothing.',
    collection: 'night',
    moods: ['night-out', 'sunset', 'people'],
    seasons: [],
    cost: 'Free',
    time: '1–2 hours',
    when: 'After sunset, any season',
    neighborhoods: ['Bodrum Merkez', 'Yalıkavak'],
    firstTime: true,
    why: 'Both marinas turn into an evening promenade once the heat drops: gulets and yachts lit along the quay, the castle floodlit above the town harbour, and everyone out walking. Yalıkavak is the glossier one, Bodrum town the older.',
    take: "Do this before you decide Bodrum nightlife is not for you — it is the version that costs nothing and includes everybody. Walk the full quay rather than sitting at the first table: the character changes completely from one end to the other.",
    sections: [
      { title: 'Good to know', items: ['Waterfront tables carry a waterfront price; the walk itself is free.'] },
    ],
  },
  {
    slug: 'bar-street-once',
    title: 'Bar Street, once',
    emoji: '🍸',
    tagline: 'Bodrum’s loudest hundred metres — worth seeing, once.',
    collection: 'night',
    moods: ['night-out', 'people'],
    seasons: ['summer'],
    cost: '₺₺',
    time: 'A night',
    when: 'Summer, and late',
    neighborhoods: ['Bodrum Merkez', 'Gümbet'],
    firstTime: false,
    why: 'Bodrum town’s Cumhuriyet Caddesi — Bar Street — is a strip of bars and clubs along the eastern bay, and it is the thing most people mean when they say Bodrum nightlife. It is loud, packed in season, and unapologetically for visitors.',
    take: "Go once, knowing exactly what it is: a tourist strip, at tourist prices, with the music competing bar to bar. Seeing it is part of seeing Bodrum. Then find out where people who live here go instead — that is a better night and nobody can tell you it from a page.",
    sections: [
      { title: 'Good to know', items: [
        'It is seasonal — out of summer much of the strip is shut.',
        'Check prices before ordering; they climb with the season.',
      ] },
    ],
  },
  {
    slug: 'a-beach-club-evening',
    title: 'An evening that starts on a sunbed',
    emoji: '🥂',
    tagline: 'The beach club day that slides into the night without moving.',
    collection: 'night',
    moods: ['night-out', 'beach', 'summer'],
    seasons: ['summer'],
    cost: '₺₺₺',
    time: 'Afternoon into the night',
    when: 'High summer',
    neighborhoods: ['Türkbükü', 'Gümbet'],
    firstTime: false,
    why: 'The peninsula’s beach clubs run on one continuous arc: swim in the afternoon, stay through sunset, and the same place becomes the evening. Türkbükü made its name on it; Gümbet does a younger, cheaper version.',
    take: "Know what you are buying: the sunbed is the ticket, and the minimum spend is the real price. It is genuinely good if you commit to the whole arc — turning up at eleven at night for a bed you paid for at noon is the point. If that sounds like an expensive way to sit down, it is, and the bays with no road to them are free.",
    sections: [
      { title: 'Good to know', items: [
        'Minimum spends and sunbed fees are normal — ask both before settling in.',
        'Weekends in August are a different, busier animal to a Tuesday in June.',
      ] },
    ],
  },
]

async function main() {
  const city = await prisma.city.findUnique({ where: { slug: 'bodrum' }, select: { id: true, name: true } })
  if (!city) { console.error('✗ no bodrum city row'); process.exit(1) }

  console.log(`→ ${ENTRIES.length} entries for ${city.name}${DRY_RUN ? '  (DRY RUN)' : ''}`)
  let created = 0, skipped = 0

  for (const [i, e] of ENTRIES.entries()) {
    const existing = await prisma.guideEntry.findUnique({
      where:  { cityId_kind_slug: { cityId: city.id, kind: 'experience', slug: e.slug } },
      select: { id: true, status: true },
    })
    if (existing) { console.log(`   skip    ${e.slug} (exists, ${existing.status})`); skipped++; continue }
    console.log(`   create  ${e.slug}  [${e.collection}] draft`)
    created++
    if (!DRY_RUN) {
      await prisma.guideEntry.create({
        data: {
          cityId: city.id, kind: 'experience', slug: e.slug, title: e.title, emoji: e.emoji,
          tagline: e.tagline, collection: e.collection, moods: e.moods, seasons: e.seasons,
          cost: e.cost, time: e.time, when: e.when, neighborhoods: e.neighborhoods,
          firstTime: e.firstTime,
          content: { why: e.why, take: e.take, sections: e.sections },
          status: 'draft', sortOrder: 20 + i,
        },
      })
    }
  }
  console.log(`\n${DRY_RUN ? `✓ dry run — ${created} would be created` : `✓ ${created} created`}, ${skipped} already present`)
  console.log('  Drafts. Review in /admin/guide-entries, then publish.')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
