// ── The member card's QR, on the device ────────────────────────────────────
//
// The card is the one screen whose whole job is to open at a door in a
// basement with no signal. The code it shows is minted by the server
// (GET /api/auth/card — signed, good for a day: lib/cardToken), so the
// fetch that mints it is exactly the thing that can't be relied on at the
// door. The last one is therefore kept on the device and shown again when
// the network isn't there.
//
// Kept PER MEMBER: phones get shared and passed around, and a cached code
// is a check-in credential — the next person to sign in here must never be
// handed the previous member's card.

export const CARD_TOKEN_KEY = 'smileys:card-token'

export interface CardToken {
  /** The full QR string — `smileys:card:<userId>.<exp>.<sig>`. */
  token:     string
  /** ISO instant the server stamped it with. */
  expiresAt: string
}

/**
 * The handful of fields the card actually draws, kept beside the token for
 * the same reason the token is: with /api/auth/me unreachable the page falls
 * back to the session the layout holds, and that carries no membershipType,
 * no joinedAt and no profilePhoto — so the card that opens at a door with no
 * signal is initials, no tier badge and no join year. Nothing else from /me
 * is kept here.
 */
export interface CardProfileCache {
  name?:           string
  color?:          string
  profilePhoto?:   string | null
  membershipType?: string
  joinedAt?:       string
  neighborhood?:   string | null
}

const PROFILE_FIELDS = ['name', 'color', 'profilePhoto', 'membershipType', 'joinedAt', 'neighborhood'] as const

/** One record per device, stamped with whose it is. */
interface StoredCard {
  userId:     string
  token?:     string
  expiresAt?: string
  profile?:   CardProfileCache
}

/** Where a shown code came from, so the card can be honest about it. */
export interface CardTokenState {
  token:   CardToken | null
  /** Served from this device because the mint couldn't be reached. */
  cached:  boolean
  /** Cached and past its day: it will be refused at the door. */
  expired: boolean
}

// Fail-soft storage, like the door's own queue (lib/checkinQueue): private
// mode, blocked site data or a full quota must never take the card down —
// it just means this device has nothing to fall back on.
//
// Everything below reads the record back for THIS member and nobody else:
// phones get shared, and a cached code is a check-in credential.
function readStored(userId: string): StoredCard | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CARD_TOKEN_KEY) ?? 'null')
    const rec = raw as StoredCard | null
    if (!rec || typeof rec !== 'object' || typeof rec.userId !== 'string') return null
    return rec.userId === userId ? rec : null
  } catch {
    return null
  }
}

// Merged, never replaced: the token and the display fields arrive from two
// different fetches, and whichever lands second must not wipe the first.
function writeStored(rec: StoredCard): void {
  try {
    localStorage.setItem(CARD_TOKEN_KEY, JSON.stringify(rec))
  } catch {}
}

export function readCachedCardToken(userId: string): CardToken | null {
  const rec = readStored(userId)
  if (!rec || typeof rec.token !== 'string' || typeof rec.expiresAt !== 'string') return null
  return { token: rec.token, expiresAt: rec.expiresAt }
}

export function cacheCardToken(userId: string, token: CardToken): void {
  writeStored({ ...(readStored(userId) ?? {}), userId, ...token })
}

/**
 * Keep the card's display fields, and only those — the rest of /me has no
 * business sitting in storage. Values that aren't a string or an explicit
 * null are dropped rather than stored as junk for the card to render.
 */
export function cacheCardProfile(userId: string, profile: unknown): void {
  if (!profile || typeof profile !== 'object') return
  const src  = profile as Record<string, unknown>
  const kept: Record<string, unknown> = {}
  for (const field of PROFILE_FIELDS) {
    const v = src[field]
    if (typeof v === 'string' || v === null) kept[field] = v
  }
  writeStored({ ...(readStored(userId) ?? {}), userId, profile: kept as CardProfileCache })
}

export function readCachedCardProfile(userId: string): CardProfileCache | null {
  const p = readStored(userId)?.profile
  return p && typeof p === 'object' ? p : null
}

export function forgetCachedCardToken(): void {
  try { localStorage.removeItem(CARD_TOKEN_KEY) } catch {}
}

export function cardTokenExpired(token: CardToken, now: number = Date.now()): boolean {
  const at = Date.parse(token.expiresAt)
  return Number.isNaN(at) || at <= now
}

/** Mint a fresh code. Null on any failure — no signal, 401, 403, 429. */
export async function fetchCardToken(): Promise<CardToken | null> {
  try {
    const res = await fetch('/app/api/auth/card', { credentials: 'include' })
    if (!res.ok) return null
    const d: unknown = await res.json()
    const token = d as Partial<CardToken>
    if (typeof token?.token !== 'string' || typeof token?.expiresAt !== 'string') return null
    return { token: token.token, expiresAt: token.expiresAt }
  } catch {
    return null
  }
}

/**
 * The code to show right now: a fresh one when the network allows, and
 * otherwise whatever this device kept. An expired cached code is still
 * returned — the card says so rather than showing a blank square, because
 * the member holding it needs to be told to find signal, not left guessing.
 */
export async function loadCardToken(userId: string, now: number = Date.now()): Promise<CardTokenState> {
  const fresh = await fetchCardToken()
  if (fresh) {
    cacheCardToken(userId, fresh)
    return { token: fresh, cached: false, expired: false }
  }
  const cached = readCachedCardToken(userId)
  if (!cached) return { token: null, cached: false, expired: false }
  return { token: cached, cached: true, expired: cardTokenExpired(cached, now) }
}
