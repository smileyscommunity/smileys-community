// One-off seed: five international restaurants across cuisines not
// already covered by the Indian / Chinese / Thai / Italian seeds.
// Five distinct kitchens: Japanese, Mexican, Lebanese, Vietnamese,
// Korean — spreading both sides of the Bosphorus.
//
// Same shape as the other directory seed scripts. Idempotent on
// `name`. Run on prod:
//   ssh root@<server> 'cd /root/smileys-community && \
//     DATABASE_URL=$(grep ^DATABASE_URL .env | sed "s/^DATABASE_URL=//" | tr -d "\"") \
//     npx tsx scripts/seed-directory-international.ts'

import { prisma } from '@/lib/prisma'
import { getDefaultCityId } from '@/lib/city'

const ADMIN_EMAIL = ''

const ENTRIES: {
  name: string
  description: string
  neighborhood: string | null
  languages?: string | null
  isExpatFriendly?: boolean
  isExpatOwned?: boolean
}[] = [
  {
    name: 'Sushiko',
    description:
      'Nişantaşı sushi bar known for fresh nigiri, sashimi sets, and a strong omakase option. Walk-ins possible for the bar; reserve for the dining room. English-speaking staff.',
    neighborhood: 'Nişantaşı',
    languages: 'English, Turkish, Japanese',
    isExpatFriendly: true,
  },
  {
    name: 'Maya Cocina Mexicana',
    description:
      'Cihangir hangout serving tacos al pastor, mole, fresh guacamole, and proper margaritas. Late-night kitchen on weekends; popular for birthdays and casual group dinners.',
    neighborhood: 'Cihangir',
    languages: 'English, Turkish, Spanish',
    isExpatFriendly: true,
  },
  {
    name: 'Beirut Levantine',
    description:
      'Family-run Lebanese in Şişli with a generous mezze spread — hummus, muhammara, tabbouleh — plus grilled meats and shawarma. Halal kitchen, vegetarian-friendly menu.',
    neighborhood: 'Şişli',
    languages: 'English, Turkish, Arabic',
    isExpatFriendly: true,
  },
  {
    name: 'Saigon Hanoi',
    description:
      'Asian-side Vietnamese restaurant in Kadıköy specialising in pho, bun cha, and summer rolls. Small dining room, reasonable lunch prices, English menu.',
    neighborhood: 'Kadıköy',
    languages: 'English, Turkish, Vietnamese',
    isExpatFriendly: true,
  },
  {
    name: 'Seoul Garden',
    description:
      'Korean BBQ in Mecidiyeköy with table grills, banchan spread, and bibimbap done well. Group-friendly seating, late-night kitchen, popular with Istanbul\'s Korean community.',
    neighborhood: 'Mecidiyeköy',
    languages: 'English, Turkish, Korean',
    isExpatFriendly: true,
  },
]

async function main() {
  const admin = ADMIN_EMAIL
    ? await prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { id: true, name: true, email: true } })
    : await prisma.user.findFirst({
        where:  { role: 'admin' },
        select: { id: true, name: true, email: true },
      })
  if (!admin) {
    console.error('✗ No admin user found. Set ADMIN_EMAIL or create an admin first.')
    process.exit(1)
  }
  console.log(`→ Seeding as ${admin.name} <${admin.email}>`)

  // Every business carries a city (multi-city phase 1). These seeds are all
  // Istanbul venues, so the default city is the right one.
  const cityId = await getDefaultCityId()

  let created = 0
  let skipped = 0
  for (const e of ENTRIES) {
    const exists = await prisma.business.findFirst({ where: { name: e.name } })
    if (exists) {
      console.log(`· Skipping "${e.name}" (already exists)`)
      skipped++
      continue
    }
    await prisma.business.create({
      data: {
        cityId,
        name:            e.name,
        category:        'Restaurant',
        description:     e.description,
        neighborhood:    e.neighborhood,
        languages:       e.languages ?? null,
        isExpatOwned:    !!e.isExpatOwned,
        isExpatFriendly: !!e.isExpatFriendly,
        submittedById:   admin.id,
        reviewedById:    admin.id,
        reviewedAt:      new Date(),
        isApproved:      true,
        isActive:        true,
      },
    })
    console.log(`✓ Added "${e.name}" (${e.neighborhood ?? '—'})`)
    created++
  }

  console.log(`\nDone. ${created} added, ${skipped} skipped.`)
  console.log('Verify entries at /admin/directory?status=approved before broadly promoting them.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
