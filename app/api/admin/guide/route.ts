import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'

const FILE = join(process.cwd(), 'data', 'city-guide.json')

// Caps mirror what the page UI realistically asks for. Same rationale
// as the neighborhoods PUT — the previous version wrote `req.json()`
// straight to disk, so admin (or a compromised admin session) could
// ship a 100MB JSON to wedge disk, or insert arbitrary keys that
// crashed the public renderer.
const ICON_MAX        = 8
const LABEL_MAX       = 100
const TITLE_MAX       = 200
const DESCRIPTION_MAX = 1000
const HREF_MAX        = 500
const BADGE_MAX       = 50
const TIP_MAX         = 500
const CATEGORIES_MAX  = 30
const RESOURCES_MAX   = 30
const SERIALIZED_MAX  = 500_000

const CATEGORY_COLORS = new Set([
  'blue', 'green', 'amber', 'rose', 'violet', 'teal', 'orange',
])
const BADGE_COLORS = new Set([
  '', 'blue', 'green', 'violet', 'rose',
])

// Resource href — only same-origin paths or https:// URLs. The public
// /guide page renders this as <a href>, so javascript: or
// protocol-relative `//evil.com` would otherwise pass through. Empty
// href is OK (renders as a non-clickable card).
function isSafeHref(s: string): boolean {
  if (!s) return true
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f]/.test(s)) return false
  if (s.startsWith('//')) return false
  if (s.startsWith('/')) return true
  return /^https:\/\//i.test(s)
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

interface Resource {
  title:       string
  description: string
  href:        string
  badge:       string
  badgeColor:  string
  tip:         string
}
interface Category {
  icon:       string
  label:      string
  color:      string
  resources:  Resource[]
  updatedAt?: string
}

function normalize(body: unknown): { ok: true; value: { categories: Category[] } } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid body' }
  const b = body as Record<string, unknown>
  const rawCats = Array.isArray(b.categories) ? b.categories : []
  if (rawCats.length > CATEGORIES_MAX) {
    return { ok: false, error: `Too many categories (max ${CATEGORIES_MAX})` }
  }

  const categories: Category[] = []
  for (const c of rawCats) {
    const cat = (c ?? {}) as Record<string, unknown>
    const color = str(cat.color, 50)
    if (color && !CATEGORY_COLORS.has(color)) {
      return { ok: false, error: `Invalid category color: ${color}` }
    }

    const rawResources = Array.isArray(cat.resources) ? cat.resources : []
    if (rawResources.length > RESOURCES_MAX) {
      return { ok: false, error: `Too many resources in one category (max ${RESOURCES_MAX})` }
    }

    const resources: Resource[] = []
    for (const r of rawResources) {
      const res = (r ?? {}) as Record<string, unknown>
      const href = str(res.href, HREF_MAX).trim()
      if (href && !isSafeHref(href)) {
        return { ok: false, error: 'Resource link must be https:// or a relative path' }
      }
      const badgeColor = str(res.badgeColor, 50)
      if (badgeColor && !BADGE_COLORS.has(badgeColor)) {
        return { ok: false, error: `Invalid badge color: ${badgeColor}` }
      }
      resources.push({
        title:       str(res.title,       TITLE_MAX),
        description: str(res.description, DESCRIPTION_MAX),
        href,
        badge:       str(res.badge,       BADGE_MAX),
        badgeColor,
        tip:         str(res.tip,         TIP_MAX),
      })
    }

    categories.push({
      icon:      str(cat.icon,  ICON_MAX),
      label:     str(cat.label, LABEL_MAX),
      color:     color || 'blue',
      resources,
      // Preserve incoming updatedAt — the auto-stamp logic below
      // decides whether to bump it based on a diff against stored.
      updatedAt: str(cat.updatedAt, 30) || undefined,
    })
  }

  return { ok: true, value: { categories } }
}

function read() {
  try { return JSON.parse(readFileSync(FILE, 'utf8')) } catch { return { categories: [] } }
}

export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(read())
}

// Compare the stored category to the incoming one (ignoring updatedAt
// itself). Returns true if anything about the section's content changed.
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

  const body = await req.json().catch(() => null)
  const result = normalize(body)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  // Auto-stamp updatedAt on any category whose content changed (or is
  // new). Keeps the "Updated Mon YYYY" trust signal on /guide accurate
  // without needing admins to remember to bump dates by hand.
  const stored = read()
  const today  = new Date().toISOString().slice(0, 10)
  const prevByLabel = new Map<string, unknown>(
    (stored.categories ?? []).map((c: { label: string }) => [c.label, c]),
  )
  for (const cat of result.value.categories) {
    if (categoryChanged(prevByLabel.get(cat.label), cat)) {
      cat.updatedAt = today
    } else if (!cat.updatedAt) {
      const prev = prevByLabel.get(cat.label) as { updatedAt?: string } | undefined
      if (prev?.updatedAt) cat.updatedAt = prev.updatedAt
    }
  }

  const stamped = {
    ...result.value,
    updatedAt: new Date().toISOString(),
    updatedBy: session.name,
  }

  const serialized = JSON.stringify(stamped, null, 2)
  if (serialized.length > SERIALIZED_MAX) {
    return NextResponse.json({ error: 'Guide too large — trim a few resources' }, { status: 400 })
  }

  // Atomic write (tmp + rename) so a concurrent GET can never read a
  // half-written file.
  mkdirSync(join(process.cwd(), 'data'), { recursive: true })
  const tmp = `${FILE}.tmp`
  writeFileSync(tmp, serialized)
  renameSync(tmp, FILE)

  writeAudit(session.id, session.name, 'city_guide.update', 'city-guide', 'city_guide',
    { categoryCount: stamped.categories.length,
      resourceCount: stamped.categories.reduce((s, c) => s + c.resources.length, 0) },
    `Updated Istanbul city guide`,
  )

  return NextResponse.json({ ok: true, updatedAt: stamped.updatedAt, updatedBy: stamped.updatedBy })
}
