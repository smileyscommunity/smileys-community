interface CacheEntry {
  data: unknown
  expiresAt: number
}

const store = new Map<string, CacheEntry>()

export function getCached<T>(key: string): T | null {
  const entry = store.get(key)
  if (!entry || Date.now() > entry.expiresAt) return null
  return entry.data as T
}

export function setCached<T>(key: string, data: T, ttlMs: number): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs })
}

