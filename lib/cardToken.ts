import { createHmac, timingSafeEqual } from 'crypto'
// The prefix and the id reader live there, crypto-free, so the scanner can
// read a code without pulling node's crypto into the browser bundle.
import { CARD_TOKEN_PREFIX as PREFIX, readCardTokenUserId } from '@/lib/cardTokenShape'

export { readCardTokenUserId }

// What the member card's QR carries.
//
// It used to be `smileys:member:<userId>` — a bare id, unsigned, with no
// expiry. Member ids are on every profile URL, so anyone could draw another
// member's code in a free QR generator, and a screenshot of a real card
// worked for ever, at any event. That was harmless while a check-in was
// decoration; it isn't now that standing clears a no-show card only for a
// seat that was scanned. A friend holding your screenshot could clear your
// record and pad the room's numbers from their sofa.
//
// So the code is signed and it expires. The shape is
//
//   smileys:card:<userId>.<expiryInMinutes>.<signature>
//
// short on purpose: the QR is read off a phone screen at a door, and every
// extra character packs the modules tighter. The signature is HMAC-SHA256 of
// "<userId>.<exp>" truncated to 16 bytes (128 bits, far past guessing) in
// base64url.
//
// A day, not a minute: the card has to open in a basement bar with no signal,
// from whatever the phone last cached. A screenshot passed around therefore
// stops working tomorrow rather than never — the trade the door needs.
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

function secret(): string {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET is not set — member card tokens cannot be signed')
  // Derived, so a leaked card signature says nothing about session tokens.
  return createHmac('sha256', s).update('member-card-v1').digest('hex')
}

function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url').slice(0, 22)
}

/** The QR value for this member, valid for a day. */
export function mintCardToken(userId: string, now: Date = new Date()): { value: string; expiresAt: Date } {
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS)
  const exp  = Math.floor(expiresAt.getTime() / 60_000)   // minutes keep it short
  const body = `${userId}.${exp}`
  return { value: `${PREFIX}${body}.${sign(body)}`, expiresAt }
}

export type CardTokenResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'malformed' | 'expired' | 'bad_signature' }

/**
 * Check a scanned code. Only the server can do this (it holds the secret) —
 * the scanner reads the id out of the code to look the person up on its own
 * roster, and the check-in write is what actually verifies it.
 */
export function verifyCardToken(raw: unknown, now: Date = new Date()): CardTokenResult {
  if (typeof raw !== 'string' || !raw.startsWith(PREFIX)) return { ok: false, reason: 'malformed' }
  const parts = raw.slice(PREFIX.length).split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed' }
  const [userId, expRaw, sig] = parts
  const exp = Number(expRaw)
  if (!userId || !Number.isInteger(exp) || !sig) return { ok: false, reason: 'malformed' }

  const expected = Buffer.from(sign(`${userId}.${expRaw}`))
  const given    = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'bad_signature' }
  }
  // Signature first, then expiry: an expired code is a real card that needs
  // reopening, a bad signature is somebody's drawing. The door is told which.
  if (exp * 60_000 <= now.getTime()) return { ok: false, reason: 'expired' }
  return { ok: true, userId }
}
