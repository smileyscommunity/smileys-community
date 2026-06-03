import { randomBytes, createHash } from 'crypto'

// One-time recovery codes for TOTP 2FA. Generated at enrollment, shown
// to the user ONCE, hash-stored in the DB. Accepted at /api/auth/2fa/verify
// as an alternative to the 6-digit TOTP code when the user has lost their
// device.

// 32-char alphabet, no visually ambiguous chars (no 0/O, 1/I/l).
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

const BATCH_SIZE = 10        // Codes per user. Standard practice.
const CODE_LENGTH = 10       // Chars per code. 32^10 ~= 10^15 possibilities.
const HYPHEN_AT = 5          // Display formatted as XXXXX-XXXXX

/**
 * Generate one backup code, randomly drawn from ALPHABET.
 *
 * crypto.randomBytes is used to pick the random index for each char so
 * the codes have full cryptographic entropy. We mod the random byte by
 * the alphabet length, which introduces a tiny bias (256 / 32 = 8 exact,
 * no bias for this specific alphabet size — but worth noting).
 */
function generateOne(): string {
  const bytes = randomBytes(CODE_LENGTH)
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length]
    if (i === HYPHEN_AT - 1) out += '-'
  }
  return out
}

/**
 * Generate a fresh batch of 10 codes. Returns the plaintext array — the
 * caller is responsible for hashing before storage and showing the
 * plaintext to the user exactly once.
 */
export function generateBatch(): string[] {
  const codes = new Set<string>()
  while (codes.size < BATCH_SIZE) codes.add(generateOne())
  return [...codes]
}

/**
 * SHA-256 hash of a backup code. Same approach as lib/tokenHash.ts: codes
 * are high-entropy random strings, so unsalted hashing is sufficient and
 * lets us look up by hash. Normalize whitespace + case + hyphens before
 * hashing so a user pasting "abcd1-23456" or "ABCDE 23456" still matches
 * the stored "ABCD1-23456".
 */
export function hashCode(code: string): string {
  const normalized = code.toUpperCase().replace(/[\s-]/g, '')
  return createHash('sha256').update(normalized).digest('hex')
}
