// Pure logic for scripts/fill-directory-listings.ts: what counts as an empty
// field, how research turns into a row patch, and how a venue's own website
// yields a cover photo. No prisma, no fetch, no fs — everything here is unit
// tested in tests/directoryFill.test.ts, and the script does the I/O.
//
// The directory makes a checkable factual promise (this place exists, here,
// is open, has this website), so a model's research is treated as CLAIMS.
// Every claim passes the same validator the admin form uses (parseHours,
// normalizeInstagramHandle, DIRECTORY_LIMITS) and the website additionally
// has to answer over HTTPS before it is stored — the script checks that and
// passes the verdict in as `websiteOk`.

import { DIRECTORY_LIMITS, normalizeInstagramHandle, normalizeTags } from './directory-constants'
import { parseHours, DAY_KEYS, type BusinessHours } from './businessHours'
import { isSafeHref } from './safeUrl'
import { dialCode } from './country'

/** What the researcher returns for one venue (the JSON schema in the script). */
export interface VenueResearch {
  found: boolean
  is_business: boolean
  permanently_closed: boolean
  description: string | null
  website: string | null
  instagram: string | null
  phone: string | null
  address: string | null
  hours: Record<string, string | null> | null
  hours_confident: boolean
  languages: string | null
  tags: string[]
  sources: string[]
  notes: string
}

/** The columns the fill can touch, as read from the row. */
export interface FillableRow {
  name: string
  description: string
  website: string | null
  instagram: string | null
  phone: string | null
  address: string | null
  hours: unknown
  languages: string | null
  tags: string[]
  coverImage: string | null
}

export interface FillOptions {
  /** Replace non-empty values too (default: only fill what is empty). */
  overwrite?: boolean
  /** The script's verdict on the researched website: it answered over HTTPS. */
  websiteOk?: boolean
  /** Neighbourhood + city of the row: never useful as tags, the card shows them. */
  placeNames?: (string | null | undefined)[]
  /** ISO country of the row's city — phone numbers are normalised for TR. */
  country?: string
  /** The researched website turned out to be another venue's (a same-named
   *  brand abroad): its social handles are that venue's too, so skip them. */
  wrongVenue?: boolean
}

export interface FillPatch {
  description?: string
  website?: string
  instagram?: string
  phone?: string
  address?: string
  hours?: BusinessHours
  languages?: string
  tags?: string[]
}

export interface FillPlan {
  patch: FillPatch
  /** Field → why it was not written. Reported, so a dry run explains itself. */
  skipped: Record<string, string>
}

// A description shorter than this is a label, not a description.
export const THIN_DESCRIPTION = 60

// The factual placeholders earlier imports wrote so a row could exist before
// anyone described the venue (scripts/import-event-venues.ts,
// scripts/seed-city-places.ts, lib/eventVenue). They are filled, not kept.
const PLACEHOLDER_RE = /Community venue\s*[—-]|Pending review|Awaiting an editorial description|has hosted \d+ Smileys event|regular for the Smileys community/i
// The since-fact, in either the placeholder's clause form or the closing
// sentence composeDescription appends.
const SINCE_RE = /,?\s*hosting Smileys events? since [A-Z][a-z]+ \d{4}\.?/gi

/**
 * A description that is only a placeholder, judged WITHOUT the since-fact:
 * "Sunset sailing cruises from Kalamış Marina, hosting Smileys events since
 * May 2026." is a label plus the fact (a placeholder), while a real
 * description that ends "Hosting Smileys events since May 2026." is not.
 * Counting the fact itself made every filled description look empty again,
 * so a second run would have rewritten all of them.
 */
export function isPlaceholderDescription(desc: string | null | undefined): boolean {
  if (!desc) return true
  const d = desc.trim()
  if (PLACEHOLDER_RE.test(d)) return true
  return d.replace(SINCE_RE, '').trim().length < THIN_DESCRIPTION
}

// "…hosting Smileys events since July 2026." is the one fact in a placeholder
// worth keeping: it is true, it is ours, and it tells a member this is a
// place the community actually uses. Kept as the closing sentence.
export function smileysSinceSentence(desc: string | null | undefined): string | null {
  if (!desc) return null
  const m = desc.match(/Smileys events? since ([A-Z][a-z]+ \d{4})/)
  return m ? `Hosting Smileys events since ${m[1]}.` : null
}

