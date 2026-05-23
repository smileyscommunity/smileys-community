import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { NEIGHBORHOOD_META, neighborhoodToSlug } from '@/lib/neighborhoods'
import { existsSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const neighborhoods = Object.entries(NEIGHBORHOOD_META).map(([name, meta]) => {
    const slug = neighborhoodToSlug(name)
    const hasGuide = existsSync(join(process.cwd(), 'data', 'neighborhoods', `${slug}.json`))
    const hasImage = existsSync(join(process.cwd(), 'public', 'uploads', 'neighborhoods', `${slug}.jpg`))
    return { name, slug, meta, hasGuide, hasImage }
  })

  return NextResponse.json(neighborhoods)
}
