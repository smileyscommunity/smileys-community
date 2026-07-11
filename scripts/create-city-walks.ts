/**
 * One-off: create the "City Walks" club. Mirrors the admin club-create
 * defaults (amber theme, Istanbul city, 0 members). Idempotent — skips if the
 * slug already exists.
 *   npx tsx --env-file=.env --env-file=.env.local scripts/create-city-walks.ts
 */
import { prisma } from '@/lib/prisma'
import { slugify } from '@/lib/slug'

async function main() {
  const city = await prisma.city.findFirst({ where: { name: 'Istanbul' }, select: { id: true } })
  if (!city) throw new Error('Istanbul city not found')

  const name = 'City Walks'
  const slug = slugify(name)
  const existing = await prisma.club.findUnique({ where: { slug }, select: { id: true } })
  if (existing) { console.log(`SKIP (already exists): ${name} [${slug}]`); return }

  const club = await prisma.club.create({
    data: {
      name,
      slug,
      description: 'Easygoing group walks to interesting corners of Istanbul — a new neighborhood each time, good company and a coffee stop at the end. No fitness level required.',
      category:    'Outdoor',
      emoji:       '🚶',
      color:       'text-amber-600',
      bgColor:     'bg-amber-50',
      memberCount: 0,
      cityId:      city.id,
    },
  })
  console.log(`CREATED: ${club.emoji}  ${club.name} [${club.slug}]  id=${club.id}  · ${club.category}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
