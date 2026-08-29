import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { NEIGHBORHOOD_META, neighborhoodToSlug } from '@/lib/neighborhoods'
import { getNeighborhoodViews } from '@/lib/neighborhoodsDb'
import { guideFileFor, resolveAdminCity } from '@/lib/neighborhoodGuideFiles'
import { uploadRoot } from '@/lib/uploadRoot'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const city = await resolveAdminCity(req.nextUrl.searchParams.get('city'))
  if (!city) return NextResponse.json({ error: 'Unknown city' }, { status: 404 })

  // The default city's list comes from NEIGHBORHOOD_META — the hand-authored
  // editorial layer this page has always edited. Other cities list their DB
  // registry, mapped to the same response shape (`side` carries the city's
  // own area vocabulary, '' when the city has no grouping).
  if (city.isDefault) {
    const neighborhoods = Object.entries(NEIGHBORHOOD_META).map(([name, meta]) => {
      const slug = neighborhoodToSlug(name)
      const hasGuide = existsSync(join(process.cwd(), 'data', 'neighborhoods', `${slug}.json`))
      const hasImage = existsSync(join(uploadRoot(), 'neighborhoods', `${slug}.jpg`))
      return { name, slug, meta, hasGuide, hasImage }
    })
    return NextResponse.json(neighborhoods)
  }

  // Non-default banners are namespaced `<citySlug>--<slug>-<ts>.jpg` (see the
  // image route), so one readdir answers hasImage for the whole list.
  let uploaded: string[] = []
  try { uploaded = readdirSync(join(uploadRoot(), 'neighborhoods')) } catch { /* no uploads yet */ }

  const views = await getNeighborhoodViews(city.id)
  const neighborhoods = views.map(v => ({
    name: v.name,
    slug: v.slug,
    meta: { emoji: v.emoji, vibe: v.vibe, side: v.area },
    hasGuide: existsSync(guideFileFor(city.slug, false, v.slug)),
    hasImage: uploaded.some(f => f.startsWith(`${city.slug}--${v.slug}-`)),
  }))
  return NextResponse.json(neighborhoods)
}
