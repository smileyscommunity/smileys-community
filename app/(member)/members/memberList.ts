import { fold } from '@/lib/turkishFold'

// The parts of the members directory that are decisions rather than
// markup: what the list endpoint is asked for, how pages are stitched
// together, and who is allowed to see a profile. They live here so both
// the page and the tests can read the same answer — each of these was a
// bug that came from two places in page.tsx disagreeing.

export type RoleFilter = 'All' | 'Hosts' | 'Admins' | 'Saved'
export type SortOption = 'newest' | 'active' | 'az'
export type OpenToFilter = '' | 'coffee' | 'language' | 'hosting'

export const ROLE_FILTERS: RoleFilter[] = ['All', 'Hosts', 'Admins', 'Saved']

// The API's vocabulary for the sort dropdown. Sorting is the server's job:
// doing it in the browser only ever ordered the rows that happened to be
// loaded, so "A–Z" meant "A–Z of the newest hundred".
export const SORT_PARAM: Record<SortOption, string> = { newest: 'joined', active: 'active', az: 'name' }

export interface MemberQuery {
  roleFilter:   RoleFilter
  openTo:       OpenToFilter
  aroundNow:    boolean
  speaksMyLang: boolean
  lookingFor:   string
  search:       string
  sort:         SortOption
}

// Anything that narrows the directory. The footer count, the "Load more"
// button and the flash-card deck's auto-paging all read this one answer
// instead of each re-deriving it from a different subset of the filters.
export function filtersActive(q: MemberQuery): boolean {
  return q.roleFilter !== 'All' || !!q.openTo || q.aroundNow || q.speaksMyLang || !!q.lookingFor || !!q.search.trim()
}

// Everything the list endpoint needs for one page of the query on screen.
// `offset` goes on every request, filtered ones included — paging used to
// be switched off under a filter, so "Load more" fetched page 2 of the
// unfiltered directory and rendered none of it.
export function buildMemberQuery(q: MemberQuery, offset: number): URLSearchParams {
  const params = new URLSearchParams()
  if (q.roleFilter === 'Hosts')  params.set('isHost', 'true')
  if (q.roleFilter === 'Admins') params.set('adminOnly', 'true')
  if (q.roleFilter === 'Saved')  params.set('savedOnly', 'true')
  if (q.openTo)                  params.set('openTo', q.openTo)
  if (q.aroundNow)               params.set('aroundNow', 'true')
  if (q.speaksMyLang)            params.set('speaksMyLang', 'true')
  if (q.lookingFor)              params.set('lookingFor', q.lookingFor)
  // Trimmed: a trailing space off a phone keyboard is not part of the name.
  if (q.search.trim())           params.set('search', q.search.trim())
  params.set('sort', SORT_PARAM[q.sort])
  params.set('offset', String(offset))
  return params
}

// Merge a freshly-fetched page into what's on screen, keeping the first
// copy of each id. Pages are addressed by offset, so anyone who joins
// mid-session shifts every row down one and the next page repeats a
// member the list already has.
export function mergeById<T extends { id: string }>(prev: T[], next: T[]): T[] {
  const seen = new Set(prev.map(m => m.id))
  return [...prev, ...next.filter(m => !seen.has(m.id))]
}

// The one rule for "may this viewer see who this person is" — bio,
// interests, clubs, full name, the neighbourhood they chose to list. A
// public profile is public to every member (the same answer /members/[id]
// gives); only a 'connections only' member is locked. Instagram, LinkedIn
// and work details stay behind an accepted connection, and the API
// withholds them, so no caller has to.
export function seesProfileOf(m: { restricted?: boolean }, isConnected: boolean): boolean {
  return isConnected || !m.restricted
}

// True when `haystack` contains the already-folded `needle`. Callers fold
// the needle once and run this over many fields. The fold itself is
// lib/turkishFold — the same one the server searches with, so the browser
// can't throw away a row Postgres just matched.
export function foldedIncludes(haystack: string | null | undefined, foldedNeedle: string): boolean {
  if (!haystack) return false
  return fold(haystack).includes(foldedNeedle)
}
