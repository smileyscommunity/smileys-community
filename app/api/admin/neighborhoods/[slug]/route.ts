import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { slugToNeighborhood } from '@/lib/neighborhoods'
import { canActInCity } from '@/lib/access'
import { getDefaultCityId } from '@/lib/city'
import { writeAudit } from '@/lib/audit'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'

// Caps mirror what the page UI realistically asks for. Anything bigger
// is an attempt to fill disk or to wedge garbage that breaks the public
// renderer. Keep these in sync with the admin page's UX defaults.
const TAGLINE_MAX     = 200
const GROUP_LABEL_MAX = 100
const QUOTE_MAX       = 1000
const NAME_MAX        = 200
const SINCE_MAX       = 100
const TRANSPORT_MAX   = 100
const TIP_MAX         = 500
const ADDRESS_MAX     = 300
const DESC_MAX        = 1000
const EMOJI_MAX       = 8
const CATEGORY_MAX    = 100
const ARRAY_TRANSPORT_MAX = 20
const ARRAY_LANG_MAX      = 10
const ARRAY_TIPS_MAX      = 30
const ARRAY_PLACES_MAX    = 30
const ARRAY_ITEMS_MAX     = 30
// Hard ceiling on the file size we'll write, applied after JSON.stringify.
// 500 KB is way more than any realistic guide needs and orders of
// magnitude below anything a malicious admin would use to fill disk.
const SERIALIZED_MAX = 500_000

const SEASONS = new Set([
  '',
  '☀️ Great in summer',
  '🍂 Best in autumn',
  '🌸 Best in spring',
  '❄️ Good in winter',
  '🌿 Year-round',
])

const BADGE_OPTIONS = new Set([
  '', 'Smileys Pick', 'Must Visit', 'Must Try', 'Must Do', 'Hidden Gem', 'Landmark',
])

// Banner image must be a file the /image upload route produced.
// External URLs would leak visitor IP / referer to the third-party host
// on every public neighborhood-page render.
const BANNER_URL_RE = /^\/app\/api\/files\/neighborhoods\/[a-zA-Z0-9\-_]+\.(jpg|jpeg|png|webp)$/i

