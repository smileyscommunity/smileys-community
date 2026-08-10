import { describe, it, expect } from 'vitest'
import { isValidContactEmail, normalizeContactEmail, CONTACT_EMAIL_MAX } from '@/lib/contactEmail'

describe('isValidContactEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidContactEmail('seller@example.com')).toBe(true)
    expect(isValidContactEmail('a.b+tag@sub.domain.co.uk')).toBe(true)
  })

  it('is case- and whitespace-insensitive', () => {
    expect(isValidContactEmail('  Seller@Example.COM  ')).toBe(true)
  })

  it('rejects the typos an admin actually makes', () => {
    expect(isValidContactEmail('seller')).toBe(false)
    expect(isValidContactEmail('seller@')).toBe(false)
    expect(isValidContactEmail('@example.com')).toBe(false)
    expect(isValidContactEmail('seller@example')).toBe(false)   // no TLD
    expect(isValidContactEmail('a b@example.com')).toBe(false)  // internal space
    expect(isValidContactEmail('two@at@example.com')).toBe(false)
  })

  it('rejects anything over the column budget', () => {
    expect(isValidContactEmail(`${'a'.repeat(CONTACT_EMAIL_MAX)}@example.com`)).toBe(false)
  })
})

describe('normalizeContactEmail', () => {
  it('trims and lowercases what it keeps', () => {
    expect(normalizeContactEmail('  Seller@Example.COM ')).toBe('seller@example.com')
  })

  it('treats empty and absent input as "no email"', () => {
    expect(normalizeContactEmail('')).toBeNull()
    expect(normalizeContactEmail('   ')).toBeNull()
    expect(normalizeContactEmail(null)).toBeNull()
    expect(normalizeContactEmail(undefined)).toBeNull()
  })

  // Clearing beats persisting junk: a malformed address would render as a
  // dead mailto link on the public listing.
  it('clears the field rather than storing a malformed address', () => {
    expect(normalizeContactEmail('not-an-email')).toBeNull()
    expect(normalizeContactEmail('seller@example')).toBeNull()
  })

  it('coerces non-string input instead of throwing', () => {
    expect(normalizeContactEmail(12345)).toBeNull()
    expect(normalizeContactEmail({})).toBeNull()
  })

  // The server normalizer and the client guard must agree, or the UI blocks
  // a save the API would have accepted (or vice versa).
  it('agrees with isValidContactEmail on every case', () => {
    for (const s of ['seller@example.com', 'A@B.co', 'nope', 'x@y', '', '  ']) {
      expect(normalizeContactEmail(s) !== null).toBe(s.trim() !== '' && isValidContactEmail(s))
    }
  })
})
