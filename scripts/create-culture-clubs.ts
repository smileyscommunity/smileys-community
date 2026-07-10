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
  // Americas
  { name: 'Latin American Culture',   emoji: '💃', description: 'Salsa, samba, tacos and telenovelas. Bringing together the energy of Mexico, Brazil, Colombia, Argentina and the whole continent.' },
  { name: 'North American Culture',   emoji: '🍔', description: 'A home base for Americans and Canadians — BBQ nights, Super Bowl watch parties, Thanksgiving dinners and road trip stories.' },
  // Middle East
  { name: 'Middle Eastern Culture',   emoji: '🕌', description: 'Exploring Arab, Persian and broader Middle Eastern traditions — from Lebanese cuisine and Persian poetry to Arabic calligraphy and oud music.' },
  { name: 'Iranian Culture',          emoji: '🌷', description: "Celebrating Persian art, poetry, cuisine and Nowruz. One of Istanbul's largest expat communities deserves its own club." },
  // Africa
  { name: 'North African Culture',    emoji: '🐫', description: 'Exploring the vibrant world of Morocco, Tunisia, Egypt, Algeria and Libya. Music, cuisine, calligraphy, cinema and the stories of the Maghreb.' },
  { name: 'West African Culture',     emoji: '🥁', description: 'From Nigeria and Ghana to Senegal and Ivory Coast — Afrobeats, jollof rice debates, fashion and the most vibrant diaspora on the planet.' },
  { name: 'East African Culture',     emoji: '☕', description: 'Celebrating Ethiopia, Kenya, Tanzania, Somalia and beyond. Coffee ceremonies, Swahili culture, incredible food and music.' },
  { name: 'Southern African Culture', emoji: '🦁', description: "South Africa, Zimbabwe, Mozambique and neighbors — braai nights, jazz, rugby and the Rainbow Nation's incredible diversity." },
  // Asia
  { name: 'East Asian Culture',       emoji: '🏮', description: 'A celebration of Chinese, Japanese and Korean culture — from K-pop and anime to tea ceremonies, calligraphy and dim sum nights.' },
  { name: 'Southeast Asian Culture',  emoji: '🌴', description: 'Bringing together the flavors and traditions of Thailand, Vietnam, Indonesia, Philippines and beyond. Street food nights, language exchange and tropical vibes.' },
  { name: 'Central Asian Culture',    emoji: '🐎', description: 'Discovering the Silk Road — Kazakhstan, Uzbekistan, Kyrgyzstan and Tajikistan. Nomadic traditions, epic landscapes and cuisine that Istanbul already knows well.' },
  // Pacific
  { name: 'Australian & Pacific Culture', emoji: '🏄', description: "For Australians, New Zealanders and Pacific islanders — beach culture, flat whites, Anzac traditions and a laid-back energy that's hard to find in Istanbul." },
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
