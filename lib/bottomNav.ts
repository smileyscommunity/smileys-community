// Shared with CookieBanner so its bottom-nav clearance offset can't drift
// from BottomNav's own visibility rule — BottomNav only renders for logged-in
// users on these routes, so anything outside them needn't reserve space for it.
export const BOTTOM_NAV_ROUTES = [
  '/events', '/clubs', '/members', '/perks', '/dashboard', '/profile', '/my-events',
  '/notifications', '/pending', '/reviews', '/board', '/messages', '/neighborhoods',
  '/invite', '/guide', '/hangouts', '/visiting', '/directory',
]

export function isBottomNavRoute(pathname: string): boolean {
  return pathname.startsWith('/admin') || pathname.startsWith('/host') || pathname.startsWith('/partner') ||
    BOTTOM_NAV_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'))
}
