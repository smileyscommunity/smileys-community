// One-off seed: five Chinese restaurants for the business directory.
//
// Same shape as scripts/seed-directory-indian.ts. Idempotent on `name`
// (the script skips any row whose name already exists). Specific
// details — phone, address, hours — are left blank for an admin to
// verify and fill in via /admin/directory before promoting widely.
//
// Run on prod:
//   ssh root@<server> 'cd /root/smileys-community && \
//     DATABASE_URL=$(grep ^DATABASE_URL .env | sed "s/^DATABASE_URL=//" | tr -d "\"") \
//     npx tsx scripts/seed-directory-chinese.ts'

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
    name: 'Wan Chai Express',
    description:
      'Quick-service Chinese on İstiklal — fried rice, kung pao, dim sum staples. A reliable Beyoğlu stop when you need Chinese fast and don\'t want to book a table.',
    neighborhood: 'Beyoğlu',
    languages: 'English, Turkish',
    isExpatFriendly: true,
  },
  {
    name: 'China Town Restaurant',
    description:
      'Sit-down Cantonese kitchen in Şişli with bilingual menus. Dim sum on weekends, hot pot in winter, and a tea menu that goes beyond the standard jasmine.',
    neighborhood: 'Şişli',
    languages: 'English, Turkish, Mandarin',
    isExpatFriendly: true,
  },
  {
    name: 'Imperial Chinese Restaurant',
    description:
      'Long-running upscale Chinese in Nişantaşı popular with the business-lunch crowd. Peking duck, lobster noodles, attentive service.',
    neighborhood: 'Nişantaşı',
    languages: 'English, Turkish, Mandarin',
    isExpatFriendly: true,
  },
  {
    name: 'Shanghai Chinese Cuisine',
    description:
      'Asian-side spot in Kadıköy with strong Shanghainese roots — xiao long bao, scallion pancakes, drunken chicken. Friendly to first-time Chinese-food diners.',
    neighborhood: 'Kadıköy',
    languages: 'English, Turkish, Mandarin',
    isExpatFriendly: true,
  },
  {
    name: 'Hong Kong Garden',
    description:
      'Casual Cantonese in Levent with a large vegetarian section and quick lunch sets. Good for office groups and family dinners alike.',
    neighborhood: 'Levent',
    languages: 'English, Turkish, Cantonese',
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
