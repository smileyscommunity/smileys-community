// Shape guard for the command palette's live search (GET /api/search).
//
// The palette used to `setResults(await res.json())` unconditionally. For a
// guest or an expired session the route answers 401 `{ error: 'Unauthorized' }`,
// and the render then read `results.events.length` off that object — a
// TypeError during render, which takes the whole page down, not just the
// palette. Anything that isn't a 2xx carrying the expected arrays becomes
// null (no results); a 401 is reported separately so the palette can offer
// sign-in instead of a silent "No results".

export interface SearchResults {
  events:   { id: string; title: string; date: string; emoji: string; neighborhood: string }[]
  members:  { id: string; name: string; color: string; profilePhoto: string | null; neighborhood: string | null; restricted?: boolean }[]
  clubs:    { id: string; name: string; emoji: string; slug: string; memberCount: number }[]
  listings: { id: string; title: string; category: string; price: string | null; neighborhood: string | null }[]
  // Optional so a client bundle deployed ahead of (or behind) the API can't
  // crash on a payload without the field.
  handbook?: { slug: string; title: string; excerpt: string | null; category: string; emoji: string }[]
}

export type SearchOutcome =
  | { kind: 'ok'; results: SearchResults }
  | { kind: 'auth' }    // 401 — signed out, or the session expired mid-visit
  | { kind: 'error' }   // anything else: 5xx, HTML error page, malformed body

const arr = (v: unknown) => (Array.isArray(v) ? v : [])

export function parseSearchResponse(status: number, body: unknown): SearchOutcome {
  if (status === 401) return { kind: 'auth' }
  if (status < 200 || status >= 300 || !body || typeof body !== 'object') return { kind: 'error' }
  const b = body as Record<string, unknown>
  // A 2xx without even one of the core arrays isn't a search payload.
  if (!Array.isArray(b.events) && !Array.isArray(b.members) && !Array.isArray(b.clubs) && !Array.isArray(b.listings)) {
    return { kind: 'error' }
  }
  return {
    kind: 'ok',
    results: {
      events:   arr(b.events),
      members:  arr(b.members),
      clubs:    arr(b.clubs),
      listings: arr(b.listings),
      handbook: arr(b.handbook),
    },
  }
}

// Palette destinations a signed-out visitor can actually open. Everything
// else sits behind app/(member)/layout.tsx and would bounce to /login.
export const GUEST_PALETTE_IDS: ReadonlySet<string> = new Set([
  'events', 'clubs', 'guide', 'handbook', 'stories', 'board', 'marketplace', 'directory', 'cities',
])
