// One-off: create the "Men" club in Istanbul.
// Run on the server: npx tsx --env-file=.env --env-file=.env.local scripts/create-club-men.ts
import { prisma } from '../lib/prisma'
import { slugify } from '../lib/slug'

async function main() {
  const name = 'Men'
  const slug = slugify(name)

  const existing = await prisma.club.findUnique({ where: { slug } })
  if (existing) {
    console.log(`Club with slug "${slug}" already exists (id=${existing.id}). Aborting.`)
    return
  }

  const city = await prisma.city.findFirst({ where: { name: 'Istanbul' } })
  if (!city) {
    console.log('Istanbul city not found. Aborting.')
    return
  }

  const club = await prisma.club.create({
    data: {
      name,
      slug,
      description: 'A space for men in the Smileys community to connect and hang out.',
      category:    'Exclusive',
      emoji:       '🧔',
      color:       'text-amber-600',
      bgColor:     'bg-amber-50',
      memberCount: 0,
      cityId:      city.id,
    },
  })

  console.log('Created club:', club)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
