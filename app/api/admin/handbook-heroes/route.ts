import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { HANDBOOK_CATEGORIES } from '@/lib/handbook-categories'
import { readHeroOverrides, resolveCategoryHero } from '@/lib/handbookHeroes'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

const filePath = join(process.cwd(), 'data', 'handbook-heroes.json')

// Accept only image paths our own uploader produced (/app/api/files/<folder>/<file>),
// so an admin can't point a hero at an arbitrary external/tracking URL.
const UPLOAD_PATH = /^\/app\/api\/files\/[a-z]+\/[\w.-]+\.(jpe?g|png|webp|gif)$/i

function write(map: Record<string, string>) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(map, null, 2))
}

// GET — current hero per category (resolved src + whether it's an override), so
// the admin page can show each category's image with a reset affordance.
export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const overrides = readHeroOverrides()
  const categories = Object.entries(HANDBOOK_CATEGORIES).map(([key, meta]) => ({
    category:   key,
    label:      meta.label,
    emoji:      meta.emoji,
    src:        resolveCategoryHero(key)!.src,
    isOverride: !!overrides[key],
  }))
  return NextResponse.json({ categories })
}

// POST { category, src } — set a category's hero to an uploaded image.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { category, src } = await req.json()
  if (!category || !HANDBOOK_CATEGORIES[category]) {
    return NextResponse.json({ error: 'Unknown category' }, { status: 400 })
  }
  if (typeof src !== 'string' || !UPLOAD_PATH.test(src)) {
    return NextResponse.json({ error: 'Image must be an uploaded file' }, { status: 400 })
  }
  const map = readHeroOverrides()
  map[category] = src
  write(map)
  writeAudit(session.id, session.name, 'handbook-hero.set', category, 'handbook',
    { category, src }, `Set ${category} handbook hero image`)
  return NextResponse.json({ ok: true })
}

// DELETE { category } — clear the override, reverting to the default banner.
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { category } = await req.json()
  if (!category || !HANDBOOK_CATEGORIES[category]) {
    return NextResponse.json({ error: 'Unknown category' }, { status: 400 })
  }
  const map = readHeroOverrides()
  if (map[category]) {
    delete map[category]
    write(map)
    writeAudit(session.id, session.name, 'handbook-hero.reset', category, 'handbook',
      { category }, `Reset ${category} handbook hero to default banner`)
  }
  return NextResponse.json({ ok: true })
}
