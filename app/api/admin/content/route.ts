import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import fs from 'fs'
import path from 'path'

const FILE = path.join(process.cwd(), 'data', 'content.json')

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}

export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(read())
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const current = read()

  // Section-based save: only update the section sent
  const updated = { ...current, ...body }
  fs.writeFileSync(FILE, JSON.stringify(updated, null, 2))
  return NextResponse.json({ ok: true })
}
