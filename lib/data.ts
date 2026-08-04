// Istanbul neighborhoods have a SINGLE source of truth: NEIGHBORHOOD_META in
// lib/neighborhoods.ts. The name list is derived from its keys (see there), so
// the picker list and the directory/search can never drift — a neighborhood
// exists iff it has a META entry. Re-exported here for the many callers that
// import ISTANBUL_NEIGHBORHOODS from '@/lib/data'.
export { ISTANBUL_NEIGHBORHOODS } from './neighborhoods'

export const CLUB_CATEGORIES = [
  'Outdoor', 'Social', 'Food & Drinks', 'Nightlife', 'Networking', 'Business',
  'Professional', 'Technology', 'Creative', 'Wellness', 'Sports',
  'Travel', 'Culture', 'Language', 'Exclusive', 'Volunteering',
] as const

export type ClubCategory = typeof CLUB_CATEGORIES[number]

// Structured tags for VisitorAnnouncement (the "I'm visiting Istanbul"
// posts on /visiting) — single-select traveler type + multi-select "what
// are you looking for", both fixed lists so they render as consistent
// pills instead of free text. languages stays free text (no fixed list).
// These answer "What brings you to Istanbul?" — purpose of the trip, not
// traveler archetype. Safe to have been reshaped: when this list changed no
// stored row used any of the previous values, so nothing was orphaned.
export const VISITOR_TRAVELER_TYPES = [
  { value: 'vacation',         label: 'Vacation'           },
  { value: 'nomad',            label: 'Digital nomad'      },
  { value: 'business',         label: 'Business'           },
  { value: 'visiting_friends', label: 'Visiting friends'   },
  { value: 'relocating',       label: 'Moving to Istanbul' },
  { value: 'exploring',        label: 'Just exploring'     },
] as const

export const VISITOR_LOOKING_FOR = [
  { value: 'coffee',            label: 'Coffee',            emoji: '☕' },
  { value: 'food',              label: 'Food',              emoji: '🍽️' },
  { value: 'drinks',            label: 'Drinks',            emoji: '🍸' },
  { value: 'live_music',        label: 'Live Music',        emoji: '🎶' },
  { value: 'sailing',           label: 'Sailing',           emoji: '⛵' },
  { value: 'culture',           label: 'Culture',           emoji: '🏛️' },
  { value: 'exploring',         label: 'Exploring',         emoji: '🚶' },
  { value: 'networking',        label: 'Networking',        emoji: '💼' },
  { value: 'events',            label: 'Events',            emoji: '🎉' },
  { value: 'language_exchange', label: 'Language Exchange', emoji: '🗣️' },
] as const

// Who can see a posted visit. 'members' (the default) keeps the card off
// the public, logged-out page entirely; 'public' also lists it for guests
// with contact details redacted, same as every other public surface.
export const VISITOR_VISIBILITY = [
  { value: 'members', label: 'Only Smileys members', hint: 'Your visit stays off the public web.' },
  { value: 'public',  label: 'Anyone browsing Smileys', hint: 'Also listed publicly — contact details stay hidden.' },
] as const
export type VisitorVisibility = typeof VISITOR_VISIBILITY[number]['value']

export type VisitorTravelerType = typeof VISITOR_TRAVELER_TYPES[number]['value']
export type VisitorLookingFor   = typeof VISITOR_LOOKING_FOR[number]['value']

// Tiny amber-100 SVG — used as blur placeholder for all dynamic images
export const BLUR_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSI2Ij48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmVmM2M3Ii8+PC9zdmc+'

export function resolveImageUrl(url: string | null | undefined): string {
  if (!url) return ''
  if (url.startsWith('/uploads/'))   return `/app/api/files/${url.replace('/uploads/', '')}`
  if (url.startsWith('/api/files/')) return `/app${url}`
  return url
}

