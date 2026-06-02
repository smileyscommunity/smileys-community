'use client'

import { createContext, useContext, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import posthog from 'posthog-js'
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [user,      setUser]      = useState<AppUser>(GUEST)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  useEffect(() => {
    fetch('/app/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (data?.id) {
          const initials = data.name.trim().split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
          setUser({ ...data, initials, joinedEvents: [] })
          setIsLoggedIn(true)
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [])

  async function logout() {
    await fetch('/app/api/auth/logout', { method: 'POST' })
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
