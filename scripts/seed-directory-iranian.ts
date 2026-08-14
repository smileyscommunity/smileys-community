// One-off seed: five Iranian / Persian restaurants for the directory.
//
// Adds to the single Persepolis entry already seeded in the previous
// international batch — Istanbul has a substantial Iranian expat
// community (concentrated around Aksaray / Şişli) so a deeper bench
// here is warranted.
//
// Spread: one entry each in Fatih (Aksaray area), Beyoğlu, Taksim,
// Nişantaşı, Mecidiyeköy. Idempotent on `name`.
//
// Run on prod:
//   ssh root@<server> 'cd /root/smileys-community && \
//     DATABASE_URL=$(grep ^DATABASE_URL .env | sed "s/^DATABASE_URL=//" | tr -d "\"") \
//     npx tsx scripts/seed-directory-iranian.ts'

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
    name: 'Nayeb Restaurant',
    description:
      'Long-established Iranian kitchen in the Aksaray area — chelo kabab koobideh, jujeh, fesenjan, ghormeh sabzi, and saffron rice that lives up to the reputation. Halal kitchen, family-friendly, popular with Istanbul\'s Iranian community.',
    neighborhood: 'Fatih',
    languages: 'English, Turkish, Farsi',
    isExpatFriendly: true,
  },
  {
    name: 'Saadi Persian Cuisine',
    description:
      'Beyoğlu sit-down Persian restaurant named after the 13th-century poet. Classic Iranian menu — kababs, dizi, baghali polo, tahdig — plus a strong saffron-rose dessert section. English menu, lunch sets, welcoming to first-time Persian-food diners.',
    neighborhood: 'Beyoğlu',
    languages: 'English, Turkish, Farsi',
    isExpatFriendly: true,
  },
  {
    name: 'Borj-e Tehran',
    description:
      'Taksim Persian house ("Tehran Tower") with a wide regional menu — northern Iranian Caspian dishes, southern fish stews, plus the standard kababs. Live tar music on weekend evenings. Group-friendly seating.',
    neighborhood: 'Taksim',
    languages: 'English, Turkish, Farsi',
    isExpatFriendly: true,
  },
  {
    name: 'Reyhoun Persian Fine Dining',
    description:
      'Upscale Persian in Nişantaşı — a quieter, dressier room for special occasions. Hand-rolled sangak bread baked to order, slow-braised stews, and a Persian wine-pairing concept for groups. Reservations recommended.',
    neighborhood: 'Nişantaşı',
    languages: 'English, Turkish, Farsi',
    isExpatFriendly: true,
  },
  {
    name: 'Ferdowsi Restaurant',
    description:
      'Mecidiyeköy Persian kitchen with a strong takeaway following — chelo kabab and biryani are the standouts, plus tah-chin and Persian-style salads. Casual sit-down room; popular for office lunches.',
    neighborhood: 'Mecidiyeköy',
    languages: 'English, Turkish, Farsi',
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
