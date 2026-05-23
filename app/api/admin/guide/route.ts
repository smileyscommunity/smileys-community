import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'

const FILE = join(process.cwd(), 'data', 'city-guide.json')

function read() {
  try { return JSON.parse(readFileSync(FILE, 'utf8')) } catch { return { categories: [] } }
}

export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(read())
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json()
  mkdirSync(join(process.cwd(), 'data'), { recursive: true })
  writeFileSync(FILE, JSON.stringify(body, null, 2))
  return NextResponse.json({ ok: true })
}
