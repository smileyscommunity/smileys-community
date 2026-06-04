// One-off seed: ten international restaurants across cuisines not
// already covered by the prior seeds (Indian / Chinese / Thai /
// Italian / Japanese / Mexican / Lebanese / Vietnamese / Korean).
//
// Ten distinct kitchens this batch:
//   French · Spanish · Greek · American BBQ · Argentine ·
//   German · Georgian · Persian · Brunch (third-wave) · Russian
//
// Idempotent on `name`. Run on prod:
//   ssh root@<server> 'cd /root/smileys-community && \
//     DATABASE_URL=$(grep ^DATABASE_URL .env | sed "s/^DATABASE_URL=//" | tr -d "\"") \
//     npx tsx scripts/seed-directory-international-2.ts'

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
    name: 'Bistro Galata',
    description:
      'Classic French bistro tucked behind the Galata Tower — steak frites, duck confit, escargots, and a focused wine list of small French producers. Friendly to first-time French diners; English menu.',
    neighborhood: 'Galata',
    languages: 'English, Turkish, French',
    isExpatFriendly: true,
  },
  {
    name: 'Bilbao Tapas',
    description:
      'Cihangir tapas bar with a rotating chalkboard — patatas bravas, pulpo, tortilla, croquetas — and a short Spanish wine list. Good for a long after-work hang or a date that turns into dinner.',
    neighborhood: 'Cihangir',
    languages: 'English, Turkish, Spanish',
    isExpatFriendly: true,
  },
  {
    name: 'To Steki',
    description:
      'Karaköy meyhane in the Greek-Istanbul tradition — fresh mezze, grilled fish, ouzo and tsipouro, lively weekend music. Reservations recommended after 8pm.',
    neighborhood: 'Karaköy',
    languages: 'English, Turkish, Greek',
    isExpatFriendly: true,
  },
  {
    name: 'Big Smoke BBQ',
    description:
      'Texas-style American smokehouse in Beyoğlu — brisket, pulled pork, ribs, cornbread, bourbon list. Generous portions and a sports-bar vibe; great for groups.',
    neighborhood: 'Beyoğlu',
    languages: 'English, Turkish',
    isExpatFriendly: true,
  },
  {
    name: 'El Gaucho',
    description:
      'Argentine parrilla in Etiler serving bife de chorizo, provoleta, chimichurri, and a strong Malbec selection. Steakhouse atmosphere; book ahead on weekends.',
    neighborhood: 'Etiler',
    languages: 'English, Turkish, Spanish',
    isExpatFriendly: true,
  },
  {
    name: 'Bavarius Beerhaus',
    description:
      'German beerhall in Beşiktaş with steins of weissbier, schnitzel, sausages, sauerkraut, and a Friday-night Oktoberfest energy. Long tables; great for groups.',
    neighborhood: 'Beşiktaş',
    languages: 'English, Turkish, German',
    isExpatFriendly: true,
  },
  {
    name: 'Sakhli',
    description:
      'Georgian kitchen in Beyoğlu — khachapuri (the cheese-bread boat), khinkali dumplings, lobio, and Georgian wines. Cosy room; busy on weekends.',
    neighborhood: 'Beyoğlu',
    languages: 'English, Turkish, Georgian, Russian',
    isExpatFriendly: true,
  },
  {
    name: 'Persepolis Persian Cuisine',
    description:
      'Persian restaurant in Şişli with chelo kabab, ghormeh sabzi, tahdig, and saffron-rose desserts. Halal kitchen, English menu, generous lunch sets.',
    neighborhood: 'Şişli',
    languages: 'English, Turkish, Farsi',
    isExpatFriendly: true,
  },
  {
    name: 'Federal Coffee Company',
    description:
      'Australian-style third-wave café in Cihangir — single-origin filter, flat whites, avocado smash, brunch eggs, and a fast wifi crowd of remote workers.',
    neighborhood: 'Cihangir',
    languages: 'English, Turkish',
    isExpatFriendly: true,
  },
  {
    name: 'Russkiy Bistro',
    description:
      'Beyoğlu Russian bistro carrying the city\'s old White-Russian heritage forward — borscht, pelmeni, beef stroganoff, blini, and a vodka flight menu.',
    neighborhood: 'Beyoğlu',
    languages: 'English, Turkish, Russian',
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
