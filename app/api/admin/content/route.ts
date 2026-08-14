import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getCommunityStats } from '@/lib/communityStats'
import { isAdminOrModerator } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import fs from 'fs'
import path from 'path'

const FILE = path.join(process.cwd(), 'data', 'content.json')

// Caps. Each is generous enough for the longest plausible copy but
// tight enough that a malicious admin can't fill disk with one field.
// Numbers chosen with a 2x safety margin on what the public renderer
// actually wants to show.
const STAT_FIELD_MAX = 80
const HEADLINE_MAX   = 300
const SUBTITLE_MAX   = 1000
const STORY_MAX      = 3000
const TAGLINE_MAX    = 200
const CLOSING_MAX    = 300
const BADGE_MAX      = 100
const DAY_MAX        = 30
const EMOJI_MAX      = 8
const EVENT_MAX      = 100
const DESC_MAX       = 500
const FAQ_ID_MAX     = 100
const FAQ_TITLE_MAX  = 200
const FAQ_ICON_MAX   = 8
const FAQ_Q_MAX      = 500
const FAQ_A_MAX      = 3000
const WEEK_LEN_MAX   = 14
const FAQ_SECTIONS_MAX = 12
const FAQ_ITEMS_MAX    = 30
const STATS_MAX        = 10
const SERIALIZED_MAX   = 300_000

// Allowlist of top-level keys POST may write. Anything else is dropped
// — previously `{ ...current, ...body }` let admin merge any key in,
// polluting the file with arbitrary properties.
const SECTIONS = [
  'stats', 'home', 'about', 'why', 'get_involved', 'advertise',
  'week', 'faq', 'events', 'clubs', 'members', 'neighborhoods',
] as const
type Section = (typeof SECTIONS)[number]

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

interface HeroBlock { headline?: string; subtitle?: string; badge?: string }
interface ContentValue {
  stats?:        Array<{ value: string; label: string }>
  home?:         { headline: string; subtitle: string }
  about?:        { headline: string; subtitle: string; story_p1: string; story_p2: string; story_p3: string }
  why?:          { headline: string; tagline: string; subtitle: string; closing: string }
  get_involved?: { headline: string; subtitle: string }
  advertise?:    { headline: string; subtitle: string }
  week?:         Array<{ day: string; short: string; emoji: string; event: string; desc: string }>
  faq?:          Array<{ id: string; icon: string; title: string; items: Array<{ q: string; a: string }> }>
  events?:        HeroBlock
  clubs?:         HeroBlock
  members?:       HeroBlock
  neighborhoods?: HeroBlock
}

