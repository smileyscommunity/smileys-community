import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'

const filePath = join(process.cwd(), 'data', 'announcement.json')

function read() {
  try { return JSON.parse(readFileSync(filePath, 'utf-8')) }
  catch { return { text: '', link: '', active: false } }
}

export async function GET() {
  return NextResponse.json(read())
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { text, link, active } = await req.json()
  const cleanText = String(text ?? '').trim().slice(0, 300)
  const rawLink   = String(link ?? '').trim()
  if (rawLink && !rawLink.startsWith('/') && !rawLink.startsWith('https://')) {
    return NextResponse.json({ error: 'Link must be a relative path or https URL' }, { status: 400 })
  }
  const cleanLink = rawLink.slice(0, 2000)
  const tmp = filePath + '.tmp'
  writeFileSync(tmp, JSON.stringify({ text: cleanText, link: cleanLink, active: !!active, updatedAt: new Date().toISOString() }, null, 2))
  renameSync(tmp, filePath)
  return NextResponse.json({ ok: true })
}
