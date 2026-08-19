import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { slugToNeighborhood } from '@/lib/neighborhoods'
import { canActInCity } from '@/lib/access'
import { getDefaultCityId } from '@/lib/city'
import { writeFileSync, mkdirSync, unlinkSync, readdirSync } from 'fs'
import { join } from 'path'
import sharp from 'sharp'
import { uploadRoot } from '@/lib/uploadRoot'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // These guides are the default city's editorial content — slugToNeighborhood
  // only resolves Istanbul slugs, so an edit here is an edit to Istanbul's
  // pages. Cross-city rule as everywhere: admins yes, other cities' moderators
  // no. (Reads stay open to all moderators; the content is public anyway.)
  if (!canActInCity(session, await getDefaultCityId())) {
    return NextResponse.json({ error: "Editing another city's guides is admin-only" }, { status: 403 })
  }
  const { slug } = await params
  if (!slugToNeighborhood(slug)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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

  // Delete old files for this slug to avoid stale cache and accumulation
  try {
    readdirSync(dir)
      .filter(f => f.startsWith(`${slug}-`) || f === `${slug}.jpg`)
      .forEach(f => unlinkSync(join(dir, f)))
  } catch { /* ignore */ }

  const filename = `${slug}-${Date.now()}.jpg`
  writeFileSync(join(dir, filename), buffer)

  return NextResponse.json({ url: `/app/api/files/neighborhoods/${filename}` })
}
