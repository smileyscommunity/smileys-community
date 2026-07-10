/**
 * One-off: create 5 regional "Culture" clubs. Mirrors the admin club-create
 * route (lib fields: category, amber color/bg, city, memberCount 0, no side
 * effects). Idempotent — skips any slug that already exists.
 *
 * Run (server, both env files):
 *   DRY_RUN=true  npx tsx --env-file=.env --env-file=.env.local scripts/create-culture-clubs.ts
 *   DRY_RUN=false npx tsx --env-file=.env --env-file=.env.local scripts/create-culture-clubs.ts
 */
import { prisma } from '@/lib/prisma'
import { slugify } from '@/lib/slug'

const DRY_RUN = process.env.DRY_RUN !== 'false'

// Emojis chosen to evoke each region without picking a single-nation flag
// (these are multi-country clusters). Trivial to change afterwards.
const CLUBS = [
  { name: 'Scandinavian Culture',     emoji: '🌲', description: 'Hygge, fika, midsommar and the Nordic way of life. Bringing together Swedes, Danes, Norwegians, Finns and everyone obsessed with Nordic design and minimalism.' },
  { name: 'Balkan Culture',           emoji: '🏔️', description: 'The closest neighbors — Greece, Serbia, Bulgaria, Croatia, Bosnia and beyond. Rakı nights, folk music, incredible food and the shared Ottoman history.' },
  { name: 'Eastern European Culture', emoji: '🪆', description: 'From Poland and Ukraine to Romania and Hungary — rich folklore, hearty cuisine, classical music and strong community ties.' },
  { name: 'Western European Culture', emoji: '🍷', description: 'French, Italian, Spanish, German and British expats and enthusiasts — wine nights, football rivalries, language exchange and café culture.' },
  { name: 'Mediterranean Culture',    emoji: '🫒', description: 'Where Europe meets the sea — Italy, Greece, Spain, Croatia and Turkey itself. Shared love of food, sun, slow living and good conversation.' },
]

async function main() {
  const city = await prisma.city.findFirst({ where: { name: 'Istanbul' }, select: { id: true } })
  if (!city) throw new Error('Istanbul city not found')

  let created = 0
  for (const c of CLUBS) {
    const slug = slugify(c.name)
    const existing = await prisma.club.findUnique({ where: { slug }, select: { id: true } })
    if (existing) { console.log(`SKIP (already exists): ${c.name} [${slug}]`); continue }
    if (DRY_RUN)  { console.log(`WOULD CREATE: ${c.emoji}  ${c.name} [${slug}]  · Culture`); continue }
    const club = await prisma.club.create({
      data: {
        name:        c.name,
        slug,
        description: c.description,
        category:    'Culture',
        emoji:       c.emoji,
        color:       'text-amber-600',
        bgColor:     'bg-amber-50',
        memberCount: 0,
        cityId:      city.id,
      },
    })
    created++
    console.log(`CREATED: ${c.emoji}  ${club.name} [${club.slug}]  id=${club.id}`)
  }
  console.log(DRY_RUN
    ? '\nDRY_RUN — nothing written. Re-run with DRY_RUN=false to create.'
    : `\nDone. Created ${created} club(s).`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
