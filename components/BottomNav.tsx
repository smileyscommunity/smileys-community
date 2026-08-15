'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { resolveImageUrl } from '@/lib/data'
import { isBottomNavRoute } from '@/lib/bottomNav'
import { usePendingConnections } from '@/hooks/usePendingConnections'
import { useState, useEffect, useCallback } from 'react'
import AccountMenu from '@/components/AccountMenu'

function useUnreadMessages(isLoggedIn: boolean) {
  const [unread, setUnread] = useState(0)
  const load = useCallback(() => {
    fetch('/app/api/messages', { credentials: 'include' })
      .then(r => r.json())
      .then((d: any[]) => setUnread(Array.isArray(d) ? d.reduce((s, c) => s + (c.unread ?? 0), 0) : 0))
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (!isLoggedIn) return
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [isLoggedIn, load])
  return unread
}

function useUnreadNotifications(isLoggedIn: boolean) {
  const [unread, setUnread] = useState(0)
  const load = useCallback(() => {
    fetch('/app/api/notifications', { credentials: 'include' })
      .then(r => r.json())
      .then((d: any[]) => setUnread(Array.isArray(d) ? d.filter((n: any) => !n.isRead).length : 0))
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (!isLoggedIn) return
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [isLoggedIn, load])
  return unread
}

export default function BottomNav() {
  const pathname  = usePathname()
  const { isLoggedIn, user } = useAuth()
  const pendingConnections    = usePendingConnections()
  const unreadMessages        = useUnreadMessages(isLoggedIn)
  const unreadNotifications   = useUnreadNotifications(isLoggedIn)
  // Mobile-only account sheet — opens when the avatar tab is tapped, gives
  // mobile users reach to everything in the desktop dropdown (Sign out,
  // Settings, Perks, Hangouts recap, etc.) that was otherwise unreachable.
  const [sheetOpen, setSheetOpen] = useState(false)
  useEffect(() => { setSheetOpen(false) }, [pathname])  // close on nav

  if (!isLoggedIn || !isBottomNavRoute(pathname)) return null

  const photo = resolveImageUrl(user.profilePhoto)

  // Role portals (Admin, Mod, Biz, Host) deliberately do NOT get a tab.
  // They're already one tap away in the Me sheet, and they're occasional tools
  // rather than daily navigation — an admin was seeing seven tabs, which makes
  // every target narrower for everyone. Hangouts stays for members with no
  // portal, since it's genuinely time-sensitive (live, expiring windows).
  const portalTabs = user.role === 'admin' || user.role === 'moderator' || user.role === 'partner' || user.isClubHost
    ? []
    : [{
        href: '/hangouts', label: 'Hangouts',
        icon: (active: boolean) => (
          <svg className={`w-6 h-6 ${active ? 'text-amber-500' : 'text-gray-400'}`} fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.8} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.24 17 6.657c1.79 2.79.53 4.34 0 5.343-1 2-1.5 4 0 6.657z" />
          </svg>
        ),
      }]


  // Ordered by how often a member actually taps them, not by importance:
  // Events is the highest-intent destination, Cities sits fourth because you
  // don't switch city daily. The header puts Cities first for a different
  // reason — there it frames what you're looking at; here frequency wins.
  const tabs = [
    {
      href: '/events',
      label: 'Events',
      badge: 0,
      icon: (active: boolean) => (
        <svg className={`w-6 h-6 ${active ? 'text-amber-500' : 'text-gray-400'}`} fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      href: '/clubs',
      label: 'Clubs',
      badge: 0,
      icon: (active: boolean) => (
        <svg className={`w-6 h-6 ${active ? 'text-amber-500' : 'text-gray-400'}`} fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      href: '/members',
      label: 'Members',
      badge: pendingConnections,
      icon: (active: boolean) => (
        <svg className={`w-6 h-6 ${active ? 'text-amber-500' : 'text-gray-400'}`} fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.8} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
    },
    {
      href: '/cities',
      label: 'Cities',
      badge: 0,
      icon: (active: boolean) => (
        <svg className={`w-6 h-6 ${active ? 'text-amber-500' : 'text-gray-400'}`} fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.8} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.8} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    ...portalTabs.map(t => ({ ...t, badge: 0 })),
  ]

  const isProfileActive = ['/profile', '/dashboard', '/my-events', '/notifications', '/messages', '/contacts', '/invite', '/settings', '/card'].some(
    p => pathname === p || pathname.startsWith(p + '/')
  )

  return (
    <>
      {/* Spacer so page content isn't hidden behind the fixed bar */}
      <div className="h-16 md:hidden" />
      <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white/90 backdrop-blur-md border-t border-gray-100 safe-area-pb">
        <div className="flex">
          {tabs.map(tab => {
            const active = pathname === tab.href || pathname.startsWith(tab.href + '/')
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 relative"
              >
                <div className={`relative flex items-center justify-center w-12 h-7 rounded-full transition-colors ${active ? 'bg-amber-50' : ''}`}>
                  {tab.icon(active)}
                  {tab.badge > 0 && (
                    <span className="absolute -top-1 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                      {tab.badge > 9 ? '9+' : tab.badge}
                      <span className="sr-only">pending</span>
                    </span>
                  )}
                </div>
                <span className={`text-[10px] font-semibold ${active ? 'text-amber-600' : 'text-gray-400'}`}>
                  {tab.label}
                </span>
              </Link>
            )
          })}

          {/* Profile / Me tab — was a direct link to /profile; now opens the
              AccountMenu sheet so mobile users can reach Sign out + Settings
              + Perks + Hangouts recap + everything else that used to be
              desktop-dropdown-only. Tap-to-open, swipe/backdrop to close. */}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 relative"
          >
            <div className={`relative flex items-center justify-center w-12 h-7 rounded-full transition-colors ${isProfileActive ? 'bg-amber-50' : ''}`}>
              <div
                className={`w-6 h-6 rounded-full overflow-hidden flex items-center justify-center text-white text-[9px] font-bold ring-2 transition-all ${isProfileActive ? 'ring-amber-500' : 'ring-transparent'}`}
                style={{ backgroundColor: user.color }}
              >
                {photo
                  ? <img src={photo} alt={user.name} className="w-full h-full object-cover" />
                  : user.initials}
              </div>
              {(unreadMessages + unreadNotifications) > 0 && (
                <span className="absolute -top-1 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  {(unreadMessages + unreadNotifications) > 9 ? '9+' : (unreadMessages + unreadNotifications)}
                  <span className="sr-only">unread</span>
                </span>
              )}
            </div>
            <span className={`text-[10px] font-semibold ${isProfileActive ? 'text-amber-600' : 'text-gray-400'}`}>
              Me
            </span>
          </button>
        </div>
      </nav>

      {/* Mobile account sheet — slides up from the bottom on avatar tap,
          dismissed via backdrop or by tapping a menu item. Renders the
          same AccountMenu shared with the desktop dropdown so the two
          surfaces never drift. */}
      <div
        className={`fixed inset-0 z-[60] bg-black/40 md:hidden transition-opacity duration-150 ${sheetOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setSheetOpen(false)}
        aria-hidden="true"
      />
      <div
        className={`fixed bottom-0 left-0 right-0 z-[61] bg-white rounded-t-3xl shadow-2xl max-h-[85vh] overflow-y-auto md:hidden safe-area-pb transition-transform duration-[220ms] ease-out ${sheetOpen ? 'translate-y-0' : 'translate-y-full'}`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        <AccountMenu onItemClick={() => setSheetOpen(false)} />
      </div>
    </>
  )
}
