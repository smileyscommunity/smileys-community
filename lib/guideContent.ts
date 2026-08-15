// Server-only loader for Guide content — split from lib/guide.ts so the
// client-side mood explorer can import the constants/types without dragging
// prisma/fs into the browser bundle.
//
// Multi-city phase 2.3: the guide_entries table is the source of truth,
// per city, so a consul writes their city's guide in the admin instead of
// shipping a deploy. The repo JSON (data/guide-*.json) remains as the
// DEFAULT city's fallback: if the table has no rows for the default city —
// fresh clone, the pre-migration window, or a DB hiccup — the shipped
// content serves rather than a blank guide. Other cities never fall back:
// an empty guide for a launching city is honest, Istanbul's content under
// an Izmir header is not.
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { prisma } from './prisma'
import { getDefaultCityId } from './city'
import type { Experience } from './guide'

// Drop-in photo pipeline (same as neighborhoods): an experience gets a
// photo the moment public/images/guide/<slug>.jpg exists — no code or
// data change. Missing photo -> the emoji/gradient fallback renders.
// Filesystem keying is by slug alone, so a second city reusing a slug
// would inherit the photo — mind collisions until photos move to a column.
function photoFor(slug: string): string | null {
  return existsSync(join(process.cwd(), 'public', 'images', 'guide', `${slug}.jpg`))
    ? `/app/images/guide/${slug}.jpg`
    : null
}

export interface RouteStop {
  title: string
  note: string
  experience?: string
}
export interface GuideRoute {
  slug: string
  title: string
  emoji: string
  time: string
  tagline: string
  intro: string
  stops: RouteStop[]
  neighborhoods: string[]
}

// 60s per-(city,kind) cache — editorial cadence, hot pages.
const CACHE_TTL_MS = 60_000
const cache = new Map<string, { rows: unknown[]; expires: number }>()

async function dbEntries(cityId: string, kind: 'experience' | 'route'): Promise<unknown[]> {
  const key = `${cityId}:${kind}`
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.rows
  const rows = await prisma.guideEntry.findMany({
    where:   { cityId, kind, status: 'published' },
    orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
  })
  cache.set(key, { rows, expires: Date.now() + CACHE_TTL_MS })
  return rows
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToExperience(r: any): Experience {
  const c = (r.content ?? {}) as Record<string, unknown>
  return {
    slug: r.slug, title: r.title, emoji: r.emoji,
    collection: r.collection, moods: r.moods,
    tagline: r.tagline, cost: r.cost ?? '', time: r.time ?? '', when: r.when ?? '',
    neighborhoods: r.neighborhoods, firstTime: r.firstTime || undefined,
    why: (c.why as string) ?? '', take: (c.take as string) ?? '',
    sections: (c.sections as Experience['sections']) ?? [],
    handbook: c.handbook as Experience['handbook'],
    directory: c.directory as Experience['directory'],
    clubs: c.clubs as Experience['clubs'],
    photo: photoFor(r.slug),
  } as Experience
}

function rowToRoute(r: any): GuideRoute {
  const c = (r.content ?? {}) as Record<string, unknown>
  return {
    slug: r.slug, title: r.title, emoji: r.emoji,
    time: r.time ?? '', tagline: r.tagline,
    intro: (c.intro as string) ?? '',
    stops: (c.stops as RouteStop[]) ?? [],
    neighborhoods: r.neighborhoods,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function jsonExperiences(): Experience[] {
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'guide-experiences.json'), 'utf8'))
    return ((raw.experiences ?? []) as Experience[]).map(e => ({ ...e, photo: photoFor(e.slug) }))
  } catch {
    return []
  }
}

function jsonRoutes(): GuideRoute[] {
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'guide-routes.json'), 'utf8'))
    return (raw.routes ?? []) as GuideRoute[]
  } catch {
    return []
  }
}

export async function loadExperiences(cityId?: string): Promise<Experience[]> {
  try {
    const resolved = cityId ?? await getDefaultCityId()
    const rows = await dbEntries(resolved, 'experience')
    if (rows.length > 0) return rows.map(rowToExperience)
    const isDefault = cityId === undefined || cityId === await getDefaultCityId()
    return isDefault ? jsonExperiences() : []
  } catch {
    // Table missing (pre-push window) or DB down — the shipped default-city
    // content beats an empty guide, and only when no city was asked for.
    return cityId === undefined ? jsonExperiences() : []
  }
}

export async function getExperience(slug: string, cityId?: string): Promise<Experience | undefined> {
  return (await loadExperiences(cityId)).find(e => e.slug === slug)
}

export async function loadRoutes(cityId?: string): Promise<GuideRoute[]> {
  try {
    const resolved = cityId ?? await getDefaultCityId()
    const rows = await dbEntries(resolved, 'route')
    if (rows.length > 0) return rows.map(rowToRoute)
    const isDefault = cityId === undefined || cityId === await getDefaultCityId()
    return isDefault ? jsonRoutes() : []
  } catch {
    return cityId === undefined ? jsonRoutes() : []
  }
}

export async function getRoute(slug: string, cityId?: string): Promise<GuideRoute | undefined> {
  return (await loadRoutes(cityId)).find(r => r.slug === slug)
}