// Normalize a single section into a known-good shape. Returns `skip`
// when the incoming key isn't allowlisted; per-field validation caps
// every string and bounds every array.
function normalizeSection(key: string, raw: unknown):
  | { ok: true; value: unknown }
  | { ok: false; error: string }
  | { skip: true }
{
  if (!(SECTIONS as readonly string[]).includes(key)) return { skip: true }
  const r = (raw ?? {}) as Record<string, unknown>

  if (key === 'stats') {
    if (!Array.isArray(raw)) return { ok: false, error: 'stats must be an array' }
    if (raw.length > STATS_MAX) return { ok: false, error: `stats max ${STATS_MAX}` }
    return { ok: true, value: raw.map((s: unknown) => {
      const o = (s ?? {}) as Record<string, unknown>
      return { value: str(o.value, STAT_FIELD_MAX), label: str(o.label, STAT_FIELD_MAX) }
    }) }
  }

  if (key === 'week') {
    if (!Array.isArray(raw)) return { ok: false, error: 'week must be an array' }
    if (raw.length > WEEK_LEN_MAX) return { ok: false, error: `week max ${WEEK_LEN_MAX}` }
    return { ok: true, value: raw.map((d: unknown) => {
      const o = (d ?? {}) as Record<string, unknown>
      return {
        day:   str(o.day,   DAY_MAX),
        short: str(o.short, DAY_MAX),
        emoji: str(o.emoji, EMOJI_MAX),
        event: str(o.event, EVENT_MAX),
        desc:  str(o.desc,  DESC_MAX),
      }
    }) }
  }

  if (key === 'faq') {
    if (!Array.isArray(raw)) return { ok: false, error: 'faq must be an array' }
    if (raw.length > FAQ_SECTIONS_MAX) return { ok: false, error: `faq sections max ${FAQ_SECTIONS_MAX}` }
    const sections: Array<{ id: string; icon: string; title: string; items: Array<{ q: string; a: string }> }> = []
    for (const sec of raw) {
      const s = (sec ?? {}) as Record<string, unknown>
      const items = Array.isArray(s.items) ? s.items : []
      if (items.length > FAQ_ITEMS_MAX) return { ok: false, error: `faq items max ${FAQ_ITEMS_MAX} per section` }
      sections.push({
        id:    str(s.id,    FAQ_ID_MAX),
        icon:  str(s.icon,  FAQ_ICON_MAX),
        title: str(s.title, FAQ_TITLE_MAX),
        items: items.map((it: unknown) => {
          const o = (it ?? {}) as Record<string, unknown>
          return { q: str(o.q, FAQ_Q_MAX), a: str(o.a, FAQ_A_MAX) }
        }),
      })
    }
    return { ok: true, value: sections }
  }

  // Hero-style sections — headline/subtitle/badge with per-section
  // additions for `about` (story paragraphs) and `why` (tagline/closing).
  if (key === 'about') {
    return { ok: true, value: {
      headline: str(r.headline, HEADLINE_MAX),
      subtitle: str(r.subtitle, SUBTITLE_MAX),
      story_p1: str(r.story_p1, STORY_MAX),
      story_p2: str(r.story_p2, STORY_MAX),
      story_p3: str(r.story_p3, STORY_MAX),
    } }
  }
  if (key === 'why') {
    return { ok: true, value: {
      headline: str(r.headline, HEADLINE_MAX),
      tagline:  str(r.tagline,  TAGLINE_MAX),
      subtitle: str(r.subtitle, SUBTITLE_MAX),
      closing:  str(r.closing,  CLOSING_MAX),
    } }
  }
  // home, get_involved, advertise, events, clubs, members, neighborhoods
  return { ok: true, value: {
    headline: str(r.headline, HEADLINE_MAX),
    subtitle: str(r.subtitle, SUBTITLE_MAX),
    badge:    str(r.badge,    BADGE_MAX),
  } }
}

function read(): ContentValue {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}

export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // `live` is what the database actually says right now. The editor renders it
  // next to each stat field so an editorial number is a deliberate choice
  // rather than a figure nobody has rechecked in a year.
  const live = await getCommunityStats()
  return NextResponse.json({ ...read(), live })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // Normalize every section the caller sent. Anything outside SECTIONS
  // is dropped — previously the route did `{ ...current, ...body }` and
  // would happily merge arbitrary keys into the JSON file.
  const current = read()
  const updated: ContentValue = { ...current }
  const touched: Section[] = []
  for (const [key, val] of Object.entries(body as Record<string, unknown>)) {
    const result = normalizeSection(key, val)
    if ('skip' in result && result.skip) continue
    if ('ok' in result && !result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    if ('ok' in result && result.ok) {
      ;(updated as Record<string, unknown>)[key] = result.value
      touched.push(key as Section)
    }
  }

  if (touched.length === 0) {
    return NextResponse.json({ error: 'No valid section to update' }, { status: 400 })
  }

  const serialized = JSON.stringify(updated, null, 2)
  if (serialized.length > SERIALIZED_MAX) {
    return NextResponse.json({ error: 'Content file too large — trim a few sections' }, { status: 400 })
  }

  // Atomic write so a concurrent GET can never read a half-written
  // file. Previously a direct writeFileSync could race readers.
  const tmp = `${FILE}.tmp`
  fs.writeFileSync(tmp, serialized)
  fs.renameSync(tmp, FILE)

  writeAudit(session.id, session.name, 'content.update', touched.join(','), 'content',
    { sections: touched },
    `Updated content section${touched.length === 1 ? '' : 's'}: ${touched.join(', ')}`,
  )

  return NextResponse.json({ ok: true, updatedSections: touched })
}
