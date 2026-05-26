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

// Compare the stored category to the incoming one (ignoring updatedAt itself).
// Returns true if anything about the section's content changed.
function categoryChanged(prev: unknown, next: unknown): boolean {
  if (!prev) return true
  const a = JSON.parse(JSON.stringify(prev))
  const b = JSON.parse(JSON.stringify(next))
  delete a.updatedAt
  delete b.updatedAt
  return JSON.stringify(a) !== JSON.stringify(b)
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json()

  // Auto-stamp updatedAt on any category whose content changed (or is new).
  // Keeps the "Updated Mon YYYY" trust signal on /guide accurate without
  // needing admins to remember to bump dates by hand.
  const stored = read()
  const today  = new Date().toISOString().slice(0, 10)
  const prevByLabel = new Map<string, unknown>(
    (stored.categories ?? []).map((c: { label: string }) => [c.label, c])
  )
  if (Array.isArray(body.categories)) {
    for (const cat of body.categories) {
      if (categoryChanged(prevByLabel.get(cat.label), cat)) {
        cat.updatedAt = today
      } else if (!cat.updatedAt) {
        const prev = prevByLabel.get(cat.label) as { updatedAt?: string } | undefined
        if (prev?.updatedAt) cat.updatedAt = prev.updatedAt
      }
    }
  }

  mkdirSync(join(process.cwd(), 'data'), { recursive: true })
  writeFileSync(FILE, JSON.stringify(body, null, 2))
  return NextResponse.json({ ok: true })
}
