import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isStaleChunkError, reloadOnceForStaleChunk, recoverFromStaleChunk } from '@/lib/staleChunk'

// 2026-09-23. The two error boundaries both show "Something went wrong" and
// both auto-reload once on a stale chunk — but they recognised DIFFERENT sets
// of patterns, because the rule was written twice. app/error.tsx matched four;
// app/global-error.tsx duplicated it inline and matched three, missing
// "Cannot read properties of undefined (reading 'call')" out of
// webpack-runtime.
//
// That missing one is the pattern raised when a SERVER component references a
// chunk the new build no longer ships — a crash that lands on the GLOBAL
// boundary, not the route one. So the boundary best placed to recover was the
// only one that could not, and a device sat on the error screen through
// reloads until someone hard-refreshed by hand.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

const err = (message: string, stack = '') => ({ message, stack })

describe('isStaleChunkError', () => {
  it('matches the three plain message patterns', () => {
    expect(isStaleChunkError(err('Cannot find module ./4821.js'))).toBe(true)
    expect(isStaleChunkError(err('ChunkLoadError: Loading chunk 992 failed'))).toBe(true)
    expect(isStaleChunkError(err('Loading chunk 17 failed'))).toBe(true)
  })

  it('matches the webpack-runtime one — the pattern global-error used to miss', () => {
    expect(isStaleChunkError(err(
      "Cannot read properties of undefined (reading 'call')",
      'at __webpack_require__ (webpack-runtime.js:33:42)',
    ))).toBe(true)
  })

  it("needs the stack too, so an ordinary 'reading call' bug is not hidden by a reload", () => {
    // This message alone is a plain "called undefined" bug in a thousand other
    // places. Reloading on it would bury real crashes behind a refresh.
    expect(isStaleChunkError(err("Cannot read properties of undefined (reading 'call')"))).toBe(false)
    expect(isStaleChunkError(err("Cannot read properties of undefined (reading 'call')", 'at MyComponent (page.tsx:12)'))).toBe(false)
  })

  it('leaves real errors alone', () => {
    expect(isStaleChunkError(err('Cannot read properties of null (reading \'name\')'))).toBe(false)
    expect(isStaleChunkError(err('Forbidden'))).toBe(false)
    expect(isStaleChunkError(null)).toBe(false)
    expect(isStaleChunkError(undefined)).toBe(false)
    expect(isStaleChunkError({})).toBe(false)
  })
})

describe('the reload guard', () => {
  let store: Record<string, string>
  let reloads: number

  beforeEach(() => {
    store = {}
    reloads = 0
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
    })
    vi.stubGlobal('window', { location: { reload: () => { reloads++ } } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reloads once, then holds off for a minute', () => {
    reloadOnceForStaleChunk()
    expect(reloads).toBe(1)
    reloadOnceForStaleChunk()
    reloadOnceForStaleChunk()
    expect(reloads).toBe(1)
  })

  it('reloads again once the cooldown has passed', () => {
    reloadOnceForStaleChunk()
    store['smileys_stale_reload_at'] = String(Date.now() - 61_000)
    reloadOnceForStaleChunk()
    expect(reloads).toBe(2)
  })

  it('survives sessionStorage throwing, which it does in some privacy modes', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    })
    expect(() => reloadOnceForStaleChunk()).not.toThrow()
    expect(reloads).toBe(1)
  })

  it('recoverFromStaleChunk only reloads for a stale chunk', () => {
    expect(recoverFromStaleChunk(err('Forbidden'))).toBe(false)
    expect(reloads).toBe(0)
    expect(recoverFromStaleChunk(err('ChunkLoadError'))).toBe(true)
    expect(reloads).toBe(1)
  })

  it('shares one cooldown key across both boundaries', () => {
    // Separate keys would let a crash reload twice in a row — the route
    // boundary, then the global one.
    reloadOnceForStaleChunk()
    expect(Object.keys(store)).toEqual(['smileys_stale_reload_at'])
  })
})

describe('both boundaries read the same rule', () => {
  const route  = src('app/error.tsx')
  const global = src('app/global-error.tsx')

  it('each calls the shared helper', () => {
    expect(route).toContain("from '@/lib/staleChunk'")
    expect(global).toContain("from '@/lib/staleChunk'")
    expect(route).toContain('recoverFromStaleChunk(error)')
    expect(global).toContain('recoverFromStaleChunk(error)')
  })

  it('neither keeps its own copy of the patterns or the guard', () => {
    for (const [name, body] of [['error.tsx', route], ['global-error.tsx', global]] as const) {
      expect(body, name).not.toContain('smileys_stale_reload_at')
      expect(body, name).not.toContain('ChunkLoadError')
      expect(body, name).not.toContain('window.location.reload')
    }
  })

  it('and both still report the exception before recovering', () => {
    // A reload that loses the error report would make this class of crash
    // invisible in PostHog, which is where the stack is read from.
    expect(route).toContain('posthog.captureException(error)')
    expect(global).toContain('posthog.captureException(error)')
  })
})