const empty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim())
  || (Array.isArray(v) && v.length === 0)

function clean(v: string | null | undefined, max: number): string | null {
  if (!v) return null
  const s = v.replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

// Model prose, made safe for the card: single paragraph, no emoji, no
// trailing hype punctuation, capped like the admin form. The since-sentence
// is appended when the previous description carried one and the new one
// doesn't already say it.
export function composeDescription(generated: string | null | undefined, existing: string): string | null {
  let d = clean(generated, DIRECTORY_LIMITS.description)
  if (!d) return null
  d = d.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim()
  d = d.replace(/!+/g, '.')
  if (!/[.!?]$/.test(d)) d += '.'
  const since = smileysSinceSentence(existing)
  if (since && !/Smileys events since/i.test(d)) {
    d = `${d} ${since}`.slice(0, DIRECTORY_LIMITS.description)
  }
  return d
}

// A website claim, normalised to what the row may store. Returns null when
// the claim is not a website at all (a social profile — Instagram goes into
// its own column, Facebook is not a website we link) or can't be made https.
export function normalizeWebsiteClaim(raw: string | null | undefined): string | null {
  const s = clean(raw, DIRECTORY_LIMITS.website)
  if (!s) return null
  let url = /^[a-z]+:\/\//i.test(s) ? s : `https://${s}`
  url = url.replace(/^http:\/\//i, 'https://')
  let host: string
  try { host = new URL(url).hostname.toLowerCase() } catch { return null }
  if (/(^|\.)(instagram|facebook|fb|tiktok|x|twitter|google|goo|linktr|wa)\.(com|me|gl)$/.test(host)) return null
  if (!isSafeHref(url)) return null
  return url
}

// An Instagram handle from wherever the model found it — a handle, an @handle
// or a profile URL — or, failing that, from a website claim that was really
// an Instagram link.
export function instagramFromClaims(instagram: string | null | undefined, website: string | null | undefined): string | null {
  const direct = normalizeInstagramHandle(instagram ?? undefined)
  if (direct) return direct
  if (website && /instagram\.com\//i.test(website)) return normalizeInstagramHandle(website)
  return null
}

const GENERATED_TAG_MAX = 5
// The tag staff and venue imports set as a signal, not a description (lowercased).
const STAFF_SIGNAL_TAGS = new Set(['we meet here'])

// Folded for comparison: case, Turkish dotless/dotted i, and diacritics.
const fold = (s: string) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').trim()
// Tags that describe nothing a member can filter on.
// Tags that describe nothing a member can filter on, or that are an opinion
// (and, on a venue that hosts us, sometimes an unflattering one).
const EMPTY_TAGS = new Set([
  'neighbourhood', 'neighborhood', 'local', 'popular', 'restaurant', 'cafe', 'bar', 'venue',
  'authentic', 'casual', 'cozy', 'cosy', 'chain', 'budget', 'cheap', 'mid-range', 'mid-price',
  'affordable', 'upscale', 'trendy', 'hidden gem', 'local clientele', 'community',
])

/**
 * A tag that is really a place: the row's neighbourhood or city, a word of
 * its address ("istiklal", "galataport", "asmali mescit"), or "near X".
 * The card already shows where the venue is; a place tag filters nothing.
 */
export function isPlaceTag(tag: string, placeTexts: (string | null | undefined)[]): boolean {
  const t = fold(tag)
  if (!t) return true
  if (/^(near|in|off)\s/.test(t)) return true
  for (const raw of placeTexts) {
    if (!raw) continue
    const p = fold(raw)
    if (p === t) return true
    // Whole-word containment, so "tea" doesn't match "Tea Garden Sk." but
    // "galataport" matches "Galataport L5 Blok".
    const words = p.split(/[^a-z0-9]+/).filter(Boolean)
    const tagWords = t.split(/[^a-z0-9]+/).filter(Boolean)
    if (tagWords.length && tagWords.every(w => words.includes(w)) && tagWords.join(' ').length >= 4) return true
  }
  return false
}

/**
 * Turn a row + research into the patch to write. Only empty fields are
 * filled unless `overwrite`; a placeholder description counts as empty.
 * Every skipped field carries its reason.
 */
export function buildFillPatch(row: FillableRow, r: VenueResearch, opts: FillOptions = {}): FillPlan {
  const patch: FillPatch = {}
  const skipped: Record<string, string> = {}
  const overwrite = !!opts.overwrite
  const may = (field: keyof FillableRow, isEmpty: boolean): boolean => {
    if (isEmpty || overwrite) return true
    skipped[field] = 'already set (use --overwrite)'
    return false
  }

  if (!r.found) {
    return { patch, skipped: { all: 'venue not found online' } }
  }

  // description
  if (may('description', isPlaceholderDescription(row.description))) {
    const d = composeDescription(r.description, row.description)
    if (d && d.length >= THIN_DESCRIPTION) patch.description = d
    else if (d) skipped.description = `researched text too short (${d.length} chars)`
    else skipped.description = 'no description researched'
  }

  // website — stored only when it is a real website AND it answered
  if (may('website', empty(row.website))) {
    const w = normalizeWebsiteClaim(r.website)
    if (!w) { if (r.website) skipped.website = `not a website we store (${r.website})` }
    else if (opts.websiteOk === false) skipped.website = `${w} did not respond`
    else if (opts.websiteOk === undefined) skipped.website = `${w} not checked`
    else if (w !== row.website) patch.website = w
  }

  // instagram
  if (may('instagram', empty(row.instagram))) {
    const h = instagramFromClaims(r.instagram, r.website)
    if (h && opts.wrongVenue) skipped.instagram = `@${h} came with another venue's website`
    else if (h) { if (h !== row.instagram) patch.instagram = h }
    else if (r.instagram) skipped.instagram = `invalid handle (${r.instagram})`
  }

  // phone / address / languages — plain strings, capped
  if (may('phone', empty(row.phone))) {
    const p = normalizePhone(r.phone, opts.country)
    if (p) { if (p !== row.phone) patch.phone = p }
    else if (r.phone) skipped.phone = `does not look like a phone number (${r.phone})`
  }
  if (may('address', empty(row.address))) {
    const a = clean(r.address, DIRECTORY_LIMITS.address)
    if (a && a !== row.address) patch.address = a
  }
  if (may('languages', empty(row.languages))) {
    const l = clean(r.languages, DIRECTORY_LIMITS.languages)
    if (l && l !== row.languages) patch.languages = l
  }

  // hours — only when the model is confident, and only in the exact shape
  // the open-now badge reads. A wrong closing time sends someone to a locked
  // door, so "unsure" means "leave empty".
  if (may('hours', empty(row.hours) || (typeof row.hours === 'object' && row.hours !== null && Object.keys(row.hours as object).length === 0))) {
    if (r.hours && r.hours_confident) {
      const input: Record<string, string | null> = {}
      for (const d of DAY_KEYS) {
        const v = r.hours[d]
        // "10:00-24:00" is how listings write midnight; the hours field takes
        // 23:59 for a late close (lib/businessHours).
        input[d] = typeof v === 'string' && /closed/i.test(v) ? null
          : typeof v === 'string' ? v.trim().replace(/-24:00$/, '-23:59')
          : null
      }
      const parsed = parseHours(input)
      if ('error' in parsed) skipped.hours = parsed.error
      else if (parsed.hours && Object.values(parsed.hours).some(v => v)) patch.hours = parsed.hours
      else skipped.hours = 'no open day in researched hours'
    } else if (r.hours) {
      skipped.hours = 'researcher not confident'
    }
  }

  // tags — filled like every other field: only while the row has nothing
  // but the staff signal ("We meet here" — kept, never
  // removed). A union on every run piled up near-duplicates ("cafe bar",
  // "cafe-bar", "live performance(s)") each time the script ran.
  const descriptiveTags = row.tags.filter(t => !STAFF_SIGNAL_TAGS.has(t.toLowerCase()))
  const placeTexts = [...(opts.placeNames ?? []), row.address, r.address]
  const generated = (r.tags ?? [])
    .map(t => t.toLocaleLowerCase('en').trim())
    .filter(t => t && !isPlaceTag(t, placeTexts) && !EMPTY_TAGS.has(fold(t)))
    .slice(0, GENERATED_TAG_MAX)
  if (generated.length && descriptiveTags.length && !overwrite) {
    skipped.tags = 'already set (use --overwrite)'
  } else if (generated.length) {
    const existingLower = new Set(row.tags.map(t => t.toLowerCase()))
    const fresh = generated.filter(t => !existingLower.has(t))
    if (fresh.length) {
      const merged = normalizeTags([...row.tags, ...fresh])
      if (merged && merged.length !== row.tags.length) patch.tags = merged
    }
  }

  return { patch, skipped }
}

// ── Sources + website checks ────────────────────────────────────────────────

/**
 * Research sources as plain, clean URLs for the log and the audit row:
 * unwraps markdown "([label](url))", drops utm_* tracking, and drops our own
 * site — a listing citing the Smileys directory as evidence is circular.
 */
export function cleanSources(sources: string[] | null | undefined): string[] {
  const out: string[] = []
  for (const raw of sources ?? []) {
    const m = raw.match(/\]\((https?:\/\/[^)\s]+)\)/) ?? raw.match(/(https?:\/\/\S+)/)
    if (!m) continue
    let u: URL
    try { u = new URL(m[1]) } catch { continue }
    if (/(^|\.)smileyscommunity\.com$/i.test(u.hostname)) continue
    for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k)
    const s = u.toString().replace(/\?$/, '')
    if (!out.includes(s)) out.push(s)
  }
  return out
}