// Sized variant for avatars / small icons. The file route (see
// app/api/files/[...path]/route.ts) accepts `?w=64|128|256` and
// returns a sharp-resized JPEG. Original 1200×1200 uploads are
// ~150–300 KB; the 64-wide thumb is ~2–4 KB. Falls through to the
// original URL when the source is external (Unsplash, etc.) —
// those already use their own optimization.
const SIZED_PATH = /^\/app\/api\/files\//
export function avatarUrl(url: string | null | undefined, size: 64 | 96 | 128 | 256 = 64): string {
  const resolved = resolveImageUrl(url)
  if (!resolved || !SIZED_PATH.test(resolved)) return resolved
  return `${resolved}?w=${size}`
}

export interface Club {
  id: string
  slug: string
  name: string
  description: string
  category: string
  memberCount: number
  emoji: string
  color: string
  bgColor: string
  isPrivate?: boolean
  coverImage?: string | null
  coverImagePosition?: number
  whatsappUrl?: string | null
  instagramUrl?: string | null
  // Club-specific house rules — surfaced on the public club page
  // beneath the community-wide rules from settings.json. Editable
  // in /admin/clubs/[id].
  rules?: string | null
  // Spotlight = a featured member chosen by the club host. Surfaced
  // on the club page as a profile callout. Three columns persist
  // independently so the host can edit the note without changing who
  // is spotlighted. Date is preserved verbatim from the DB — server-
  // rendered pages format it; client code that JSON-round-trips it
  // will see an ISO string.
  spotlightUserId?: string | null
  spotlightNote?: string | null
  spotlightUpdatedAt?: Date | string | null
  nextEvent?: { title: string; date: string } | null
}

export interface Event {
  id: string
  title: string
  date: string
  time: string
  location: string
  neighborhood: string
  hostId: string
  hostName: string
  hostColor?: string
  hostPhoto?: string | null
  clubId: string
  clubName: string
  description: string
  limitedSpots: boolean
  spotsLeft: number
  totalSpots: number
  // Populated by getEvents for sold-out events only — waitlist demand
  // shown on the card's "Join waitlist" CTA. Absent elsewhere.
  waitlistCount?: number
  price: number
  tags: string[]
  vibes: VibeTag[]
  emoji: string
  isPremium: boolean
  membersOnly: boolean
  intent?: 'social' | 'professional'
  memberPrice?: number
  // Who collects the ticket money: 'venue' (pay at the door — default) or
  // 'smileys' (we collect; RSVP creates a payment ledger row).
  payTo?: 'venue' | 'smileys'
  // wa.me link of the person handling advance payments (redacted for guests).
  paymentContact?: string
  // External ticket-purchase URL — venue-paid events only; public (guests included).
  ticketUrl?: string
  whatsappUrl?: string
  currency?: string
  approvalRequired?: boolean
  genderBalance?: boolean
  maleQuota?: number | null
  femaleQuota?: number | null
  turkishMaleQuota?: number | null
  status?: string
  address?: string
  coverImage?: string
  coverImagePosition?: number
  meetingUrl?: string
  lat?: number | null
  lng?: number | null
  duration?: number | null
  minAge?: number | null
  maxAge?: number | null
  language?: string | null
  difficulty?: string | null
  refundPolicy?: string | null
  registrationDeadline?: string | null
  endTime?: string | null
  cancelReason?: string | null
  isRecurring?: boolean
  isFirstTimerFriendly?: boolean
  seriesId?: string | null
  featured?: boolean
  attendeePreviews?: { id: string; name: string; color: string; profilePhoto?: string | null }[]
}

export type VibeGroup = 'Energy' | 'Purpose' | 'Experience'

export type VibeTag =
  | 'Chill' | 'Active' | 'Party' | 'Intimate'
  | 'Social' | 'Networking' | 'Learning' | 'Creative'
  | 'Food' | 'Cultural' | 'Outdoor' | 'Wellness' | 'Adventure'

