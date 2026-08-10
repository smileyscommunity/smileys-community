// One definition of "is this a usable contact email" for listings.
//
// Three admin editors (the /admin/listings modal, the full-page editor and
// the new-listing form) and two API routes all write Listing.contactEmail.
// The first two each grew their own copy of the same regex, which is how
// the modal ended up validating a field the other editors couldn't even
// set. Everything routes through here instead.

export const CONTACT_EMAIL_MAX = 200

// Deliberately loose: a shape check, not RFC 5322. The address is shown to
// members as a mailto link, so the job is to reject obvious typos and
// anything that would break the link — not to adjudicate exotic-but-legal
// addresses and refuse a real seller's inbox.
const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Client-side check — drives the "enter a valid email" toast. */
export function isValidContactEmail(value: string): boolean {
  const raw = value.trim().toLowerCase()
  return raw.length <= CONTACT_EMAIL_MAX && SHAPE.test(raw)
}

/**
 * Server-side normalizer. Trims and lowercases, then returns null for both
 * empty and malformed input — an admin who saves a broken address clears
 * the field rather than persisting junk that renders as a dead mailto.
 */
export function normalizeContactEmail(value: unknown): string | null {
  const raw = value ? String(value).trim().toLowerCase() : ''
  return raw && isValidContactEmail(raw) ? raw : null
}
