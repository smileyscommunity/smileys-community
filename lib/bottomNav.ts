// Shared with CookieBanner so its bottom-nav clearance offset can't drift
// from BottomNav's own visibility rule — BottomNav only renders for logged-in
// users on these routes, so anything outside them needn't reserve space for it.
export const BOTTOM_NAV_ROUTES = [
  '/events', '/clubs', '/members', '/perks', '/dashboard', '/profile', '/my-events',
  '/notifications', '/pending', '/reviews', '/board', '/messages', '/neighborhoods',
  '/invite', '/guide', '/hangouts', '/visiting', '/directory', '/marketplace',
  // The city index and each city's page — a Cities tab that vanishes on the
  // page it navigates to would strand members there.
  '/cities',
  // Meet the Hosts. It had the nav only by accident — the host panel's
  // startsWith('/host') matched it too — but it is a member-facing page like
  // the rest, so it keeps it on purpose now that the panel's rule is exact.
  '/hosts',
]

// A city switch lands on `/<slug>` (CitiesMenu does a full load to the city's
// page), and its hubs live at `/<slug>/events|clubs|directory|board`. None of
// those start with a fixed route, so the nav unmounted right after a switch
// and a phone user had no Me sheet — no Sign out — until they found the logo.
// Slugs come from the caller (the layout's server-rendered city list), since
// a bare `/<segment>` can't be told apart from `/login` or `/apply` by shape.
export function isCityRoute(pathname: string, citySlugs: readonly string[]): boolean {
  const first = pathname.split('/')[1]
  return !!first && citySlugs.includes(first)
}

/**
 * The host panel's own routes. `/hosts` — the public Meet the Hosts page — is
 * not one of them, which a bare startsWith('/host') got wrong. The member
 * Navbar, Footer and no-show strip stand aside here: the panel is a
 * full-height shell with its own navigation and its own way back.
 */
export function isHostPanelRoute(pathname: string | null | undefined): boolean {
  return !!pathname && (pathname === '/host' || pathname.startsWith('/host/'))
}

// Not /admin: the admin panel has its own bottom nav, and this one sat on top
// of it (z-50 over z-30), taking every tap at the bottom of an admin screen.
// Not /host either: the host panel fills the screen with its own shell, and
// this bar covered the bottom of it — the check-in page's close-out button
// sat underneath.
export function isBottomNavRoute(pathname: string, citySlugs: readonly string[] = []): boolean {
  return pathname.startsWith('/partner') ||
    BOTTOM_NAV_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/')) ||
    isCityRoute(pathname, citySlugs)
}