export const vibeGroups: Record<VibeGroup, { emoji: string; description: string; tags: VibeTag[] }> = {
  Energy: {
    emoji: '⚡',
    description: 'The energy level of the event',
    tags: ['Chill', 'Active', 'Party', 'Intimate'],
  },
  Purpose: {
    emoji: '🎯',
    description: 'Why people come',
    tags: ['Social', 'Networking', 'Learning', 'Creative'],
  },
  Experience: {
    emoji: '✨',
    description: 'What the event is about',
    tags: ['Food', 'Cultural', 'Outdoor', 'Wellness', 'Adventure'],
  },
}

export const vibeConfig: Record<VibeTag, { emoji: string; bg: string; text: string; border: string; description: string }> = {
  Chill:      { emoji: '😌', bg: 'bg-teal-100',    text: 'text-teal-700',    border: 'border-teal-400',    description: 'Low-key, relaxed atmosphere' },
  Active:     { emoji: '🏃', bg: 'bg-green-100',   text: 'text-green-700',   border: 'border-green-400',   description: 'Move your body, outdoor adventures' },
  Party:      { emoji: '🎊', bg: 'bg-pink-100',    text: 'text-pink-700',    border: 'border-pink-400',    description: 'High energy, music, dancing' },
  Intimate:   { emoji: '🕯️', bg: 'bg-red-50',      text: 'text-red-700',     border: 'border-red-300',     description: 'Small group, deep connections' },
  Social:     { emoji: '🙌', bg: 'bg-blue-100',    text: 'text-blue-700',    border: 'border-blue-400',    description: 'Meet new people, great conversations' },
  Networking: { emoji: '🤝', bg: 'bg-indigo-100',  text: 'text-indigo-700',  border: 'border-indigo-400',  description: 'Career connections, meaningful encounters' },
  Learning:   { emoji: '📚', bg: 'bg-sky-100',     text: 'text-sky-700',     border: 'border-sky-400',     description: 'Grow your mind, share knowledge' },
  Creative:   { emoji: '🎨', bg: 'bg-fuchsia-100', text: 'text-fuchsia-700', border: 'border-fuchsia-400', description: 'Make, build, and express yourself' },
  Food:       { emoji: '🍽️', bg: 'bg-orange-100',  text: 'text-orange-700',  border: 'border-orange-400',  description: 'Good food, great company' },
  Cultural:   { emoji: '🎭', bg: 'bg-rose-100',    text: 'text-rose-700',    border: 'border-rose-400',    description: 'Art, heritage, and local culture' },
  Outdoor:    { emoji: '🌿', bg: 'bg-lime-100',    text: 'text-lime-700',    border: 'border-lime-400',    description: 'Fresh air, nature, open spaces' },
  Wellness:   { emoji: '🧘', bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-400', description: 'Mind, body, and soul balance' },
  Adventure:  { emoji: '🧗', bg: 'bg-stone-100',   text: 'text-stone-700',   border: 'border-stone-400',   description: 'Thrilling, bold, out of comfort zone' },
}

export interface Review {
  id: string
  userId: string
  userName: string
  userInitials: string
  userColor: string
  userPhoto?: string | null
  rating: number
  text: string
  createdAt: string
}

export function todayIstanbul(offsetDays = 0): string {
  const d = new Date()
  if (offsetDays) d.setDate(d.getDate() + offsetDays)
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })
}

