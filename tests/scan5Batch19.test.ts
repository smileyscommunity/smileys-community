import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { parseSearchResponse, GUEST_PALETTE_IDS } from '@/lib/searchResults'
import { isBottomNavRoute, isCityRoute } from '@/lib/bottomNav'
import { foundingHostHref } from '@/lib/foundingHostHref'
import {
  countPendingReceived, shouldRefreshPending, notifyConnectionsChanged,
  CONNECTIONS_CHANGED_EVENT, PENDING_MIN_GAP_MS, PENDING_POLL_MS,
} from '@/lib/pendingConnections'
import { safeReturnPath } from '@/lib/safeUrl'
import type { AppUser } from '@/lib/auth'

// Scan 5, batch 19:
//   71 — the ⌘K palette crashed the whole page for guests / expired sessions:
//        /api/search's 401 `{ error }` body was stored as results and the
//        render read `results.events.length` off it.
//   74 — the founding-member "Host the first thing" linked everyone to /host,
//        whose layout bounces anyone without hosting authority to /login.
//   75 — the mobile bottom nav unmounted after a city switch: the switch
//        lands on `/<slug>`, which no BOTTOM_NAV_ROUTES entry matched.
//   77 — the pending-connections badge was fetched once on mount, never again.

const read = (f: string) => readFileSync(f, 'utf8')

const member = (over: Partial<AppUser> = {}): AppUser =>
  ({ id: 'u1', name: 'Ayla K', initials: 'AK', color: '#000', role: 'member', ...over })

describe('71 — palette search response parsing', () => {
  it('a 401 (guest / expired session) is an auth outcome, never results', () => {
    expect(parseSearchResponse(401, { error: 'Unauthorized' })).toEqual({ kind: 'auth' })
  })

  it('non-2xx, null, non-object and error-shaped 2xx bodies are errors', () => {
    expect(parseSearchResponse(500, { events: [] }).kind).toBe('error')
    expect(parseSearchResponse(429, null).kind).toBe('error')
    expect(parseSearchResponse(200, null).kind).toBe('error')
    expect(parseSearchResponse(200, 'oops').kind).toBe('error')
    expect(parseSearchResponse(200, { error: 'Unauthorized' }).kind).toBe('error')
  })

  it('a partial payload is filled with empty arrays so render reads never throw', () => {
    const out = parseSearchResponse(200, { events: [{ id: 'e1' }], members: 'nope' })
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.results.events).toHaveLength(1)
    expect(out.results.members).toEqual([])
    expect(out.results.clubs).toEqual([])
    expect(out.results.listings).toEqual([])
    expect(out.results.handbook).toEqual([])
  })

  it('guests are only offered destinations outside the member-gated layout', () => {
    for (const id of ['events', 'clubs', 'board', 'directory', 'cities', 'handbook', 'guide', 'marketplace', 'stories']) {
      expect(GUEST_PALETTE_IDS.has(id)).toBe(true)
    }
    for (const id of ['members', 'hangouts', 'dashboard', 'my-events', 'messages', 'notifications', 'connections', 'profile', 'settings']) {
      expect(GUEST_PALETTE_IDS.has(id)).toBe(false)
    }
  })

  it('the palette parses instead of storing the raw body, and skips the fetch for guests', () => {
    const src = read('components/CommandPalette.tsx')
    expect(src).not.toMatch(/setResults\(data\)/)
    expect(src).toMatch(/parseSearchResponse\(res\.status, body\)/)
    expect(src).toMatch(/if \(!isLoggedIn\) \{ setResults\(null\); setNeedsSignIn\(true\); return \}/)
    expect(src).toMatch(/\}, \[query, isLoggedIn\]\)/)
    expect(src).toMatch(/GUEST_PALETTE_IDS\.has\(c\.id\)/)
    expect(src).toMatch(/Sign in to search/)
  })
})

describe('74 — founding-member host link', () => {
  it('a plain member goes to the host pathway, not the host panel', () => {
    expect(foundingHostHref(member(), true)).toBe('/get-involved')
    // A moderator has oversight of /host but no events tools of their own.
    expect(foundingHostHref(member({ role: 'moderator' }), true)).toBe('/get-involved')
  })

  it('anyone who can host events goes straight to creating one', () => {
    expect(foundingHostHref(member({ isClubHost: true }), true)).toBe('/host/events/new')
    expect(foundingHostHref(member({ hostCityIds: ['c1'] }), true)).toBe('/host/events/new')
    expect(foundingHostHref(member({ role: 'admin' }), true)).toBe('/host/events/new')
  })

  it('a guest gets login with a return path login accepts', () => {
    const href = foundingHostHref(member(), false)
    expect(href).toBe('/login?from=%2Fget-involved')
    const from = new URL(href, 'https://x.test').searchParams.get('from')
    expect(safeReturnPath(from)).toBe('/get-involved')
  })

  it('the panel no longer hard-codes /host, and /host still bounces non-hosts', () => {
    const panel = read('components/FoundingMemberPanel.tsx')
    expect(panel).not.toMatch(/href: '\/host'/)
    expect(panel).toMatch(/^'use client'/)
    expect(panel).toMatch(/href: foundingHostHref\(user, isLoggedIn\)/)
    // The reason the old link failed — if this gate ever changes, revisit 74.
    expect(read('app/host/layout.tsx')).toMatch(/if \(!mayEnter\) router\.replace\('\/login'\)/)
  })
})

