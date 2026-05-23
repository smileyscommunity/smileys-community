import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { slugToNeighborhood } from '@/lib/neighborhoods'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'

function getFile(slug: string) {
  return join(process.cwd(), 'data', 'neighborhoods', `${slug}.json`)
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { slug } = await params
  if (!slugToNeighborhood(slug)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    return NextResponse.json(JSON.parse(readFileSync(getFile(slug), 'utf8')))
  } catch {
    return NextResponse.json({ tagline: '', places: [], tips: [] })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { slug } = await params
  if (!slugToNeighborhood(slug)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json()
  mkdirSync(join(process.cwd(), 'data', 'neighborhoods'), { recursive: true })
  writeFileSync(getFile(slug), JSON.stringify(body, null, 2))
  return NextResponse.json({ ok: true })
}