// One rendering for money everywhere: symbol-prefixed for known currencies
// ("\u20ba100", "$100"), code-suffixed otherwise ("100 CHF"). Cards used to
// hardcode \u20ba while the detail page wrote "100 TRY" for the same event.
const CURRENCY_SYMBOLS: Record<string, string> = { TRY: '\u20ba', USD: '$', EUR: '\u20ac', GBP: '\u00a3' }
export function formatPrice(price: number, currency?: string | null): string {
  const cur = currency || 'TRY'
  const sym = CURRENCY_SYMBOLS[cur]
  return sym ? `${sym}${price}` : `${price} ${cur}`
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export function formatShortDate(dateStr: string): string {
  // Accept either YYYY-MM-DD (anchored to local midnight so a UTC
  // date doesn't render as the previous day in negative timezones)
  // or a full ISO timestamp (used as-is). Pre-existing callers all
  // pass YYYY-MM-DD; the ISO path is for things like Post.createdAt.
  const date = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatTime(timeStr: string): string {
  const match12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (match12) {
    let h = parseInt(match12[1])
    const m = match12[2]
    const period = match12[3].toUpperCase()
    if (period === 'PM' && h !== 12) h += 12
    if (period === 'AM' && h === 12) h = 0
    return `${String(h).padStart(2, '0')}:${m}`
  }
  const match24 = timeStr.match(/^(\d{1,2}):(\d{2})/)
  if (match24) return `${match24[1].padStart(2, '0')}:${match24[2]}`
  return timeStr
}

export function getInitials(name: string): string {
  return name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

// Event titles often arrive with the emoji typed into the title as well
// ("💬 Let's Get Social" alongside emoji 💬). Every surface renders the
// emoji field next to the title, so a leading emoji in the title always
// displays doubled. Pull it off the title and hand it back separately so
// callers can use it as the emoji-field fallback instead of losing it.
// Handles ZWJ sequences, variation selectors and skin tones (🧘‍♀️, ⛵️).
// A title that is nothing but emoji is returned unchanged.
const LEADING_EMOJI = /^(?:(?:\p{Extended_Pictographic}|\p{Emoji_Modifier})[\uFE0F\u200D]*)+/u
export function splitLeadingEmoji(raw: string): { emoji: string | null; title: string } {
  const trimmed = raw.trim()
  const match = trimmed.match(LEADING_EMOJI)
  if (!match) return { emoji: null, title: trimmed }
  const rest = trimmed.slice(match[0].length).trim()
  if (!rest) return { emoji: null, title: trimmed }
  return { emoji: match[0], title: rest }
}

// Trailing twin of splitLeadingEmoji: a title ending in the same emoji
// as the emoji field ("Let's Get Social" + a trailing speech balloon,
// with the field set to the same balloon) doubles at the other end.
// Strips the trailing run only when it duplicates the emoji field,
// compared with variation selectors (U+FE0F) removed so the sailboat
// with and without VS16 count as the same emoji - a different trailing
// emoji is deliberate decoration and stays.
const TRAILING_EMOJI = /(?:(?:\p{Extended_Pictographic}|\p{Emoji_Modifier})[\uFE0F\u200D]*)+$/u
export function stripDupTrailingEmoji(raw: string, emoji: string | null | undefined): string {
  const trimmed = raw.trim()
  if (!emoji) return trimmed
  const match = trimmed.match(TRAILING_EMOJI)
  if (!match) return trimmed
  const norm = (s: string) => s.replace(/\uFE0F/g, '')
  if (norm(match[0]) !== norm(emoji.trim())) return trimmed
  const rest = trimmed.slice(0, trimmed.length - match[0].length).trim()
  return rest || trimmed
}

const TURKISH_NATIONALITIES = new Set(['turkey', 'türkiye', 'turkiye', 'tr', 'turkish'])

// WhatsApp URL with smarter country-code handling than the old
// `.replace(/^0/, '90')` shortcut, which mangled local-format phones from
// non-Turkish users (e.g. a French `0123456789` became `90123456789`).
// `05xxxxxxxxx` (11 digits) is a Turkish mobile regardless of nationality —
// foreign members living here have Turkish SIMs (French local mobiles are
// 10 digits, so they can't collide). `00`-prefixed numbers are already
// international; wa.me just doesn't accept the `00`.
export function whatsappUrl(phone: string | null | undefined, nationality?: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  const isTurkish = nationality
    ? TURKISH_NATIONALITIES.has(nationality.trim().toLowerCase())
    : false
  const normalized = digits.startsWith('00')
    ? digits.slice(2)
    : (digits.length === 11 && digits.startsWith('05'))
      ? '9' + digits
      : (digits.startsWith('0') && isTurkish)
        ? '90' + digits.slice(1)
        : digits
  return `https://wa.me/${normalized}`
}

/**
 * Normalise a human name for consistent display: trim, collapse internal
 * whitespace, and capitalise the first letter of each word (sub-tokens
 * split on hyphen / apostrophe handled too, so "al khazraji" →
 * "Al Khazraji" and "o'brien" → "O'Brien").
 *
 * Deliberately conservative: it ONLY upper-cases a leading lowercase
 * letter and NEVER force-lowercases the rest of a token. That preserves
 * intentional casing ("McKenzie", initials like "R.G", İbrahim) and — the
 * reason this matters here — avoids the Turkish dotted/dotless-i pitfall.
 * The community mixes Turkish and Latin names, and there is no single
 * locale that can safely lower-case an ALL-CAPS name for both (Turkish
 * rules mangle "OPPI"→"oppı", default rules mangle "KAYIŞ"→"kayiş"). So
 * ALL-CAPS tokens are left untouched and must be cleaned up by hand.
 */
export function formatName(name: string): string {
  const fixToken = (tok: string): string => {
    if (!tok || tok === '-' || tok === "'") return tok
    const first = tok[0]
    // Only act when the first char is a lowercase letter; leave the rest as-is.
    if (first === first.toLowerCase() && first !== first.toUpperCase()) {
      return first.toUpperCase() + tok.slice(1)
    }
    return tok
  }
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(word => word.split(/([-'])/).map(fixToken).join(''))
    .join(' ')
}

/**
 * The stronger cleanup formatName deliberately refuses to do: de-shout
 * ALL-CAPS words ("Burak YİĞİTGÜLSÜN" → "Burak Yiğitgülsün"). Safe here —
 * unlike formatName — because the caller supplies the member's nationality,
 * which resolves the Turkish dotted/dotless-i ambiguity ("YILMAZ" is
 * "Yılmaz" for a Turkish member but "Yilmaz" under default rules).
 *
 * Words of 1–3 letters are left as typed even when all-caps: members use
 * deliberate initials as privacy surnames ("Nina AE", "Naz MDT"), and at
 * that length there's no telling initials from a shouted name. Exception:
 * when the name also contains a shouted word of 4+ letters, the whole name
 * was evidently typed in caps-lock, so short all-caps words are de-shouted
 * with it ("Phuong NGO NGOC" → "Phuong Ngo Ngoc").
 *
 * Used by the nightly name-hygiene sweeper (app/api/cron/sweep-name-hygiene),
 * not on the write path.
 */
export function fixNameCasing(name: string, nationality?: string | null): string {
  const locale = nationality === 'Turkey' ? 'tr-TR' : undefined
  const lower  = (s: string) => locale ? s.toLocaleLowerCase(locale) : s.toLowerCase()
  const upper  = (s: string) => locale ? s.toLocaleUpperCase(locale) : s.toUpperCase()

  const words = name.trim().replace(/\s+/g, ' ').split(' ')
  const lettersOf  = (word: string) => word.replace(/[-'.]/g, '')
  const allCaps    = (s: string) => s === upper(s) && s !== lower(s)
  // Caps-lock context: one shouted word of 4+ letters means the short
  // all-caps words next to it are shoutings too, not initials.
  const capsLocked = words.some(w => lettersOf(w).length >= 4 && allCaps(lettersOf(w)))
  const minLen     = capsLocked ? 2 : 4

  const deshouted = words
    .map(word => {
      const letters = lettersOf(word)
      if (letters.length < minLen || !allCaps(letters)) return word
      return word
        .split(/([-'])/)
        .map(tok => {
          if (!tok || tok === '-' || tok === "'") return tok
          const rest = lower(tok)
          return upper(rest[0]) + rest.slice(1)
        })
        .join('')
    })
    .join(' ')

  // formatName still runs last for the lowercase-first-letter fixes.
  return formatName(deshouted)
}
