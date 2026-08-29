import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { slugToNeighborhood } from '@/lib/neighborhoods'
import { getNeighborhoodView } from '@/lib/neighborhoodsDb'
import { resolveAdminCity } from '@/lib/neighborhoodGuideFiles'
import { canActInCity } from '@/lib/access'
import { writeFileSync, mkdirSync, unlinkSync, readdirSync } from 'fs'
import { join } from 'path'
import sharp from 'sharp'
import { uploadRoot } from '@/lib/uploadRoot'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const city = await resolveAdminCity(req.nextUrl.searchParams.get('city'))
  if (!city) return NextResponse.json({ error: 'Unknown city' }, { status: 404 })
  // A banner upload is an edit to that city's public pages, so the cross-city
  // rule applies as everywhere: a city's own moderators edit their own city's
  // guides, admins edit any. (Reads stay open to all moderators; the content
  // is public anyway.)
  if (!canActInCity(session, city.id)) {
    return NextResponse.json({ error: "Editing another city's guides is admin-only" }, { status: 403 })
  }
  const { slug } = await params
  const known = city.isDefault
    ? !!slugToNeighborhood(slug)
    : (await getNeighborhoodView(city.id, slug)) !== null
  if (!known) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Max 10MB' }, { status: 400 })

  const raw = Buffer.from(await file.arrayBuffer())
  let buffer: Buffer
  try {
    buffer = await sharp(raw)
      .rotate()
      .resize(1600, 560, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 85 })
      .toBuffer()
  } catch {
    return NextResponse.json({ error: 'Could not process image' }, { status: 400 })
  }

  const dir      = join(uploadRoot(), 'neighborhoods')
  mkdirSync(dir, { recursive: true })

  // Non-default cities' banners are namespaced `<citySlug>--<slug>-<ts>.jpg`
  // — the double hyphen keeps İzmir's göztepe from colliding with Istanbul's,
  // whose files keep their legacy unprefixed names.
  const prefix = city.isDefault ? `${slug}-` : `${city.slug}--${slug}-`

  // Delete old files for this slug to avoid stale cache and accumulation
  try {
    readdirSync(dir)
      .filter(f => city.isDefault ? (f.startsWith(prefix) || f === `${slug}.jpg`) : f.startsWith(prefix))
      .forEach(f => unlinkSync(join(dir, f)))
  } catch { /* ignore */ }

  const filename = `${prefix}${Date.now()}.jpg`
  writeFileSync(join(dir, filename), buffer)

  return NextResponse.json({ url: `/app/api/files/neighborhoods/${filename}` })
}
