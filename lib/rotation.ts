// Per-viewer, per-day rotation for discovery surfaces.
//
// Discovery used to be fully deterministic: a small candidate pool ordered
// by joinedAt, sliced to 8. The same member saw the same faces forever, so
// "people you might meet" read as a fixed list rather than a community.
//
// The fix is rotation, NOT randomness. The seed is (viewer + 30-minute
// window), so discovery turns over between visits but holds still inside
// one. Refreshing does not reshuffle — that would make the page a slot
// machine, and would mean a member who scrolls past someone interesting
// can never find them again. Two members with identical clubs still see
// different orderings.

// One rotation per browsing session, roughly. A fixed window rather than a
// real session id keeps this stateless (no cookie, no store); the cost is
// that a long session can straddle a boundary and reshuffle once.
export const ROTATION_WINDOW_MS = 30 * 60 * 1000

export function rotationSeed(viewerId: string, salt = '', now = Date.now()): string {
  const window = Math.floor(now / ROTATION_WINDOW_MS)
  return `${viewerId}:${window}${salt ? `:${salt}` : ''}`
}

// xmur3 — string → 32-bit seed.
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return (h ^= h >>> 16) >>> 0
}

// mulberry32 — small, fast, good enough for shuffling a page of members.
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Fisher-Yates against the seeded generator. Returns a new array; the
// input order is never used as a tiebreak, so callers get a true rotation.
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items]
  const next = rng(hashSeed(seed))
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
