// Read-only loader for data/settings.json — the community-wide
// settings file edited via /admin/settings (name, tagline, contact
// channels, etc.). Use this on server components / route handlers
// that need a stable snapshot of the community identity (the value
// is small and rarely changes, so a per-request file read is fine —
// no caching layer needed).

import { readFileSync } from 'fs'
import { join } from 'path'

export interface CommunityRule {
  icon?: string   // optional single emoji (≤8 chars). Falls back to a
                  // numbered chip in the render when missing.
  title: string   // short headline, ≤60 chars
  body:  string   // 1-2 sentence explanation, ≤280 chars
}

export interface CommunitySettings {
  name?:        string
  tagline?:     string
  description?: string
  email?:       string
  website?:     string
  instagram?:   string  // stored as handle, e.g. "@smileyscommunity"
  whatsapp?:    string  // stored as a WhatsApp channel URL, e.g.
                        // "https://whatsapp.com/channel/0029VaXXXXXX"
  // Community-wide house rules surfaced on every club page above
  // the club's own rules. Structured (icon + title + body per rule)
  // so the renderer can do something better than a wall of text.
  // Capped at 12 rules — past that, nobody reads.
  communityRules?: CommunityRule[]
  // Membership intake switch. false = applications paused (apply page shows a
  // closed notice, the submit API rejects). Undefined/true = open (default).
  applicationsOpen?: boolean
  // Admin email on each new (non-suspicious) application. false = muted.
  // Undefined/true = on (default). Suspicious applications always email.
  newApplicationEmails?: boolean
}

const SETTINGS_PATH = join(process.cwd(), 'data', 'settings.json')

export function loadCommunitySettings(): CommunitySettings {
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) as CommunitySettings & { communityRules?: unknown }
    // Legacy: communityRules used to be a single plain-text blob.
    // If we still see that shape on disk, drop it silently — the
    // admin will re-author in the new structured editor. Avoids
    // showing garbled text on every club page during the migration
    // window.
    if (typeof raw.communityRules === 'string') {
      raw.communityRules = []
    }
    return raw as CommunitySettings
  } catch {
    return {}
  }
}

/** True unless applications have been explicitly paused in /admin/settings. */
export function areApplicationsOpen(): boolean {
  return loadCommunitySettings().applicationsOpen !== false
}

/** True unless admin new-application emails have been muted in /admin/settings. */
export function newApplicationEmailsEnabled(): boolean {
  return loadCommunitySettings().newApplicationEmails !== false
}

/**
 * Convert a stored Instagram handle (e.g. "@smileyscommunity") to a
 * clickable HTTPS URL. Returns null when the handle is missing or
 * fails the IG handle charset check.
 */
export function communityInstagramUrl(handle: string | undefined | null): string | null {
  if (!handle || typeof handle !== 'string') return null
  const h = handle.replace(/^@/, '').trim()
  if (!h) return null
  // Same allowlist used for business directory IG handles.
  if (!/^[A-Za-z0-9._]{1,30}$/.test(h)) return null
  return `https://instagram.com/${h}`
}

/**
 * Validate + normalise a stored WhatsApp channel URL. Accepts the
 * canonical `https://whatsapp.com/channel/...` shape (with or without
 * the `www.` prefix), trims whitespace, and rejects anything else —
 * we deliberately don't fall back to wa.me click-to-chat, since the
 * community surface is a CHANNEL (one-to-many broadcast), not a
 * personal phone number. Returns null when the input is missing,
 * malformed, or pointed at the wrong host.
 */
export function communityWhatsappUrl(url: string | undefined | null): string | null {
  if (!url || typeof url !== 'string') return null
  const trimmed = url.trim()
  if (!trimmed) return null
  let parsed: URL
  try { parsed = new URL(trimmed) } catch { return null }
  if (parsed.protocol !== 'https:') return null
  const host = parsed.hostname.toLowerCase()
  if (host !== 'whatsapp.com' && host !== 'www.whatsapp.com') return null
  if (!parsed.pathname.startsWith('/channel/')) return null
  return parsed.toString()
}

/**
 * Compare two social URLs (Instagram, WhatsApp, anything) for the
 * "same destination" question, ignoring cosmetic differences a human
 * wouldn't notice: protocol, leading `www.`, host case, and a
 * trailing slash on the path. Used to dedupe the community footer's
 * IG/WA icons on club pages when a club admin pasted the community
 * URL (with `www.`) and the community settings serve it without.
 * Plain `===` rejected those as different and rendered the same
 * Instagram twice.
 */
export function sameSocialUrl(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const norm = (u: string): string | null => {
    try {
      const url = new URL(u.trim())
      const host = url.hostname.toLowerCase().replace(/^www\./, '')
      // Host is case-insensitive, but the PATH is not: WhatsApp invite/
      // channel codes (chat.whatsapp.com/AbCd…) are case-sensitive, so two
      // distinct groups must not normalise equal and hide a real CTA.
      const path = url.pathname.replace(/\/+$/, '')
      return `${host}${path}`
    } catch { return null }
  }
  const na = norm(a), nb = norm(b)
  return !!na && na === nb
}
