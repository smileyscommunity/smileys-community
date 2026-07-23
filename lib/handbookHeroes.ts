import { readFileSync } from 'fs'
import { join } from 'path'
import { HANDBOOK_CATEGORIES } from './handbook-categories'

// Server-only. Admin-editable category hero images live in a data/*.json file
// (same convention as banners / member-spotlight) so they can be replaced from
// the admin UI without a redeploy, and survive deploys (rsync-excluded).
//
// Shape: { [category]: "/app/api/files/<folder>/<file>" }. A category with no
// entry falls back to its generated default banner in HANDBOOK_CATEGORIES.
const filePath = join(process.cwd(), 'data', 'handbook-heroes.json')

export function readHeroOverrides(): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
    return raw && typeof raw === 'object' ? raw as Record<string, string> : {}
  } catch {
    return {}
  }
}

// Resolve a category's hero image: the admin-uploaded override if set, else the
// default generated banner. Returns null for an unknown category.
export function resolveCategoryHero(category: string): { src: string; alt: string } | null {
  const meta = HANDBOOK_CATEGORIES[category]
  if (!meta) return null
  const override = readHeroOverrides()[category]
  if (override) return { src: override, alt: `${meta.label} — Istanbul Handbook` }
  return meta.image
}
