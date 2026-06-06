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
  whatsapp?:    string  // stored as phone, e.g. "+90 5552933220"
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
 * Convert a stored WhatsApp phone (free-text, may include +, spaces,
 * parentheses, dashes) to a wa.me click-to-chat URL. Returns null
 * when the phone doesn't yield enough digits to be valid.
 */
export function communityWhatsappUrl(phone: string | undefined | null): string | null {
  if (!phone || typeof phone !== 'string') return null
  const digits = phone.replace(/[^\d]/g, '')
  // wa.me requires country code; allow anything ≥ 7 digits to cover
  // edge formats but reject obviously-truncated inputs.
  if (digits.length < 7) return null
  return `https://wa.me/${digits}`
}
