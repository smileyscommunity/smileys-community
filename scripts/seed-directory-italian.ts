// One-off seed: five Italian restaurants for the business directory.
//
// Same shape as scripts/seed-directory-indian.ts / -chinese.ts / -thai.ts.
// Idempotent on `name`. Run on prod:
//   ssh root@<server> 'cd /root/smileys-community && \
//     DATABASE_URL=$(grep ^DATABASE_URL .env | sed "s/^DATABASE_URL=//" | tr -d "\"") \
//     npx tsx scripts/seed-directory-italian.ts'

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
    name: 'Mangerie',
    description:
      'Long-running Bebek favourite known for weekend brunch, pasta, and Bosphorus views. Reservations recommended at peak hours; English-speaking staff and a strong vegetarian section.',
    neighborhood: 'Bebek',
    languages: 'English, Turkish, Italian',
    isExpatFriendly: true,
  },
  {
    name: 'MezzaLuna',
    description:
      'Nişantaşı standby for sit-down Italian — wood-fired pizzas, fresh pastas, tiramisu. Solid wine list and a child-friendly room, popular for family dinners and business lunches alike.',
    neighborhood: 'Nişantaşı',
    languages: 'English, Turkish, Italian',
    isExpatFriendly: true,
  },
  {
    name: 'Cipriani Istanbul',
    description:
      'Upscale Italian on the European Bosphorus shore. Classic Venetian menu — carpaccio, Bellinis, fish of the day. Dress on the smarter side; ideal for special occasions.',
    neighborhood: 'Bebek',
    languages: 'English, Turkish, Italian',
    isExpatFriendly: true,
  },
  {
    name: 'Da Mario',
    description:
      'Cosy trattoria in Etiler with a regular crowd and a chalkboard menu that rotates with the season. Strong on regional pastas and homemade desserts; check for daily specials.',
    neighborhood: 'Etiler',
    languages: 'English, Turkish, Italian',
    isExpatFriendly: true,
  },
  {
    name: 'Cantinetta',
    description:
      'Beyoğlu wine bar that doubles as a small Italian kitchen — charcuterie boards, focaccia, a short pasta menu, and a curated Italian wine list. Good for date nights and after-work catch-ups.',
    neighborhood: 'Beyoğlu',
    languages: 'English, Turkish, Italian',
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
