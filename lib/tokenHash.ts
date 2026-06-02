import { createHash } from 'crypto'

/**
 * Hash an auth-bearer token (password reset, email verification, activation)
 * before storing it in the database. We email/link the plaintext to the user
 * but store only the SHA-256 hex digest, so a DB-read leak cannot be turned
 * into account takeover.
 *
 * Why no salt: tokens are 256-bit random values (`randomBytes(32)`), so
 * each one is unique by construction. Pre-computation / rainbow tables
 * don't apply, and salting would only break our ability to look up by
 * the hash directly. SHA-256 is the standard pattern for opaque-token
 * storage (cf. OWASP password reset cheatsheet).
 *
 * Why SHA-256 not bcrypt: tokens already have full cryptographic entropy
 * — they're not user passwords. Slow hashing buys nothing and would
 * make the reset path noticeably slower.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
