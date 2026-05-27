'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import NotificationBell from '@/components/NotificationBell'
import { resolveImageUrl } from '@/lib/data'
import { motion, AnimatePresence } from 'framer-motion'
import { usePendingConnections } from '@/hooks/usePendingConnections'
import { neighborhoodToSlug } from '@/lib/neighborhoods'

function MessagesIcon() {
  const [unread, setUnread] = useState(0)
  const { isLoggedIn } = useAuth()
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
  return (
    <Link href="/messages" className="relative p-2 rounded-xl hover:bg-gray-100 transition-colors" aria-label="Messages">
      <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
      {unread > 0 && (
        <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  )
}

function SearchButton({ className }: { className?: string }) {
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-all ${className}`}
      aria-label="Search"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <span className="hidden lg:inline text-xs">Search</span>
      <kbd className="hidden lg:inline text-xs font-mono bg-gray-100 border border-gray-200 rounded px-1 py-0.5 leading-none">⌘K</kbd>
    </button>
  )
}

const roleBadge: Record<string, string> = {
  admin:     'bg-amber-100 text-amber-700',
  moderator: 'bg-violet-100 text-violet-700',
  host:      'bg-blue-100 text-blue-700',
  member:    'bg-gray-100 text-gray-600',
}

// Primary nav — the three things people do most. Stay flat in the bar.
const primaryLinks = [
  { label: 'Events',  href: '/events',  public: true },
  { label: 'Clubs',   href: '/clubs',   public: true },
  { label: 'Members', href: '/members', public: true },
]

// Everything else lives under a "Discover ▾" dropdown so the bar stays calm.
// Adding new content sections in the future drops in here instead of bloating
// the top row.
const discoverLinks = [
  { label: 'Neighborhoods', href: '/neighborhoods', emoji: '🏘️', public: true },
  { label: 'Board',         href: '/listings',      emoji: '🛍️', public: true },
  { label: 'Guide',         href: '/guide',         emoji: '🗺️', public: true },
  { label: 'Visiting?',     href: '/visiting',      emoji: '👋', public: true },
]

const pageTitles: [string, string][] = [
  ['/admin',         'Admin'],
  ['/host',          'Host Panel'],
  ['/events',        'Events'],
  ['/clubs',         'Clubs'],
  ['/members',       'Members'],
  ['/listings',      'Board'],
  ['/messages',      'Messages'],
  ['/notifications', 'Notifications'],
  ['/profile',       'My Profile'],
  ['/my-events',     'My Events'],
  ['/invite',        'Invite'],
  ['/dashboard',     'Dashboard'],
  ['/onboarding',    'Onboarding'],
  ['/reviews',       'Reviews'],
  ['/perks',         'Perks'],
  ['/apply',         'Apply'],
]

function getPageTitle(pathname: string): string {
  for (const [prefix, title] of pageTitles) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return title
  }
  return ''
}

export default function Navbar() {
  const pathname  = usePathname()
  const { user, logout, isLoggedIn } = useAuth()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [discoverOpen, setDiscoverOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const discoverRef = useRef<HTMLDivElement>(null)
  const pendingConnections = usePendingConnections()
  const pageTitle = getPageTitle(pathname)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
      if (discoverRef.current && !discoverRef.current.contains(e.target as Node)) {
        setDiscoverOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Close the Discover menu on any route change so it doesn't linger after
  // clicking an item.
  useEffect(() => { setDiscoverOpen(false) }, [pathname])

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  const activeClass = 'text-amber-700 bg-amber-100 font-semibold'
  const inactiveClass = 'text-gray-600 font-medium hover:text-gray-900 hover:bg-gray-100'

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-gray-100 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 relative">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group z-10">
            <span className="text-2xl">😊</span>
            <span className="font-bold text-lg tracking-tight text-gray-900 group-hover:text-amber-600 transition-colors">
              Smileys Community
            </span>
          </Link>


          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {primaryLinks.filter(link => isLoggedIn || link.public).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`relative px-4 py-2 rounded-lg text-sm transition-colors ${
                  isActive(link.href) ? activeClass : inactiveClass
                }`}
              >
                {link.label}
                {link.href === '/members' && pendingConnections > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {pendingConnections > 9 ? '9+' : pendingConnections}
                  </span>
                )}
              </Link>
            ))}

            {/* Discover ▾ — groups everything that isn't Events/Clubs/Members
                so the bar stays calm as new content sections get added. */}
            <div className="relative" ref={discoverRef}>
              {(() => {
                const visible = discoverLinks.filter(link => isLoggedIn || link.public)
                const anyActive = visible.some(link => isActive(link.href))
                return (
                  <>
                    <button
                      onClick={() => setDiscoverOpen(v => !v)}
                      className={`flex items-center gap-1 px-4 py-2 rounded-lg text-sm transition-colors ${
                        anyActive ? activeClass : inactiveClass
                      }`}
                    >
                      Discover
                      <svg className={`w-3 h-3 transition-transform ${discoverOpen ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {discoverOpen && (
                      <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-xl border border-gray-100 shadow-lg overflow-hidden py-1 z-50">
                        {visible.map(link => (
                          <Link
                            key={link.href}
                            href={link.href}
                            className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                              isActive(link.href)
                                ? 'bg-amber-50 text-amber-700 font-semibold'
                                : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            <span className="text-base">{link.emoji}</span>
                            <span>{link.label}</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>

            {user.role === 'admin' && (
              <Link
                href="/admin"
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  isActive('/admin') ? activeClass : inactiveClass
                }`}
              >
                Admin Panel
              </Link>
            )}
            {user.role === 'moderator' && (
              <Link
                href="/admin/moderator"
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  isActive('/admin/moderator')
                    ? 'text-violet-700 bg-violet-100 font-semibold'
                    : inactiveClass
                }`}
              >
                Mod Panel
              </Link>
            )}
            {user.isClubHost && (
              <Link
                href="/host"
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  isActive('/host')
                    ? 'text-blue-700 bg-blue-100 font-semibold'
                    : inactiveClass
                }`}
              >
                Host Panel
              </Link>
            )}
          </nav>

          {/* Right side */}
          <div className="hidden md:flex items-center gap-2 z-10">
            <SearchButton />

            {!isLoggedIn ? (
              <div className="flex items-center gap-2">
                <Link href="/why" className={`px-4 py-2 rounded-lg text-sm transition-colors ${isActive('/why') ? activeClass : inactiveClass}`}>
                  Why Smileys
                </Link>
                <Link href="/about" className={`px-4 py-2 rounded-lg text-sm transition-colors ${isActive('/about') ? activeClass : inactiveClass}`}>
                  About
                </Link>
                <Link href="/login" className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-colors">
                  Sign in
                </Link>
                <Link href="/apply" className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors">
                  Apply to join
                </Link>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <MessagesIcon />
                <NotificationBell />
                <Link href="/card" aria-label="Member card" className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </Link>
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl hover:bg-gray-100 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: user.color }}>
                      {user.profilePhoto
                        ? <img src={resolveImageUrl(user.profilePhoto)} alt={user.name} className="w-full h-full object-cover" />
                        : user.initials}
                    </div>
                    <div className="text-left">
                      <div className="text-xs font-semibold text-gray-900 leading-tight">{user.name}</div>
                      <div className={`text-xs font-semibold px-1.5 py-0.5 rounded-full inline-block leading-tight ${roleBadge[user.role]}`}>
                        {user.role}
                      </div>
                    </div>
                    <svg className="w-3.5 h-3.5 text-gray-400 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <AnimatePresence>
                  {dropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: -8 }}
                      animate={{ opacity: 1, scale: 1,    y: 0  }}
                      exit={{    opacity: 0, scale: 0.95, y: -8 }}
                      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                      className="absolute right-0 top-full mt-2 w-56 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden z-50"
                      style={{ originX: 1, originY: 0 }}
                    >
                      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                        <p className="text-xs text-gray-500 font-medium mb-0.5">Signed in as</p>
                        <p className="text-sm font-bold text-gray-900">{user.name}</p>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${roleBadge[user.role]}`}>{user.role}</span>
                      </div>
                      <div className="px-3 pt-2 pb-2 space-y-0.5">
                        {user.role === 'admin' && (
                          <Link href="/admin" onClick={() => setDropdownOpen(false)} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-amber-600 hover:bg-amber-50 transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                            Admin Panel
                          </Link>
                        )}
                        {user.role === 'moderator' && (
                          <Link href="/admin/moderator" onClick={() => setDropdownOpen(false)} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-violet-600 hover:bg-violet-50 transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                            Mod Panel
                          </Link>
                        )}
                        {user.isClubHost && (
                          <Link href="/host" onClick={() => setDropdownOpen(false)} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                            Host Panel
                          </Link>
                        )}

                        {(user.role === 'admin' || user.role === 'moderator' || user.isClubHost) && (
                          <div className="my-1 h-px bg-gray-100" />
                        )}

                        <Link href="/profile" onClick={() => setDropdownOpen(false)} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                          My Profile
                        </Link>
                        {user.neighborhood && (
                          <Link href={`/neighborhoods/${neighborhoodToSlug(user.neighborhood)}#wall`} onClick={() => setDropdownOpen(false)} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                            My Neighbourhood
                          </Link>
                        )}
                        <Link href="/card" onClick={() => setDropdownOpen(false)} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                          My Membership Card
                        </Link>
                        <Link href="/my-events" onClick={() => setDropdownOpen(false)} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m-6-2v2M5 9h14M5 11h14M5 19l7-7 7 7" /></svg>
                          My Events & Tickets
                        </Link>
                        <Link href="/contacts" onClick={() => setDropdownOpen(false)} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          Contacts
                        </Link>
                        <Link href="/messages" onClick={() => setDropdownOpen(false)} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                          Messages
                        </Link>
                        <Link href="/profile-visitors" onClick={() => setDropdownOpen(false)} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                          Profile Visitors
                        </Link>
                        <Link href="/settings" onClick={() => setDropdownOpen(false)} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          Settings
                        </Link>
                        <Link href="/invite" onClick={() => setDropdownOpen(false)} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                          Invite a Friend
                        </Link>

                        <div className="my-1 h-px bg-gray-100" />

                        <button onClick={async () => { await logout(); setDropdownOpen(false) }} className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                          Sign out
                        </button>
                      </div>
                    </motion.div>
                  )}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>

          {/* Mobile right */}
          <div className="flex md:hidden items-center gap-0.5 z-10">
            {isLoggedIn ? (
              <>
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}
                  className="p-2 rounded-xl hover:bg-gray-100 transition-colors"
                  aria-label="Search"
                >
                  <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
                <MessagesIcon />
                <NotificationBell />
                <Link href="/card" aria-label="Member card" className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
                  <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </Link>
              </>
            ) : (
              <Link href="/login" className="px-3 py-1.5 rounded-xl bg-amber-500 text-white text-sm font-semibold">Sign in</Link>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
