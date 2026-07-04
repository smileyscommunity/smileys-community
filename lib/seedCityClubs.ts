import type { PrismaClient } from '@prisma/client'
import { CLUB_TEMPLATES, type ClubTemplate } from './clubTemplates'

export interface SeedCityClubsResult {
  city: string
  created: number
  skipped: number
  total: number
  createdSlugs: string[]
}

// Create a city's starter club lineup from the shared template catalog.
//
// Idempotent: clubs are keyed by a city-scoped slug (`<key>-<citySlug>`), and
// existing ones are skipped — so re-running only fills in what's missing
// (e.g. after adding a new template). New clubs start at memberCount 0; no
// fake counts, no copied members/posts/events — each city's clubs are their
// own community.
//
// Takes the prisma client as an argument so it's reusable from both a CLI
// (own client) and a future admin route (the shared singleton).
export async function seedCityClubs(
  prisma: PrismaClient,
  citySlug: string,
  templates: ClubTemplate[] = CLUB_TEMPLATES,
): Promise<SeedCityClubsResult> {
  const city = await prisma.city.findUnique({
    where: { slug: citySlug },
    select: { id: true, name: true },
  })
  if (!city) throw new Error(`City not found for slug "${citySlug}"`)

  let created = 0
  let skipped = 0
  const createdSlugs: string[] = []

  for (const t of templates) {
    const slug = `${t.key}-${citySlug}`
    const existing = await prisma.club.findUnique({ where: { slug }, select: { id: true } })
    if (existing) { skipped++; continue }

    await prisma.club.create({
      data: {
        name:        t.name.replaceAll('{city}', city.name),
        slug,
        description: t.description.replaceAll('{city}', city.name),
        category:    t.category,
        emoji:       t.emoji,
        color:       t.color,
        bgColor:     t.bgColor,
        memberCount: 0,
        isActive:    true,
        cityId:      city.id,
      },
    })
    created++
    createdSlugs.push(slug)
  }

  return { city: city.name, created, skipped, total: templates.length, createdSlugs }
}
