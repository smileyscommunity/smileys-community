'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { resolveImageUrl } from '@/lib/data'
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

  const isInApp = pathname.startsWith('/admin') || pathname.startsWith('/host') || pathname.startsWith('/partner') ||
    ['/events', '/clubs', '/members', '/perks', '/dashboard', '/profile', '/my-events', '/notifications', '/pending', '/reviews', '/listings', '/messages', '/neighborhoods', '/invite', '/guide', '/hangouts', '/visiting', '/directory'].some(r => pathname === r || pathname.startsWith(r + '/'))
  if (!isLoggedIn || !isInApp) return null

  const photo = resolveImageUrl(user.profilePhoto)

  // Portal tabs: one per role/capability the user has — supports combinations like mod+host
  const portalTabs = (() => {
    const tabs = []

    if (user.role === 'admin') {
      tabs.push({
        href: '/admin', label: 'Admin',
        icon: (active: boolean) => (
          <svg className={`w-6 h-6 ${active ? 'text-amber-500' : 'text-gray-400'}`} fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      })
    } else if (user.role === 'moderator') {
      tabs.push({
        href: '/admin/moderator', label: 'Mod',
        icon: (active: boolean) => (
          <svg className={`w-6 h-6 ${active ? 'text-amber-500' : 'text-gray-400'}`} fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.8} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        ),
      })
    } else if (user.role === 'partner') {
      tabs.push({
        href: '/partner', label: 'Biz',
        icon: (active: boolean) => (
          <svg className={`w-6 h-6 ${active ? 'text-amber-500' : 'text-gray-400'}`} fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.8} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        ),
      })
    }

    // Host tab is additive — shows alongside any other role tab
    if (user.isClubHost) {
      tabs.push({
        href: '/host', label: 'Host',
        icon: (active: boolean) => (
          <svg className={`w-6 h-6 ${active ? 'text-amber-500' : 'text-gray-400'}`} fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.8} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        ),
      })
    }

    // Regular members (no role portal, not a host) get Hangouts as the 4th
    // tab — it's the most time-sensitive new feature (live, expiring windows).
    // Board, Visiting, Guide reachable via the desktop Discover dropdown +
    // the Profile-tab side menu.
    if (tabs.length === 0) {
      tabs.push({
        href: '/hangouts', label: 'Hangouts',
        icon: (active: boolean) => (
          <svg className={`w-6 h-6 ${active ? 'text-amber-500' : 'text-gray-400'}`} fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.8} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.24 17 6.657c1.79 2.79.53 4.34 0 5.343-1 2-1.5 4 0 6.657z" />
          </svg>
        ),
      })
    }

    return tabs
  })()

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
