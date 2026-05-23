import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const filePath = join(process.cwd(), 'data', 'banner.json')

function read() {
  try { return JSON.parse(readFileSync(filePath, 'utf-8')) }
  catch { return { active: false, headline: '', subtitle: '', emoji: '🏷️', link: '' } }
}

export async function GET() {
  return NextResponse.json(read())
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { active, headline, subtitle, emoji, link } = await req.json()
  writeFileSync(filePath, JSON.stringify({
    active:   !!active,
    headline: headline ?? '',
    subtitle: subtitle ?? '',
    emoji:    emoji || '🏷️',
    link:     link ?? '',
    updatedAt: new Date().toISOString(),
  }, null, 2))
  return NextResponse.json({ ok: true })
}