/**
 * A phone number as members should see it. Turkish numbers come back from
 * listings in every shape ("(533) 666 68 26", a dial code followed by a
 * trunk 0, "(850) 307 7109"); they are all rewritten to the country's dial
 * code (lib/country) + "XXX XXX XX XX". Other countries keep the published
 * form, whitespace-tidied.
 */
export function normalizePhone(raw: string | null | undefined, country?: string): string | null {
  const p = clean(raw, DIRECTORY_LIMITS.phone)
  if (!p) return null
  let digits = p.replace(/\D/g, '')
  if (digits.length < 7) return null
  if ((country ?? '').toUpperCase() === 'TR') {
    const cc = dialCode(country).replace(/\D/g, '')
    if (cc && digits.startsWith(cc) && digits.length >= 10 + cc.length) digits = digits.slice(cc.length)
    if (digits.startsWith('0')) digits = digits.slice(1)
    if (digits.length !== 10) return null
    return `${dialCode(country)} ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8)}`
  }
  return p
}

// The brand part of a hostname: "www.musafirindian.com.tr" → "musafirindian".
// Two-part public suffixes (com.tr, co.uk, org.ge…) are stripped as a unit.
function brandOf(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean)
  if (labels.length <= 1) return labels[0] ?? ''
  labels.pop()
  if (labels.length > 1 && /^(com|org|net|gov|edu|co|gen|web|biz|info|av|bel|k12|ac)$/.test(labels[labels.length - 1])) labels.pop()
  return labels[labels.length - 1]
}

