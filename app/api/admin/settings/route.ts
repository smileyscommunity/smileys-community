import { canManageSettings } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getSession } from '@/lib/session'

const settingsPath = join(process.cwd(), 'data', 'settings.json')

function readSettings() {
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf-8'))
  } catch {
    return {}
  }
}

export async function GET() {
  try {
    const session = await getSession()
    if (!session || !canManageSettings(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json(readSettings())
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !canManageSettings(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = await req.json()
    const patch: Record<string, unknown> = {}

    const STRING_KEYS = ['name', 'tagline', 'description', 'email', 'website', 'instagram', 'whatsapp']
    for (const key of STRING_KEYS) {
      if (key in body) patch[key] = String(body[key]).slice(0, 500)
    }
    if ('pricing'         in body && typeof body.pricing         === 'object') patch.pricing         = body.pricing
    if ('notifications'   in body && typeof body.notifications   === 'object') patch.notifications   = body.notifications
    if ('toggles'         in body && typeof body.toggles         === 'object') patch.toggles         = body.toggles
    if ('listingSettings' in body && typeof body.listingSettings === 'object') patch.listingSettings = body.listingSettings
    // The "Auto-assign on approval" club picker on /admin/applications POSTs
    // here with { defaultClubId }. Before this branch existed, every save
    // fell through to the empty-patch 400 — the dropdown looked functional
    // (React state held the choice within a session) but never persisted,
    // so a page reload reset it and approvals stopped auto-enrolling.
    // Empty string = clear (admin picked "No default club").
    if ('defaultClubId' in body) {
      const v = body.defaultClubId
      patch.defaultClubId = (typeof v === 'string' && v) ? v.slice(0, 100) : null
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid settings fields' }, { status: 400 })
    }
    const current = readSettings()
    const updated = { ...current, ...patch }
    writeFileSync(settingsPath, JSON.stringify(updated, null, 2))
    return NextResponse.json(updated)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('Settings POST error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
