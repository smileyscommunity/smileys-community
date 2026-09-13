// ── Admin guide-file plumbing (server only) ─────────────────────────────────
// Shared by the admin neighborhood routes (list / edit / image). Two jobs:
//
// 1. guideFileFor — the on-disk layout for guide JSON, mirroring the public
//    loader (app/neighborhoods/[slug]/page.tsx) exactly: the default city
//    keeps its ~103 files at the flat legacy path (data/neighborhoods/
//    moda.json); every other city is namespaced under its slug
//    (data/neighborhoods/izmir/alsancak.json), because guide slugs are only
//    unique WITHIN a city.
//
// 2. resolveAdminCity — the ?city= query param those routes accept. Absent/
//    empty means the default city, so pre-multi-city bookmarks and clients
//    that never send the param behave byte-identically.

import { join } from 'path'
import { readdirSync, unlinkSync } from 'fs'
import { prisma } from './prisma'
import { DEFAULT_CITY_SLUG } from './city'
import { uploadRoot } from './uploadRoot'

export function guideFileFor(citySlug: string, isDefault: boolean, slug: string): string {
  return isDefault
    ? join(process.cwd(), 'data', 'neighborhoods', `${slug}.json`)
    : join(process.cwd(), 'data', 'neighborhoods', citySlug, `${slug}.json`)
}

// The exact names the /image route writes for one guide: `<slug>-<ts>.jpg`
// (plus the legacy bare `<slug>.jpg`) on the default city,
// `<citySlug>--<slug>-<ts>.jpg` elsewhere. Exact rather than startsWith so
// pruning `moda` can never catch a `moda-burnu-<ts>.jpg` banner.
function bannerFilePattern(citySlug: string, isDefault: boolean, slug: string): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return isDefault
    ? new RegExp(`^${esc(slug)}(?:-\\d+)?\\.jpg$`)
    : new RegExp(`^${esc(citySlug)}--${esc(slug)}-\\d+\\.jpg$`)
}

// Deletes this guide's banner files except the one the SAVED guide points at.
// Only the guide PUT calls it, and only after the JSON is on disk: uploading
// used to delete the live banner up front, so an admin who uploaded a
// replacement and left without saving left the public page on a dead file.
// Pruning here also bounds uploads that were never saved. Failures are
// ignored — a leftover file is harmless, a failed save must not follow.
export function pruneSupersededBanners(
  city: Pick<AdminGuideCity, 'slug' | 'isDefault'>,
  slug: string,
  savedImageUrl: string | undefined,
): number {
  const dir = join(uploadRoot(), 'neighborhoods')
  const keep = savedImageUrl ? savedImageUrl.slice(savedImageUrl.lastIndexOf('/') + 1) : null
  const pattern = bannerFilePattern(city.slug, city.isDefault, slug)
  let files: string[]
  try { files = readdirSync(dir) } catch { return 0 }
  let removed = 0
  for (const f of files) {
    if (f === keep || !pattern.test(f)) continue
    try { unlinkSync(join(dir, f)); removed++ } catch { /* ignore */ }
  }
  return removed
}

export interface AdminGuideCity {
  id: string
  slug: string
  name: string
  isDefault: boolean
}

export async function resolveAdminCity(cityParam: string | null): Promise<AdminGuideCity | null> {
  const slug = cityParam?.trim() || DEFAULT_CITY_SLUG
  const city = await prisma.city.findUnique({
    where:  { slug },
    select: { id: true, slug: true, name: true },
  })
  if (!city) return null
  return { ...city, isDefault: city.slug === DEFAULT_CITY_SLUG }
}
