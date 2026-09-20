'use client'

import { createContext, useContext, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import posthog from 'posthog-js'
import { resetCurrentCity } from '@/hooks/useCurrentCity'
import { forgetPushDevice } from '@/lib/pushDevice'
import { clearCachedRosters } from '@/lib/hostPanel'
import { drainQueue } from '@/lib/checkinQueue'
import { forgetCachedCardToken } from '@/lib/memberCard'
import type { ReactNode } from 'react'
import type { AppUser } from '@/lib/auth'

interface AuthContextType {
  user: AppUser
  setUser: (user: AppUser) => void
  logout: () => Promise<void>
  isLoading: boolean
  isLoggedIn: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

const GUEST: AppUser = {
  id:       'guest',
  name:     'Guest',
  initials: 'G',
  color:    '#d1d5db',
  role:     'member',
}

export function AuthProvider({ children, initialUser = null }: { children: ReactNode; initialUser?: AppUser | null }) {
  const router = useRouter()
  // The layout hands over the session it already resolved server-side, so a
  // signed-in member's first paint is signed-in — every full page load (and
  // city switches are full loads by design) used to flash the guest navbar
  // and the amber "Apply to join" footer band until /api/auth/me resolved.
  // Only a POSITIVE identification is trusted: a null can be baked into a
  // statically prerendered page (build time has no cookies), so null keeps
  // the old behavior — stay "loading" until /me answers.
  const [user,      setUser]      = useState<AppUser>(initialUser ?? GUEST)
  const [isLoading, setIsLoading] = useState(!initialUser)
  const [isLoggedIn, setIsLoggedIn] = useState(!!initialUser)

  useEffect(() => {
    // Still refreshed even when the server seeded us: /me carries the full
    // profile (club-host flags, joined events…) the slim session doesn't.
    fetch('/app/api/auth/me')
      // A server error isn't "signed out" — /me no longer ends the session on
      // one, so keep whoever the server seeded rather than downgrading.
      .then(res => res.status >= 500 ? Promise.reject(res.status) : res.json())
      .then(data => {
        if (data?.id) {
          const initials = data.name.trim().split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
          setUser({ ...data, initials, joinedEvents: [] })
          setIsLoggedIn(true)
        } else {
          // Definitive "no session" from the server (revoked/expired between
          // SSR and now) — downgrade, so gated pages bounce instead of
          // showing a member shell that every API call will 401 under.
          // Network failures land in .catch and change nothing.
          setUser(GUEST)
          setIsLoggedIn(false)
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [])

  async function logout() {
    // Shared devices: the push row addressing this phone still belongs to the
    // member signing out, so the next one to sign in here would get their
    // pushes. Removed first, while the session cookie can still authorize the
    // DELETE. Never throws and never waits on a missing service worker.
    await forgetPushDevice()
    // Same reasoning, for what the door left behind: the cached roster of
    // any event this host ran (names, photos, who was marked absent) and any
    // check-in tap still waiting for signal. Both outlive the session and
    // neither is keyed to the member who cached it.
    clearCachedRosters()
    // The member's own card code, cached so the card opens with no signal.
    // Keyed by member id, so it was never another member's to read — but a
    // signed credential shouldn't outlive the session that fetched it.
    forgetCachedCardToken()
    // Check-ins tapped at a door with no signal go first, before anything is
    // cleared: the banner promised they would send. Whatever still can't go
    // stays on the device — it is a list of ids, not a profile, and throwing
    // away arrivals would turn people who came into no-shows.
    await drainQueue().catch(() => 0)
    await fetch('/app/api/auth/logout', { method: 'POST' })
    resetCurrentCity()
    // Drop the auth-scoped SW cache (/app/api/events/attending) so on a
    // shared device, the next user signing in doesn't get the previous
    // user's offline-cached events. See public/sw.js message handler.
    if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'clear-auth-cache' })
    }
    // Clear the cached distinctId so subsequent events on this browser don't
    // attribute to the previous user. Also opt back in — if the prior session
    // was staff we opted out at login, and reset() doesn't undo that.
    posthog.reset()
    posthog.opt_in_capturing()
    setUser(GUEST)
    setIsLoggedIn(false)
    router.push('/login')
  }

  function login(u: AppUser) {
    resetCurrentCity()
    setUser(u)
    setIsLoggedIn(true)
  }

  return (
    <AuthContext.Provider value={{ user, setUser: login, logout, isLoading, isLoggedIn }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