/**
 * Whether the page a website link actually lands on is still the venue's
 * site. A redirect to another domain is a parked or sold domain; a landing
 * on a login/admin page (Rock'n Rolla's root does this) is not a page to send
 * a member to.
 */
export function websiteLandingOk(requested: string, finalUrl: string): boolean {
  let a: URL, b: URL
  try { a = new URL(requested); b = new URL(finalUrl) } catch { return false }
  // Same brand under another suffix (.com.tr → .com) or subdomain is the
  // same site; anything else is a parked, sold or unrelated domain.
  if (brandOf(a.hostname) !== brandOf(b.hostname)) return false
  if (/\/(wp-login\.php|wp-admin|admin|login|signin|sign-in|giris|panel)(\/|$|\?)/i.test(b.pathname)) return false
  return true
}

const COUNTRY_NAMES: Record<string, string[]> = {
  TR: ['turkiye', 'turkey', 'türkiye'],
  GE: ['georgia', 'sakartvelo'],
  GR: ['greece', 'ellada', 'hellas'],
  BG: ['bulgaria', 'balgariya'],
  US: ['usa', 'united states'],
}

/**
 * Whether a website's page says anything about where this venue is: its
 * city, neighbourhood or country. The researcher once handed back a
 * same-named café brand's site from another continent for an İstiklal café;
 * that page never says "Istanbul". Crude by design — a miss only means the
 * website is left for a human, never that a wrong one is stored.
 */
