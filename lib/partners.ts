// Data behind /partners. Everything here is measured or editorial-by-flag:
// no number is typed into copy, and the two sections that could mislead
// (statistics, case studies) stay out of the page until there is something
// true to put in them.

import { prisma } from './prisma'
import { ACTIVATED_MEMBER_WHERE } from './memberCount'
import { loadContent } from './content'
import { isArticleImageSrc } from './sanitize'

export const PARTNER_CONTACT_EMAIL = process.env.EMAIL_FROM_ADDRESS ?? 'info@smileyscommunity.com'

export const COLLAB_TYPES = [
  { value: 'coverage',   label: 'English-language coverage & guides' },
  { value: 'interview',  label: 'Artist or organizer interview' },
  { value: 'discount',   label: 'Member discount or group offer' },
  { value: 'giveaway',   label: 'Ticket giveaway' },
  { value: 'attendance', label: 'Hosted community attendance' },
  { value: 'business',   label: 'Business-event partnership' },
  { value: 'other',      label: 'Not sure yet' },
] as const
export const COLLAB_LABELS: Record<string, string> = Object.fromEntries(COLLAB_TYPES.map(c => [c.value, c.label]))

/** `source` stamped on SponsorLead rows that come from this page. */
export const PARTNER_LEAD_SOURCE = 'partners'

export interface AudienceStat { label: string; value: number; note: string }
export interface AudienceStats { asOf: string; windowDays: number; stats: AudienceStat[] }

const WINDOW_DAYS = 90

// Three DIFFERENT audiences, never summed: an attendee is also a member, so a
// total would count the same person twice. Social followers are not in our
// data, so they are not shown at all (the admin can't type one in here either).
// Returns null when the admin switched the section off (content.partners.hideStats).
export async function getAudienceStats(): Promise<AudienceStats | null> {
  const cfg = loadContent().partners ?? {}
  if (cfg.hideStats === true) return null

  const [members, rsvp, checkedIn] = await Promise.all([
    prisma.user.count({ where: ACTIVATED_MEMBER_WHERE }),
    // "Date" is text YYYY-MM-DD; the window is measured on the event's day.
    prisma.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT a."userId")::int AS n
      FROM event_attendees a
      JOIN events e ON e.id = a."eventId"
      JOIN users u ON u.id = a."userId"
      WHERE a.status = 'approved' AND u.status = 'approved' AND u.password IS NOT NULL
        AND e."date" >= to_char(now() - make_interval(days => ${WINDOW_DAYS}), 'YYYY-MM-DD')
        AND e."date" <= to_char(now(), 'YYYY-MM-DD')`,
    prisma.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT a."userId")::int AS n
      FROM event_attendees a
      JOIN events e ON e.id = a."eventId"
      JOIN users u ON u.id = a."userId"
      WHERE a.status = 'approved' AND (a."checkedIn" = true OR a.attendance = 'attended')
        AND u.status = 'approved' AND u.password IS NOT NULL
        AND e."date" >= to_char(now() - make_interval(days => ${WINDOW_DAYS}), 'YYYY-MM-DD')
        AND e."date" <= to_char(now(), 'YYYY-MM-DD')`,
  ])
  if (members < 1) return null

  return {
    asOf: new Date().toISOString().slice(0, 10),
    windowDays: WINDOW_DAYS,
    stats: [
      { label: 'Registered members', value: members, note: 'Approved accounts that have been activated, today.' },
      { label: 'Active members', value: rsvp[0]?.n ?? 0, note: `Members with a confirmed spot at an event in the last ${WINDOW_DAYS} days.` },
      { label: 'Event attendees', value: checkedIn[0]?.n ?? 0, note: `Members with a recorded check-in in the last ${WINDOW_DAYS} days. Door check-in is not recorded at every event, so this is a minimum.` },
    ],
  }
}

export interface CoverageCard { slug: string; title: string; excerpt: string | null; coverImage: string | null }

// The three articles Nate named. Matched on the title/slug keyword among
// PUBLISHED community stories, newest first; content.partners.coverageSlugs
// (admin → content) can pin exact slugs instead. A story that isn't published
// simply isn't listed — no invented fallback.
const COVERAGE_KEYWORDS = ['youngr', 'grouper', 'giraud'] as const

export async function getSelectedCoverage(): Promise<CoverageCard[]> {
  const cfg = loadContent().partners ?? {}
  const pinned: string[] = Array.isArray(cfg.coverageSlugs) ? cfg.coverageSlugs.filter((s: unknown) => typeof s === 'string') : []
  const select = { slug: true, title: true, excerpt: true, coverImage: true } as const
  const base = { kind: 'community', status: 'published' } as const

  let rows: CoverageCard[]
  if (pinned.length) {
    const found = await prisma.post.findMany({ where: { ...base, slug: { in: pinned } }, select })
    rows = pinned.map(s => found.find(f => f.slug === s)).filter((r): r is CoverageCard => !!r)
  } else {
    const found = await Promise.all(COVERAGE_KEYWORDS.map(k => prisma.post.findFirst({
      where: { ...base, OR: [{ title: { contains: k, mode: 'insensitive' } }, { slug: { contains: k, mode: 'insensitive' } }] },
      orderBy: { publishedAt: 'desc' },
      select,
    })))
    rows = found.filter((r): r is CoverageCard => !!r)
  }
  // Only our own uploads as images (same rule as the article's og:image).
  return rows.map(r => ({ ...r, coverImage: isArticleImageSrc(r.coverImage) ? r.coverImage : null }))
}

export interface CaseStudy {
  title: string
  organizer: string
  objective: string
  published: string
  channels: string[]
  period: string
  views?: number
  ticketClicks?: number
  redemptions?: number
  attendance?: number
  feedback?: { quote: string; by: string }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
const str = (v: unknown, max = 600) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '')

// Real campaign results, entered by hand into content.partners.caseStudies
// after the numbers exist. An entry is shown only when it is marked
// `verified: true` and has the fields a reader needs to judge it (objective,
// what we published, period). Redemptions/attendance appear only if supplied;
// feedback only with `permission: true`. Empty list → the section is not
// rendered at all.
export function getCaseStudies(): CaseStudy[] {
  const raw = loadContent().partners?.caseStudies
  if (!Array.isArray(raw)) return []
  const out: CaseStudy[] = []
  for (const c of raw) {
    if (!c || c.verified !== true) continue
    const title = str(c.title, 120), organizer = str(c.organizer, 120), objective = str(c.objective), published = str(c.published), period = str(c.period, 80)
    if (!title || !objective || !published || !period) continue
    const fb = c.feedback && c.feedback.permission === true && str(c.feedback.quote) ? { quote: str(c.feedback.quote), by: str(c.feedback.by, 120) } : undefined
    out.push({
      title, organizer, objective, published, period,
      channels: Array.isArray(c.channels) ? c.channels.map((x: unknown) => str(x, 60)).filter(Boolean).slice(0, 8) : [],
      views: num(c.views), ticketClicks: num(c.ticketClicks), redemptions: num(c.redemptions), attendance: num(c.attendance),
      ...(fb ? { feedback: fb } : {}),
    })
  }
  return out
}
