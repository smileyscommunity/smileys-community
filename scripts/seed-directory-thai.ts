// One-off seed: five Thai restaurants for the business directory.
//
// Same shape as scripts/seed-directory-indian.ts and -chinese.ts.
// Idempotent on `name`. Run on prod:
//   ssh root@<server> 'cd /root/smileys-community && \
//     DATABASE_URL=$(grep ^DATABASE_URL .env | sed "s/^DATABASE_URL=//" | tr -d "\"") \
//     npx tsx scripts/seed-directory-thai.ts'

import { prisma } from '@/lib/prisma'

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
    name: 'Thaai',
    description:
      'Long-running Thai spot in Karaköy known for green curry, pad thai and a small but solid vegetarian menu. Friendly to first-time Thai-food diners; English menu.',
    neighborhood: 'Karaköy',
    languages: 'English, Turkish, Thai',
    isExpatFriendly: true,
  },
  {
    name: 'Banyan Restaurant',
    description:
      'Asian fusion with a strong Thai backbone in Beşiktaş. Bay-view terrace in summer, popular for date nights and group dinners. Reservations recommended.',
    neighborhood: 'Beşiktaş',
    languages: 'English, Turkish',
    isExpatFriendly: true,
  },
  {
    name: 'Lemongrass Thai Kitchen',
    description:
      'Casual Thai in Cihangir focusing on aromatic curries and stir-fries. Lunch sets, takeaway-friendly, and a regular crowd of digital nomads working from the back tables.',
    neighborhood: 'Cihangir',
    languages: 'English, Turkish, Thai',
    isExpatFriendly: true,
  },
  {
    name: 'Bangkok Bistro',
    description:
      'Sit-down Thai in Şişli with a wide menu — tom kha, pad see ew, mango sticky rice. Good vegetarian section and quick lunch service for the office crowd.',
    neighborhood: 'Şişli',
    languages: 'English, Turkish',
    isExpatFriendly: true,
  },
  {
    name: 'Phuket Thai Cuisine',
    description:
      "Asian-side Thai kitchen in Kadıköy with a focus on southern Thai dishes — massaman, fish in tamarind, fresh coconut drinks. A reliable Anatolia-side option when crossing the bridge feels like too much.",
    neighborhood: 'Kadıköy',
    languages: 'English, Turkish, Thai',
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
