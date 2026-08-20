import type { PrismaClient } from '@prisma/client'
import { CLUB_TEMPLATES, type ClubTemplate } from './clubTemplates'

export interface SeedCityClubsResult {
  city: string
  created: number
  // How many of the created clubs opened ACTIVE (the Bodrum-shape core trio)
  // — the admin card's clubCount counts active only, so the client needs this
  // to update without a refetch.
  activeCreated: number
  skipped: number
  total: number
  createdSlugs: string[]
}

// The clubs a new city OPENS with, vs the ones it grows into. Bodrum set the
// pattern (manually, post-seed): three active — the social flagship, the
// newcomers club, and coffee (the lowest-commitment ways to meet people) —
// and the rest seeded but INACTIVE, flipped on as hosts appear. Eleven empty
// special-interest clubs read as a dead community; three warm ones read as a
// beginning. seedCityClubs now creates that shape directly instead of every
// city repeating Bodrum's manual deactivation pass.
const ACTIVE_CORE = new Set(['social', 'newcomers', 'coffee-social'])

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
  let activeCreated = 0
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
        isActive:    ACTIVE_CORE.has(t.key),
        cityId:      city.id,
        templateKey: t.key,
      },
    })
    created++
    if (ACTIVE_CORE.has(t.key)) activeCreated++
    createdSlugs.push(slug)
  }

  return { city: city.name, created, activeCreated, skipped, total: templates.length, createdSlugs }
}
