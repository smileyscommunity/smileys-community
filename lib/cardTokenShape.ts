// ── The shape of a member card code, without the crypto ────────────────────
//
// `smileys:card:<userId>.<expiryInMinutes>.<signature>` — see lib/cardToken
// for what it is and why it's signed. Only the SHAPE lives here, because the
// scanner runs in a browser and lib/cardToken imports node's crypto to sign
// and verify: importing it from the door page pulled 325 KB of
// crypto-browserify into /host/checkin and /admin/checkin, which is the last
// page that can afford it — a host opens it at a venue, on a phone, on
// whatever signal the room has.
//
// lib/cardToken should read the id from here too, so there is one definition
// of the prefix rather than two that can drift.

export const CARD_TOKEN_PREFIX = 'smileys:card:'

/**
 * The member id inside a scanned code, without checking the signature — for
 * the scanner's own roster lookup, which decides nothing. Never use it to
 * authorise a write: lib/cardToken's verifyCardToken is what the server
 * trusts, and the door sends the raw string along for it to check.
 */
export function readCardTokenUserId(raw: string): string | null {
  if (!raw.startsWith(CARD_TOKEN_PREFIX)) return null
  const [userId] = raw.slice(CARD_TOKEN_PREFIX.length).split('.')
  return userId || null
}

/** Length of the truncated HMAC lib/cardToken puts on the end. */
const SIG_LENGTH = 22

/** The three parts of a card code, or null for anything else. */
function cardParts(raw: string): [string, string, string] | null {
  if (!raw.startsWith(CARD_TOKEN_PREFIX)) return null
  const parts = raw.slice(CARD_TOKEN_PREFIX.length).split('.')
  if (parts.length !== 3) return null
  const [userId, exp, sig] = parts
  if (!userId || !exp || !sig) return null
  return [userId, exp, sig]
}

/**
 * Is this string shaped like a member card at all — prefix, three parts, a
 * signature of the right length? Not whether it is a REAL card: no secret
 * lives in the browser, so nothing here can tell a signature from 22 random
 * characters. It is the crypto-free "could this be one" the door needs before
 * it offers to act on a scan: `smileys:card:<someone's id>` with no signature,
 * or a retired `smileys:member:<id>` screenshot, both parse far enough to name
 * a person and must not be treated as a card.
 */
export function hasCardShape(raw: string): boolean {
  const parts = cardParts(raw.trim())
  return !!parts && parts[2].length === SIG_LENGTH
}

/**
 * When a card code says it expires, in epoch milliseconds — the `<exp>` in
 * the middle, which lib/cardToken writes in minutes. Unsigned, so this is
 * only good for telling the holder their code is stale before the door tries
 * to use it; the server's verifyCardToken is what refuses it.
 */
export function readCardTokenExp(raw: string): number | null {
  const parts = cardParts(raw.trim())
  if (!parts) return null
  const exp = Number(parts[1])
  if (!Number.isInteger(exp) || exp <= 0) return null
  return exp * 60_000
}