export function siteMentionsPlace(
  html: string,
  places: (string | null | undefined)[],
  country?: string,
  url?: string,
  phones: (string | null | undefined)[] = [],
): boolean {
  // A Turkish-registered domain (.tr) is itself evidence for a Turkish city.
  if (url && (country ?? '').toUpperCase() === 'TR') {
    try { if (/\.tr$/i.test(new URL(url).hostname)) return true } catch { /* fall through */ }
  }
  const decoded = decodeForSearch(html)
  const text = fold(decoded)
  const needles = [
    ...places.filter((p): p is string => !!p).map(fold),
    ...(COUNTRY_NAMES[(country ?? '').toUpperCase()] ?? []).map(fold),
  ].filter(n => n.length >= 4)
  if (needles.some(n => text.includes(n))) return true
  // The venue's own phone number on the page ties the site to this venue even
  // when it never names the city (Polo Pastanesi's homepage). Last 7 digits,
  // any separators between them.
  for (const ph of phones) {
    const d = (ph ?? '').replace(/\D/g, '').slice(-7)
    if (d.length === 7 && new RegExp(d.split('').join('[\\s.()\\-]*')).test(decoded)) return true
  }
  return false
}

/**
 * Page source as searchable text: JavaScript escapes ("\u0130stanbul" —
 * Moda Sahnesi's page names its city only inside a script) and HTML
 * entities ("Kad&#305;k&ouml;y") turned back into characters.
 */
export function decodeForSearch(html: string): string {
  const NAMED: Record<string, string> = {
    amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>',
    ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü', ccedil: 'ç', Ccedil: 'Ç',
  }
  return html
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED[n] ?? m)
}

/**
 * Characters of readable text on a page, scripts and styles removed. A site
 * built entirely in JavaScript (Baba Sahne's) serves an empty shell: silence
 * about the city there proves nothing, so it is "can't confirm", not
 * "another venue".
 */
export function visibleTextLength(html: string): number {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim().length
}

export const MIN_READABLE_TEXT = 500

// ── Cover photo from the venue's own site ───────────────────────────────────

/** og:image (or twitter:image) of an HTML page, resolved against its URL. */
export function ogImageFrom(html: string, pageUrl: string): string | null {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? []
  const want = ['og:image:secure_url', 'og:image', 'twitter:image']
  const found: Record<string, string> = {}
  for (const m of metas) {
    const key = m.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase()
    const content = m.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1]
    if (key && content && want.includes(key) && !found[key]) found[key] = content
  }
  for (const k of want) {
    if (!found[k]) continue
    try {
      const u = new URL(found[k].trim(), pageUrl)
      if (u.protocol !== 'https:') continue
      return u.toString()
    } catch { /* next candidate */ }
  }
  return null
}

export const MIN_COVER_PX = 600

// sharp's stats().entropy, measured on 2026-09-28: every real venue photo in
// the directory's uploads scored 6.6–7.8; logo cards and flat graphics
// (But First Coffee's og:image is its logo on flat blue, 1.25) scored under
// 4.3. The size check can't tell those apart; this can.
export const MIN_COVER_ENTROPY = 6

/** A photo, not a logo card: busy enough, and not named as a logo. */
export function coverLooksLikePhoto(imageUrl: string, entropy: number | undefined): boolean {
  if (/logo|favicon|icon|brand[-_]?mark/i.test(imageUrl.split('?')[0])) return false
  // Site-builder share cards are a screenshot of the website — nav bar,
  // buttons and all (Karakoy Afrodit's, 2026-09-28, came from a lovable.app
  // preview). Busy enough to pass the entropy bar, never a venue photo.
  if (/screenshot|lovable\.app|id-preview|\/api\/og\b|opengraph-image|og-image-gen/i.test(imageUrl)) return false
  return typeof entropy === 'number' && entropy >= MIN_COVER_ENTROPY
}

/** A usable hero: wide enough for the card, and not a logo strip or a portrait. */
export function coverDimensionsOk(width: number | undefined, height: number | undefined): boolean {
  if (!width || !height) return false
  if (width < MIN_COVER_PX) return false
  const ratio = width / height
  return ratio >= 0.6 && ratio <= 2.6
}
