// Stale-chunk detection, shared by the two React error boundaries.
//
// After a deploy, a device holding a cached client bundle can reference a
// module ID the new server build no longer ships, and webpack-runtime throws
// on the missing factory. One reload pulls fresh bundles; without it the
// person sits on "Something went wrong" until they think to hard-refresh.
//
// This lives here because it had already drifted. app/error.tsx recognised
// four patterns; app/global-error.tsx duplicated the logic inline and
// recognised three, missing the webpack-runtime one — which is the pattern
// that fires when a SERVER component references a vanished chunk, and so the
// one most likely to reach the GLOBAL boundary rather than the route one. The
// boundary best placed to recover was the one that could not. Two copies of a
// rule is how that happens, so now there is one.
//
// Browser-only (sessionStorage, window.location). Both callers are
// 'use client'; nothing server-side may import this.

/** The key is shared so one reload per minute covers BOTH boundaries. */
const RELOAD_KEY = 'smileys_stale_reload_at'
const RELOAD_COOLDOWN_MS = 60_000

/**
 * Is this the cached-bundle-vs-new-build mismatch, rather than a real bug in
 * our own code? Patterns observed in production:
 *   - "Cannot find module" / "ChunkLoadError" / "Loading chunk"
 *   - "Cannot read properties of undefined (reading 'call')" raised from
 *     webpack-runtime — the same root cause surfaced differently when a
 *     server component references a chunk that vanished from the new build
 *     (the digest in the pm2 log is the giveaway).
 *
 * The fourth is matched on message AND stack: that message alone is an
 * ordinary "called undefined" bug in a thousand other places, and reloading
 * on it unconditionally would hide real crashes behind a refresh.
 */
export function isStaleChunkError(error: { message?: string; stack?: string } | null | undefined): boolean {
  const msg   = error?.message ?? ''
  const stack = error?.stack ?? ''
  return msg.includes('Cannot find module')
    || msg.includes('ChunkLoadError')
    || msg.includes('Loading chunk')
    || (msg.includes("Cannot read properties of undefined (reading 'call')") && stack.includes('webpack-runtime'))
}

/**
 * Reload at most once a minute per tab. When the mismatch is server-side (an
 * old process serving a replaced .next) the reload errors again, and an
 * unconditional reload was a tight loop hammering the server exactly while it
 * was fragile.
 */
export function reloadOnceForStaleChunk(): void {
  let last = 0
  try { last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) || 0 } catch {}
  if (Date.now() - last < RELOAD_COOLDOWN_MS) return
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch {}
  window.location.reload()
}

/** Recover if this looks like a stale chunk. Returns whether a reload fired. */
export function recoverFromStaleChunk(error: { message?: string; stack?: string } | null | undefined): boolean {
  if (!isStaleChunkError(error)) return false
  reloadOnceForStaleChunk()
  return true
}
