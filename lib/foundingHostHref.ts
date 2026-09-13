import { canHostEvents, type AppUser } from '@/lib/auth'

// Where the founding-member panel's "Host the first thing" goes.
//
// It pointed at /host for everyone, but the host panel's layout only admits
// hosting authority (canEnterHostPanel) and router.replace('/login')s anyone
// else — so the plain members the panel is written for, in a city with no
// hosts yet, were bounced to the sign-in page while signed in. A plain member
// can't create events (the host events API needs the same authority), so
// their real next step is the "Host an event" pathway on /get-involved.
export function foundingHostHref(user: AppUser, isLoggedIn: boolean): string {
  if (!isLoggedIn) return `/login?from=${encodeURIComponent('/get-involved')}`
  return canHostEvents(user) ? '/host/events/new' : '/get-involved'
}
