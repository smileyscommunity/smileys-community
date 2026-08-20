// Bodrum's water experiences — §6 Beaches & Bays, §7 Boat Life, §13 Day Trips.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/seed-bodrum-guide-water.ts
// DRY_RUN=1 prints the plan without writing.
//
// PROVENANCE, same rule as the history entries: these describe the peninsula's
// geography and the shape of a boat day — which bays exist, which are reachable
// only from the water, what a gulet trip is, what Kara Ada is known for. They
// name PLACES (all from Bodrum's own neighborhood registry, plus two islands)
// and never a business: no beach club, no boat operator, no restaurant, no
// price. Those are a local's to add, and getting one wrong is worse than
// leaving it out.
//
// Written at Nate's request. Nobody who wrote them has swum at Bağla. Treat
// every Take as a first draft for a Bodrum host to sharpen or bin.
//
// Drafts, keyed on (cityId, kind, slug) — an existing row is never overwritten.
import { prisma } from '@/lib/prisma'

const DRY_RUN = process.env.DRY_RUN === '1'

const ENTRIES = [
  {
    slug: 'a-beach-day-on-the-peninsula',
    title: 'Pick a bay for the day',
    emoji: '🏖️',
    tagline: 'The peninsula is a chain of bays, and they are not interchangeable.',
    collection: 'beaches',
    moods: ['beach', 'summer', 'peninsula'],
    seasons: ['summer'],
    cost: 'Free-ish',
    time: 'A day',
    when: 'Late May to October',
    neighborhoods: ['Bitez', 'Ortakent', 'Gündoğan'],
    firstTime: true,
    why: 'Bodrum is not one beach but a coastline of separate bays, each with its own water, wind and crowd. Bitez is shallow and calm, Ortakent is a long sandy stretch, Gündoğan is quieter and faces its own bay. Choosing badly is how people decide Bodrum is overrated.',
    take: "Don't default to the bay nearest your bed. Twenty minutes in any direction changes the water, the wind and the crowd completely — ask someone who lives here which bay suits the day's wind before you commit to it.",
    sections: [
      { title: 'Good to know', items: [
        'Afternoon wind is a real factor — some bays are sheltered, some are not.',
        'Sun beds are usually tied to a business; there is public shoreline too.',
      ] },
    ],
  },
  {
    slug: 'swim-in-clear-water',
    title: 'Swim somewhere the water is properly clear',
    emoji: '🤿',
    tagline: 'The west end of the peninsula, where the sea turns glass.',
    collection: 'beaches',
    moods: ['beach', 'escape', 'summer'],
    seasons: ['summer', 'autumn'],
    cost: 'Free-ish',
    time: 'Half a day',
    when: 'June to October',
    neighborhoods: ['Akyarlar', 'Bağla'],
    firstTime: false,
    why: 'The western bays face open water and get the clarity the busier town beaches lose. Akyarlar is known for clear water and wind; Bağla is a set of smaller coves with far fewer people on them.',
    take: 'Bring something to see through — a mask turns a nice swim into an hour. Go early: the same wind that makes this end of the peninsula good for boards makes the surface choppy by mid-afternoon.',
    sections: [
      { title: 'Good to know', items: [
        'Rocky entries in places — shoes you can swim in earn their space in the bag.',
        'The wind is the whole character of this coast. Check it before you drive out.',
      ] },
    ],
  },
  {
    slug: 'a-bay-you-can-only-reach-by-boat',
    title: 'Swim in a bay with no road to it',
    emoji: '⚓',
    tagline: 'The coves that stay empty because you cannot drive to them.',
    collection: 'beaches',
    moods: ['boat', 'beach', 'escape'],
    seasons: ['summer', 'autumn'],
    cost: '₺₺',
    time: 'A day',
    when: 'June to October',
    neighborhoods: [],
    firstTime: false,
    why: 'A good part of the coastline has no road behind it. Those bays are reachable only from the water, which is exactly why they are still quiet in August — the crowd is a function of the car park, and there isn\'t one.',
    take: "This is the single biggest difference between a Bodrum holiday and a Bodrum day. If you do one thing from the water, make it this rather than a busier beach with a better car park.",
    sections: [
      { title: 'Good to know', items: [
        'Take shade and water — an anchored boat has less of both than you expect.',
        'Swim shoes if you plan to land: many of these coves are stone, not sand.',
      ] },
    ],
  },
  {
    slug: 'take-a-boat-into-the-bays',
    title: 'Take a boat into the bays',
    emoji: '⛵',
    tagline: 'The day that makes sense of the whole peninsula.',
    collection: 'boat',
    moods: ['boat', 'summer', 'people'],
    seasons: ['summer', 'autumn'],
    cost: '₺₺',
    time: 'A day',
    when: 'May to October',
    neighborhoods: ['Bodrum Merkez', 'Gümbet'],
    firstTime: true,
    why: 'Bodrum is a gulet town: wooden boats run daily trips out of the harbours, stopping to swim in a series of bays and islands. It is the standard Bodrum day and it deserves its reputation — the coastline reads completely differently from the water.',
    take: "Don't spend a whole trip looking at the sea from the shore. Get on a boat at least once — the best part of Bodrum starts when the coastline disappears behind you. Ask how many stops and how long at each; that, not the boat, is what makes the day.",
    sections: [
      { title: 'Good to know', items: [
        'Shared day trips and private charters both run from the harbours — the difference is the crowd, not the coastline.',
        'Sun on open water is a different animal. Cover up before you think you need to.',
      ] },
    ],
  },
  {
    slug: 'sunset-on-the-water',
    title: 'Sunset from a boat',
    emoji: '🌅',
    tagline: 'The peninsula lights up better from offshore.',
    collection: 'sunset',
    moods: ['boat', 'sunset'],
    seasons: ['summer', 'autumn'],
    cost: '₺₺',
    time: '2–3 hours',
    when: 'Late afternoon, May to October',
    neighborhoods: ['Bodrum Merkez'],
    firstTime: false,
    why: 'Short evening trips leave as the heat drops and put you offshore for the sunset, with the castle and the town on one side and open water on the other. Shorter and cheaper than a full day, and a completely different mood.',
    take: 'Better than a full day trip if you only have one evening — you get the light, the swim and the harbour coming on, without eight hours of sun. Take a layer: the temperature falls fast once the sun goes.',
    sections: [
      { title: 'Good to know', items: ['Departure times shift with the season — sunset moves nearly two hours between June and October.'] },
    ],
  },
  {
    slug: 'kara-ada-hot-springs',
    title: 'Kara Ada and its hot springs',
    emoji: '🏝️',
    tagline: 'The island across the bay, with mud and a thermal spring.',
    collection: 'day-trips',
    moods: ['boat', 'escape'],
    seasons: ['summer', 'autumn'],
    cost: '₺₺',
    time: 'Half a day within a boat trip',
    when: 'May to October',
    neighborhoods: [],
    firstTime: false,
    why: 'Kara Ada — Black Island — sits across the bay from town and is the usual anchor point on Bodrum boat trips, known for its thermal spring and the orange mud people coat themselves in before rinsing off in the sea.',
    take: "Do the mud even if you feel ridiculous — everybody on the boat looks equally ridiculous, which is most of the fun. It's a stop on a trip rather than a destination in itself, so judge the trip by its other bays.",
    sections: [
      { title: 'Good to know', items: ['The mud stains light swimwear. Wear something you do not mind.'] },
    ],
  },
]

async function main() {
  const city = await prisma.city.findUnique({ where: { slug: 'bodrum' }, select: { id: true, name: true } })
  if (!city) { console.error('✗ no bodrum city row'); process.exit(1) }

  console.log(`→ ${ENTRIES.length} water experiences for ${city.name}${DRY_RUN ? '  (DRY RUN)' : ''}`)
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
          status: 'draft', sortOrder: 10 + i,
        },
      })
    }
  }
  console.log(`\n${DRY_RUN ? `✓ dry run — ${created} would be created` : `✓ ${created} created`}, ${skipped} already present`)
  console.log('  Drafts. Review in /admin/guide-entries, then publish.')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