describe('75 — bottom nav after a city switch', () => {
  const slugs = ['istanbul', 'bursa', 'tbilisi']

  it('city pages and hubs count as bottom-nav routes when slugs are known', () => {
    expect(isBottomNavRoute('/bursa', slugs)).toBe(true)
    expect(isBottomNavRoute('/bursa/events', slugs)).toBe(true)
    expect(isBottomNavRoute('/tbilisi/board', slugs)).toBe(true)
  })

  it('without slugs the old rule is unchanged (the regression, for the record)', () => {
    expect(isBottomNavRoute('/bursa')).toBe(false)
    expect(isBottomNavRoute('/events')).toBe(true)
    // The admin panel has its own bottom nav; the member one covered it.
    expect(isBottomNavRoute('/admin/users')).toBe(false)
    expect(isBottomNavRoute('/host/events')).toBe(true)
  })

  it('non-city top-level pages are not swept in by the slug match', () => {
    expect(isBottomNavRoute('/login', slugs)).toBe(false)
    expect(isBottomNavRoute('/apply', slugs)).toBe(false)
    expect(isBottomNavRoute('/', slugs)).toBe(false)
    expect(isCityRoute('/bursaspor', slugs)).toBe(false)
  })

  it('BottomNav passes the layout city slugs into the rule', () => {
    expect(read('components/BottomNav.tsx'))
      .toMatch(/isBottomNavRoute\(pathname, cities\.map\(c => c\.slug\)\)/)
  })
})

describe('77 — pending-connections badge refresh', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('counts only pending received requests, and survives error bodies', () => {
    expect(countPendingReceived({ received: [{ status: 'pending' }, { status: 'accepted' }, { status: 'pending' }] })).toBe(2)
    expect(countPendingReceived({ error: 'Unauthorized' })).toBe(0)
    expect(countPendingReceived(null)).toBe(0)
    expect(countPendingReceived({ received: [null, 'x', { status: 'pending' }] })).toBe(1)
  })

  const base = { now: 100_000, lastFetchAt: 100_000 - 1_000, inFlight: false, hidden: false }

  it('never refetches while hidden or while a request is out', () => {
    expect(shouldRefreshPending({ ...base, reason: 'poll', lastFetchAt: 0, hidden: true })).toBe(false)
    expect(shouldRefreshPending({ ...base, reason: 'changed', inFlight: true })).toBe(false)
  })

  it('an in-app accept/decline always refetches; the first load always fetches', () => {
    expect(shouldRefreshPending({ ...base, reason: 'changed' })).toBe(true)
    expect(shouldRefreshPending({ ...base, reason: 'mount', lastFetchAt: null })).toBe(true)
  })

  it('focus / route / poll triggers are throttled to the min gap', () => {
    expect(shouldRefreshPending({ ...base, reason: 'focus' })).toBe(false)
    expect(shouldRefreshPending({ ...base, reason: 'route', lastFetchAt: base.now - PENDING_MIN_GAP_MS })).toBe(true)
    expect(PENDING_POLL_MS).toBeGreaterThanOrEqual(60_000)
  })

  it('notifyConnectionsChanged dispatches the shared event on window', () => {
    const target = new EventTarget()
    const seen = vi.fn()
    target.addEventListener(CONNECTIONS_CHANGED_EVENT, seen)
    vi.stubGlobal('window', target)
    notifyConnectionsChanged()
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('the hook refreshes on focus, visibility, route change and the event', () => {
    const src = read('hooks/usePendingConnections.ts')
    expect(src).toMatch(/window\.addEventListener\('focus', onFocus\)/)
    expect(src).toMatch(/document\.addEventListener\('visibilitychange', onVisible\)/)
    expect(src).toMatch(/window\.addEventListener\(CONNECTIONS_CHANGED_EVENT, onChanged\)/)
    expect(src).toMatch(/setInterval\(\(\) => refresh\('poll'\), PENDING_POLL_MS\)/)
    expect(src).toMatch(/\}, \[pathname, isLoggedIn\]\)/)
  })

  it('every in-app accept/decline site announces the change', () => {
    for (const f of [
      'app/(member)/contacts/page.tsx',
      'app/(member)/members/page.tsx',
      'app/(member)/members/[id]/MemberProfileClient.tsx',
      'components/PendingConnectionsWidget.tsx',
    ]) {
      expect(read(f), f).toMatch(/notifyConnectionsChanged\(\)/)
    }
    // members/page.tsx: its one funnel for accept / decline / withdraw.
    expect(read('app/(member)/members/page.tsx'))
      .toMatch(/const handleConnectionChange = useCallback\(\(updated: ConnectionRecord \| null, removed\?: string\) => \{[\s\S]{0,200}?notifyConnectionsChanged\(\)/)
  })
})
