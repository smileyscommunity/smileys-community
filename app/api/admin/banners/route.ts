import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { isSafeHref } from '@/lib/safeUrl'
import { writeAudit } from '@/lib/audit'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'

// Hard caps mirror the UI maxLengths. Banner count cap prevents an
// admin from packing thousands of rows; serialized ceiling is a
// defense-in-depth limit on overall file size if the per-banner caps
// somehow get bypassed.
const HEADLINE_MAX = 100
const SUBTITLE_MAX = 160
const CTA_MAX      = 40
const EMOJI_MAX    = 8
const LINK_MAX     = 2000
const BG_MAX       = 100
const BANNERS_PER_PAGE_MAX = 20
const SERIALIZED_MAX = 200_000

// Page allowlist — previously `page` was used directly as a JSON key
// (`all[page as BannerPage] = ...`), so any string slipped in as a
// top-level property, polluting the file with garbage. Restricting
// to the documented enum.
const VALID_PAGES = ['dashboard', 'events', 'clubs', 'members', 'neighborhoods', 'guide'] as const

const filePath = join(process.cwd(), 'data', 'banners.json')

export type BannerType = 'sponsored' | 'promo' | 'strip'
export type BannerPage = 'dashboard' | 'events' | 'clubs' | 'members' | 'neighborhoods' | 'guide'

export interface Banner {
  id:       string
  page:     BannerPage
  type:     BannerType
  active:   boolean
  headline: string
  subtitle: string
  emoji:    string
  link:     string
  cta:      string
  bg:       string
  updatedAt: string
}

type BannerData = Record<string, any>

function read(): Record<BannerPage, Banner[]> {
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as BannerData
    const result = {} as Record<BannerPage, Banner[]>
    
    // Pages we care about
    const pages: BannerPage[] = ['dashboard', 'events', 'clubs', 'members', 'neighborhoods', 'guide']
    
    for (const page of pages) {
      const data = raw[page]
      if (Array.isArray(data)) {
        result[page] = data
      } else if (data && typeof data === 'object' && data.headline) {
        // Migrate old single object format to array
        result[page] = [{ ...data, id: data.id || `${page}_1` }]
      } else {
        result[page] = []
      }
    }
    return result
  } catch {
    return {
      dashboard: [], events: [], clubs: [], members: [], neighborhoods: [], guide: []
    }
  }
}

export async function GET() {
  return NextResponse.json(read())
}

const VALID_TYPES: BannerType[] = ['sponsored', 'promo', 'strip']

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { page, banners } = await req.json()

  // Page allowlist — previously `page` was used as a JSON key without
  // validation, so an admin could write `page: "__proto__"` (or any
  // other string) and pollute the file with garbage top-level keys.
  if (!page || !(VALID_PAGES as readonly string[]).includes(page)) {
    return NextResponse.json({ error: 'Invalid page' }, { status: 400 })
  }
  if (!Array.isArray(banners)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (banners.length > BANNERS_PER_PAGE_MAX) {
    return NextResponse.json({ error: `Maximum ${BANNERS_PER_PAGE_MAX} banners per page` }, { status: 400 })
  }

  // Validate and sanitize each banner
  const sanitized: Banner[] = []
  for (let index = 0; index < banners.length; index++) {
    const b = banners[index]
    const headline = String(b.headline ?? '').trim().slice(0, HEADLINE_MAX)
    const subtitle = String(b.subtitle ?? '').trim().slice(0, SUBTITLE_MAX)
    const cta      = String(b.cta ?? '').trim().slice(0, CTA_MAX)
    const emoji    = String(b.emoji ?? '🏷️').trim().slice(0, EMOJI_MAX)
    const type     = VALID_TYPES.includes(b.type as BannerType) ? b.type as BannerType : 'sponsored'
    const active   = !!b.active
    const link     = String(b.link ?? '').trim().slice(0, LINK_MAX)
    // bg is currently unused by any consumer (every component renders
    // its own styling). Capping it cheaply so a malicious admin can't
    // pad each banner with megabytes of dead data.
    const bg       = String(b.bg ?? '').trim().slice(0, BG_MAX)

    // Reject `javascript:` / `data:` URLs — banners render directly as
    // <a href={link}> on dashboard, guide, neighborhoods, and the ad strip.
    // Empty link is allowed (non-clickable banner).
    if (link && !isSafeHref(link)) {
      return NextResponse.json(
        { error: `Banner ${index + 1}: link must be https:// or a /relative path` },
        { status: 400 },
      )
    }

    sanitized.push({
      id: b.id || `${page}_${Date.now()}_${index}`,
      page, type, active, headline, subtitle, emoji, link, cta, bg,
      updatedAt: new Date().toISOString(),
    })
  }

  const all = read()
  all[page as BannerPage] = sanitized

  const serialized = JSON.stringify(all, null, 2)
  if (serialized.length > SERIALIZED_MAX) {
    return NextResponse.json({ error: 'Banner file too large — trim some entries' }, { status: 400 })
  }

  // Atomic write — same shape as the other admin JSON writers. Without
  // this a concurrent GET could read a half-written file.
  mkdirSync(join(process.cwd(), 'data'), { recursive: true })
  const tmp = filePath + '.tmp'
  writeFileSync(tmp, serialized)
  renameSync(tmp, filePath)

  // Audit — banner changes are sitewide content (dashboard / guide /
  // neighborhoods all render these). Was previously unaudited.
  writeAudit(session.id, session.name, 'banners.update', page, 'banner',
    { page, count: sanitized.length, activeCount: sanitized.filter(b => b.active).length },
    `Updated ${page} banners (${sanitized.length} total, ${sanitized.filter(b => b.active).length} live)`,
  )

  return NextResponse.json({ ok: true, banners: sanitized })
}
