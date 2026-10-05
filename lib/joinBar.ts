// Where the mobile sticky "Join Smileys" bar may appear. Pure, so the rule is
// testable; the component adds the viewer rules (guests only) and the scroll
// trigger. Paths are as usePathname() reports them — without the /app basePath.

// Pages where joining is the wrong ask or the page already carries its own
// sticky action: the application itself and the account flows, legal and
// contact pages, staff areas, the event teaser (its own bottom bar) and the
// visiting planner (StickyVisitCta).
const EXACT = ['/apply', '/login', '/forgot-password', '/reset-password', '/verify-email', '/activate',
  '/unsubscribe', '/appeal', '/contact', '/privacy', '/terms', '/cookies', '/guidelines', '/partner', '/pending']
const PREFIX = ['/apply/', '/admin', '/host/', '/visiting']

export function joinBarAllowed(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/'
  if (EXACT.includes(p)) return false
  if (PREFIX.some(x => p === x || p.startsWith(x.endsWith('/') ? x : `${x}/`))) return false
  // /events/<id> is the guest teaser with its own bar; /events and /events/today… are lists.
  if (/^\/events\/[^/]+$/.test(p) && !['today', 'this-week', 'this-weekend'].includes(p.split('/')[2])) return false
  return true
}

// With no hero CTA on the page to watch, the bar waits until the reader has
// scrolled well past the first screen — the navbar's small Join is the only
// call to action up there.
export const JOIN_BAR_SCROLL_FALLBACK_PX = 800
