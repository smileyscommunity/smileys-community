import { canManageSettings } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import { getSession } from '@/lib/session'
import { writeAudit } from '@/lib/audit'

const settingsPath = join(process.cwd(), 'data', 'settings.json')

// Defense-in-depth ceilings. settings.json is admin-only and small in
// practice (a few KB), so 100 KB is generous. Without this an admin
// account compromise could grow the file unboundedly and break GET
// (which JSON.parses the whole thing on every request).
const SERIALIZED_MAX = 100_000
const SHORT_STR_MAX  = 200
const DESC_STR_MAX   = 500
// House rules can run a few paragraphs — bullet lists, conduct
// notes, escalation paths. 4 KB is plenty without unbounding.
const RULES_STR_MAX  = 4_000

// ---------- per-field allowlists ----------
// Each top-level field of settings.json is normalized through a per-key
// allowlist. Mass-assigning `body.pricing` / `body.notifications` /
// `body.toggles` / `body.listingSettings` straight into the patch
// (the previous behavior) let any admin write arbitrary nested junk —
// e.g. `{ pricing: { __proto__: ... } }` or megabyte-long strings — into
// the JSON consumed by other admin surfaces.

const STRING_KEYS: Record<string, number> = {
  name:           SHORT_STR_MAX,
  tagline:        SHORT_STR_MAX,
  description:    DESC_STR_MAX,
  email:          SHORT_STR_MAX,
  website:        SHORT_STR_MAX,
  instagram:      SHORT_STR_MAX,
  whatsapp:       SHORT_STR_MAX,
  communityRules: RULES_STR_MAX,
}

// Toggles surfaced on /admin/settings — anything outside this set
// is dropped. Adding a new flag requires touching this list AND the
// page, which is the desired friction.
const TOGGLE_IDS = new Set([
  'whatsapp_button',
  'persistent_cta',
  'member_pricing',
  'friends_section',
  'vibe_tags',
  'onboarding',
  'premium_events',
  'members_only',
])

const NOTIFICATION_KEYS = new Set([
  'newMember',
  'newBooking',
  'eventReminder',
  'lowCapacity',
  'weeklyDigest',
])

// Pricing numbers are stored as strings (the <input type="number">
// gives us strings) — keep that shape, but cap length and reject non-
// numeric content so they round-trip cleanly through Number().
const PRICING_NUMERIC_KEYS = new Set(['monthlyPrice', 'yearlyPrice', 'trialDays'])
const CURRENCIES = new Set(['₺', '$', '€'])

// Mirrors LISTING_CATEGORIES on /admin/listings. If you add a category
// there, add it here too — otherwise the admin can pick it in the UI
// and the server will silently drop it on save.
const LISTING_CATEGORIES = new Set([
  'ROOMS', 'JOBS', 'SERVICES', 'BUY_SELL', 'FREE', 'RECO',
])

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function intInRange(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  const i = Math.floor(n)
  if (i < lo) return lo
  if (i > hi) return hi
  return i
}

function normalizePricing(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object') return null
  const src = input as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const k of PRICING_NUMERIC_KEYS) {
    if (k in src) {
      const s = str(src[k], 20).trim()
      // Allow empty (admin clearing the field) but reject anything that
      // isn't a non-negative number, so a stray "299; rm -rf" can't be
      // round-tripped into the UI.
      if (s === '' || /^\d+(\.\d+)?$/.test(s)) out[k] = s
    }
  }
  if ('currency' in src) {
    const c = str(src.currency, 4)
    if (CURRENCIES.has(c)) out.currency = c
  }
  return Object.keys(out).length > 0 ? out : null
}

function normalizeToggles(input: unknown): Record<string, boolean> | null {
  if (!input || typeof input !== 'object') return null
  const src = input as Record<string, unknown>
  const out: Record<string, boolean> = {}
  for (const k of Object.keys(src)) {
    if (TOGGLE_IDS.has(k) && typeof src[k] === 'boolean') {
      out[k] = src[k] as boolean
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

function normalizeNotifications(input: unknown): Record<string, boolean> | null {
  if (!input || typeof input !== 'object') return null
  const src = input as Record<string, unknown>
  const out: Record<string, boolean> = {}
  for (const k of NOTIFICATION_KEYS) {
    if (k in src && typeof src[k] === 'boolean') out[k] = src[k] as boolean
  }
  return Object.keys(out).length > 0 ? out : null
}

function normalizeListingSettings(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object') return null
  const src = input as Record<string, unknown>
  const out: Record<string, unknown> = {}
  if ('enabledCategories' in src && Array.isArray(src.enabledCategories)) {
    out.enabledCategories = (src.enabledCategories as unknown[])
      .filter((c): c is string => typeof c === 'string' && LISTING_CATEGORIES.has(c))
  }
  if ('defaultExpiryDays' in src) {
    out.defaultExpiryDays = intInRange(src.defaultExpiryDays, 1, 365, 30)
  }
  if ('requireApproval' in src) {
    out.requireApproval = bool(src.requireApproval, false)
  }
  if ('maxActivePerMember' in src) {
    out.maxActivePerMember = intInRange(src.maxActivePerMember, 1, 100, 5)
  }
  return Object.keys(out).length > 0 ? out : null
}

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
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const patch: Record<string, unknown> = {}

    // Top-level community strings.
    for (const key of Object.keys(STRING_KEYS)) {
      if (key in body) patch[key] = str((body as Record<string, unknown>)[key], STRING_KEYS[key])
    }

    if ('pricing' in body) {
      const p = normalizePricing((body as Record<string, unknown>).pricing)
      if (p) patch.pricing = p
    }
    if ('notifications' in body) {
      const n = normalizeNotifications((body as Record<string, unknown>).notifications)
      if (n) patch.notifications = n
    }
    if ('toggles' in body) {
      const t = normalizeToggles((body as Record<string, unknown>).toggles)
      if (t) patch.toggles = t
    }
    if ('listingSettings' in body) {
      const ls = normalizeListingSettings((body as Record<string, unknown>).listingSettings)
      if (ls) patch.listingSettings = ls
    }
    // The "Auto-assign on approval" club picker on /admin/applications POSTs
    // here with { defaultClubId }. Before this branch existed, every save
    // fell through to the empty-patch 400 — the dropdown looked functional
    // (React state held the choice within a session) but never persisted,
    // so a page reload reset it and approvals stopped auto-enrolling.
    // Empty string = clear (admin picked "No default club").
    if ('defaultClubId' in body) {
      const v = (body as Record<string, unknown>).defaultClubId
      patch.defaultClubId = (typeof v === 'string' && v) ? v.slice(0, 100) : null
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid settings fields' }, { status: 400 })
    }

    const current = readSettings()
    const updated = { ...current, ...patch }
    const serialized = JSON.stringify(updated, null, 2)
    if (serialized.length > SERIALIZED_MAX) {
      return NextResponse.json({ error: 'Settings payload too large' }, { status: 413 })
    }

    // Atomic write — partial truncation on crash would leave the
    // settings page (and /admin/listings + /admin/applications which
    // read from the same file) unable to parse and effectively bricked
    // until an admin re-saved.
    const tmp = `${settingsPath}.tmp`
    writeFileSync(tmp, serialized)
    renameSync(tmp, settingsPath)

    await writeAudit(
      session.id,
      session.name,
      'settings.update',
      'settings',
      'settings',
      { fields: Object.keys(patch) },
    )

    return NextResponse.json(updated)
  } catch (e) {
    // Never leak the raw exception message — it can include FS paths
    // or stack-derived details. The original implementation returned
    // `{ error: e.message }` straight to the client.
    console.error('Settings POST error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
