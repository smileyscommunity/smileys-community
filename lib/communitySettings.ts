// Read-only loader for data/settings.json — the community-wide
// settings file edited via /admin/settings (name, tagline, contact
// channels, etc.). Use this on server components / route handlers
// that need a stable snapshot of the community identity (the value
// is small and rarely changes, so a per-request file read is fine —
// no caching layer needed).

import { readFileSync } from 'fs'
import { join } from 'path'

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
  // the club's own rules. Plain text with whitespace preserved at
  // render time (no markdown — keeps the input simple in
  // /admin/settings).
  communityRules?: string
}

const SETTINGS_PATH = join(process.cwd(), 'data', 'settings.json')

export function loadCommunitySettings(): CommunitySettings {
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
  } catch {
    return {}
  }
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
