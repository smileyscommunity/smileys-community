// Server-only loader for Guide experiences — split from lib/guide.ts so
// the client-side mood explorer can import the constants/types without
// dragging fs into the browser bundle.
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Experience } from './guide'

let cache: Experience[] | null = null

// Drop-in photo pipeline (same as neighborhoods): an experience gets a
// photo the moment public/images/guide/<slug>.jpg exists — no code or
// JSON change. Missing photo -> the emoji/gradient fallback renders.
function photoFor(slug: string): string | null {
  return existsSync(join(process.cwd(), 'public', 'images', 'guide', `${slug}.jpg`))
    ? `/app/images/guide/${slug}.jpg`
    : null
}

export function loadExperiences(): Experience[] {
  if (cache && process.env.NODE_ENV === 'production') return cache
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'guide-experiences.json'), 'utf8'))
    cache = ((raw.experiences ?? []) as Experience[]).map(e => ({ ...e, photo: photoFor(e.slug) }))
  } catch {
    cache = []
  }
  return cache
}

export function getExperience(slug: string): Experience | undefined {
  return loadExperiences().find(e => e.slug === slug)
}
