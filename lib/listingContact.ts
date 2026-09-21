// What a listing may put behind its "Contact on WhatsApp" button.
//
// The field was free text, and anything starting with `http` was used as the
// href — so a listing could point a green, WhatsApp-branded button at a
// credential-phishing page, and plain http:// was accepted too. A phone
// number or WhatsApp's own domains, nothing else.
const WHATSAPP_HOSTS = ['wa.me', 'www.wa.me', 'api.whatsapp.com', 'chat.whatsapp.com']

export type ContactCheck =
  | { ok: true; value: string | null }
  | { ok: false; error: string }

// What a copied phone number carries that isn't the number: the bidi marks
// iOS Contacts wraps a number in, zero-width characters, full-width digits
// from some keyboards, and the dashes autocorrect turns hyphens into. Each of
// these made a real number fail the check.
function tidy(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[​-‏‪-‮⁠﻿]/g, '')
    .replace(/[‐-―]/g, '-')
    .trim()
}

export function normalizeListingContact(raw: unknown): ContactCheck {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Contact must be a phone number or a WhatsApp link' }
  }
  const value = tidy(raw)
  if (!value) return { ok: true, value: null }
  if (value.length > 200) {
    return { ok: false, error: 'Contact must be a phone number or a WhatsApp link' }
  }

  // A wa.me link pasted without its scheme is still a wa.me link — the
  // field's own placeholder offers exactly that.
  const linkish = /^(?:https?:\/\/)?(?:www\.)?(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\//i.test(value)
    ? (/^https?:\/\//i.test(value) ? value : `https://${value}`)
    : value

  if (/^https?:\/\//i.test(linkish)) {
    let u: URL
    try { u = new URL(linkish) } catch { return { ok: false, error: 'That contact link is not a valid address' } }
    if (!WHATSAPP_HOSTS.includes(u.hostname.toLowerCase())) {
      return { ok: false, error: 'A contact link has to be a WhatsApp link (wa.me). Otherwise use a phone number.' }
    }
    if (u.protocol !== 'https:') {
      return { ok: false, error: 'A WhatsApp link has to start with https://' }
    }
    return { ok: true, value: linkish }
  }

  // A phone number as people write them: digits, spaces, dashes, dots,
  // brackets, a leading +. Two numbers separated by a slash are two numbers.
  if (!/^\+?[\d\s()./-]{6,40}$/.test(value) || value.replace(/\D/g, '').length < 6) {
    return { ok: false, error: 'Contact must be a phone number or a WhatsApp link' }
  }
  return { ok: true, value }
}
