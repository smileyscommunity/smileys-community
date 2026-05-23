import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

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
  
  if (!page || !Array.isArray(banners)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Validate and sanitize each banner
  const sanitized = banners.map((b: any, index: number) => {
    const headline = String(b.headline ?? '').trim().slice(0, 100)
    const subtitle = String(b.subtitle ?? '').trim().slice(0, 160)
    const cta      = String(b.cta ?? '').trim().slice(0, 40)
    const emoji    = String(b.emoji ?? '🏷️').trim().slice(0, 8)
    const type     = VALID_TYPES.includes(b.type as BannerType) ? b.type as BannerType : 'sponsored'
    const active   = !!b.active
    const link     = String(b.link ?? '').trim().slice(0, 2000)

    return {
      id: b.id || `${page}_${Date.now()}_${index}`,
      page, type, active, headline, subtitle, emoji, link, cta,
      bg: b.bg || '',
      updatedAt: new Date().toISOString(),
    }
  })

  const all = read()
  all[page as BannerPage] = sanitized

  mkdirSync(join(process.cwd(), 'data'), { recursive: true })
  writeFileSync(filePath, JSON.stringify(all, null, 2))
  
  return NextResponse.json({ ok: true, banners: sanitized })
}
