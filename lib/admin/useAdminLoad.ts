'use client'

// Shared admin-load hook. Replaces the per-page boilerplate I've
// now written eight times: setLoading + setError + setData state,
// fetch with r.ok check, retry callback, useEffect to fire on
// mount.
//
// Usage:
//   const { data, loading, error, retry } = useAdminLoad<Host[]>(
//     '/app/api/admin/hosts',
//     (v): v is Host[] => Array.isArray(v),
//   )
//
//   if (error)   return <LoadErrorBanner message={error} onRetry={retry} />
//   if (loading) return <Skeleton />
//   return <List items={data ?? []} />
//
// The accept predicate is a type guard — the hook narrows `data`
// to `T | null` so callers don't need their own runtime shape
// checks. When the body fails the predicate, it's treated as
// "no data" (`data === null`) rather than an error, so endpoints
// that legitimately return `null` for "not set yet" (e.g. the
// spotlight singleton) don't surface as failures.

import { useCallback, useEffect, useState } from 'react'

// One line that says what a failed admin fetch was: the status plus the
// start of the body (our routes answer `{ error: "..." }`, so the reason
// is usually right there). Shared with pages whose loads are too
// filter- or interval-driven for the hook itself.
export async function loadFailure(r: Response): Promise<Error> {
  const text = await r.text().catch(() => '')
  return new Error(`${r.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
}

export interface UseAdminLoadResult<T> {
  data:    T | null
  loading: boolean
  error:   string | null
  retry:   () => void
  // Lets callers patch data without going through a full refetch
  // (e.g. after a successful mutation in the same component). Accepts
  // either a value or a functional updater (React.SetStateAction
  // shape) so rapid back-to-back mutations work against the latest
  // state, not a stale render-time snapshot.
  setData: (next: T | null | ((prev: T | null) => T | null)) => void
}

export function useAdminLoad<T>(
  url: string,
  accept: (v: unknown) => v is T,
  opts: {
    // Skip the fetch until enabled flips true. Useful for
    // dependent loads. While disabled, returns
    // { data: null, loading: false, error: null }.
    enabled?: boolean
  } = {},
): UseAdminLoadResult<T> {
  const { enabled = true } = opts
  const [data,    setData]    = useState<T | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error,   setError]   = useState<string | null>(null)
  // Counter we bump from retry() to refire the effect without
  // depending on the consumer to keep a stable url. Cheaper than
  // a useCallback dance and reads cleanly.
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(url, { credentials: 'include' })
      .then(async r => {
        if (!r.ok) throw await loadFailure(r)
        return r.json()
      })
      .then(json => {
        if (cancelled) return
        // Shape-validated narrow. If the body doesn't match, treat
        // it as "no data" rather than an error — supports endpoints
        // that return null/empty for the unset case.
        setData(accept(json) ? json : null)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e?.message ?? 'Failed to load')
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => { cancelled = true }
    // The accept fn is intentionally NOT a dep — callers commonly
    // pass an inline type-guard arrow, and adding it would refetch
    // on every render. Stable predicate is the convention.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled, tick])

  const retry = useCallback(() => setTick(n => n + 1), [])

  return { data, loading, error, retry, setData }
}
