import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * Symmetric encryption for TOTP shared secrets stored in `User.totpSecret`.
 *
 * Threat model: a DB-read leak (SQL injection, leaked backup, compromised
 * read replica) used to mean the attacker could generate valid 2FA codes
 * for every enrolled admin — effectively dropping 2FA. After this, the
 * attacker also needs `TOTP_ENCRYPTION_KEY` (which lives in env, not DB).
 *
 * Algorithm: AES-256-GCM. The IV is fresh per encryption and the GCM auth
 * tag ensures integrity. Stored format:
 *
 *   gcm:v1:<base64(iv 12B)>:<base64(ciphertext || tag 16B)>
 *
 * Backward-compat read: any stored value missing the `gcm:v1:` prefix is
 * returned as-is (treated as legacy plaintext). On the next 2FA re-enroll
 * for that admin it'll be rewritten in the encrypted format. We can drop
 * the fallback after every admin has re-enrolled — confirm via a quick
 * `psql -c "SELECT id FROM \"User\" WHERE \"totpEnabled\" AND \"totpSecret\" NOT LIKE 'gcm:v1:%';"`.
 */

const PREFIX = 'gcm:v1:'

function getKey(): Buffer {
  const raw = process.env.TOTP_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'TOTP_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` ' +
      'and add it to .env (and your prod env). Must decode to 32 bytes.',
    )
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error(
      `TOTP_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). ` +
      'Regenerate with `openssl rand -base64 32`.',
    )
  }
  return key
}

export function encryptTotpSecret(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64')}:${Buffer.concat([encrypted, tag]).toString('base64')}`
}

export function decryptTotpSecret(stored: string): string {
  // Legacy plaintext secret (pre-encryption deploy) — read through. On the
  // next 2FA re-enrollment it'll be rewritten encrypted.
  if (!stored.startsWith(PREFIX)) return stored

  const body = stored.slice(PREFIX.length)
  const sep = body.indexOf(':')
  if (sep < 0) throw new Error('Malformed encrypted TOTP secret')
  const iv = Buffer.from(body.slice(0, sep), 'base64')
  const ctAndTag = Buffer.from(body.slice(sep + 1), 'base64')
  if (ctAndTag.length < 16) throw new Error('Malformed encrypted TOTP secret')
  const ciphertext = ctAndTag.subarray(0, ctAndTag.length - 16)
  const tag = ctAndTag.subarray(ctAndTag.length - 16)

  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}