// Community group link — only same-origin paths or https:// URLs. The
// public neighborhood page renders this as <a href>, so javascript: or
// protocol-relative `//evil.com` would otherwise pass through.
function isSafeGroupLink(s: string): boolean {
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

function strArr(v: unknown, maxLen: number, max: number): string[] {
  if (!Array.isArray(v)) return []
  return v.slice(0, maxLen).map(s => str(s, max)).filter(s => s.length > 0)
}

interface GuideShape {
  tagline?:       string
  image?:         string
  imagePosition?: number
  season?:        string
  transport?:     string[]
  languages?:     string[]
  groupLink?:     string
  groupLabel?:    string
  spotlight?:     { quote?: string; name?: string; since?: string } | null
  places?:        Array<{ category?: string; emoji?: string; items?: Array<{
    name?: string; description?: string; address?: string; tip?: string; badge?: string
  }> }>
  tips?:          string[]
}

// Normalize the incoming body into a known-good shape. Anything outside
// the allowlisted keys is dropped, every string is capped, every array
// is bounded. This is the core fix for the previous PUT which wrote
// the raw request body to disk verbatim — admin could ship a 100MB
// JSON or insert arbitrary keys that crashed the public renderer.
function normalize(body: unknown): { ok: true; value: GuideShape } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid body' }
  const b = body as Record<string, unknown>

  const image = str(b.image, 500).trim()
  if (image && !BANNER_URL_RE.test(image)) {
    return { ok: false, error: 'Banner image URL must point to /app/api/files/neighborhoods/' }
  }

  const groupLink = str(b.groupLink, 500).trim()
  if (groupLink && !isSafeGroupLink(groupLink)) {
    return { ok: false, error: 'Group link must be https:// or a relative path' }
  }

  const seasonRaw = str(b.season, 100)
  const season = SEASONS.has(seasonRaw) ? seasonRaw : ''

  const posRaw = typeof b.imagePosition === 'number' ? b.imagePosition : 50
  const imagePosition = Math.max(0, Math.min(100, Math.round(posRaw)))

  const spotlightSrc = b.spotlight as { quote?: unknown; name?: unknown; since?: unknown } | null | undefined
  const spotlight = spotlightSrc && typeof spotlightSrc === 'object'
    ? {
        quote: str(spotlightSrc.quote, QUOTE_MAX),
        name:  str(spotlightSrc.name,  NAME_MAX),
        since: str(spotlightSrc.since, SINCE_MAX),
      }
    : undefined

  const places = Array.isArray(b.places)
    ? b.places.slice(0, ARRAY_PLACES_MAX).map((c: unknown) => {
        const cat = (c ?? {}) as Record<string, unknown>
        const items = Array.isArray(cat.items)
          ? cat.items.slice(0, ARRAY_ITEMS_MAX).map((i: unknown) => {
              const item = (i ?? {}) as Record<string, unknown>
              const badgeRaw = str(item.badge, 50)
              return {
                name:        str(item.name,        NAME_MAX),
                description: str(item.description, DESC_MAX),
                address:     str(item.address,     ADDRESS_MAX),
                tip:         str(item.tip,         TIP_MAX),
                badge:       BADGE_OPTIONS.has(badgeRaw) ? badgeRaw : '',
              }
            })
          : []
        return {
          category: str(cat.category, CATEGORY_MAX),
          emoji:    str(cat.emoji,    EMOJI_MAX),
          items,
        }
      })
    : []

  const value: GuideShape = {
    tagline:    str(b.tagline, TAGLINE_MAX),
    image:      image || undefined,
    imagePosition,
    season,
    transport:  strArr(b.transport, ARRAY_TRANSPORT_MAX, TRANSPORT_MAX),
    languages:  strArr(b.languages, ARRAY_LANG_MAX,      TRANSPORT_MAX),
    groupLink:  groupLink || undefined,
    groupLabel: str(b.groupLabel, GROUP_LABEL_MAX),
    spotlight,
    places,
    tips:       strArr(b.tips, ARRAY_TIPS_MAX, TIP_MAX),
  }

  return { ok: true, value }
}

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
  // These guides are the default city's editorial content — slugToNeighborhood
  // only resolves Istanbul slugs, so an edit here is an edit to Istanbul's
  // pages. Cross-city rule as everywhere: admins yes, other cities' moderators
  // no. (Reads stay open to all moderators; the content is public anyway.)
  if (!canActInCity(session, await getDefaultCityId())) {
    return NextResponse.json({ error: "Editing another city's guides is admin-only" }, { status: 403 })
  }
  const { slug } = await params
  if (!slugToNeighborhood(slug)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const result = normalize(body)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  // Stamp the server-set audit fields. The page surfaces updatedBy so
  // moderators can tell whose edits are live.
  const stamped = {
    ...result.value,
    updatedAt: new Date().toISOString(),
    updatedBy: session.name,
  }

  const serialized = JSON.stringify(stamped, null, 2)
  // Hard ceiling — defense against a pathological body that passes
  // every per-field cap but adds up to many MB across thousands of
  // small items.
  if (serialized.length > SERIALIZED_MAX) {
    return NextResponse.json({ error: 'Guide too large — trim a few places or tips' }, { status: 400 })
  }

  // Atomic write via tmp+rename so a concurrent GET can never read a
  // half-written file.
  mkdirSync(join(process.cwd(), 'data', 'neighborhoods'), { recursive: true })
  const target = getFile(slug)
  const tmp    = `${target}.tmp`
  writeFileSync(tmp, serialized)
  renameSync(tmp, target)

  writeAudit(session.id, session.name, 'neighborhood.update', slug, 'neighborhood',
    { slug, categoryCount: stamped.places?.length ?? 0, tipCount: stamped.tips?.length ?? 0 },
    `Updated neighborhood guide for ${slugToNeighborhood(slug) ?? slug}`,
  )

  return NextResponse.json({ ok: true, updatedAt: stamped.updatedAt, updatedBy: stamped.updatedBy })
}
