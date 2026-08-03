'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import NotificationBell from '@/components/NotificationBell'
import AccountMenu from '@/components/AccountMenu'
import { resolveImageUrl } from '@/lib/data'
import { usePendingConnections } from '@/hooks/usePendingConnections'

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
  member:    'bg-gray-100 text-gray-700',
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
  // Smileys Cup 2026 nav entry removed post-tournament (recap published as
  // its own Community post); /cup page + data stay live for anyone linking
  // in from there or a bookmark, just no longer in primary nav.
  { label: 'Hangouts',      href: '/hangouts',      emoji: '☕', public: false },
  { label: 'Guide',         href: '/guide',         emoji: '🗺️', public: true  },
  { label: 'Handbook',      href: '/handbook',      emoji: '📖', public: true  },
  { label: 'Neighborhoods', href: '/neighborhoods', emoji: '🏘️', public: true  },
  { label: 'Community Board', href: '/board',       emoji: '💬', public: true  },
  { label: 'Marketplace',     href: '/marketplace', emoji: '🛍️', public: true  },
  { label: 'Directory',     href: '/directory',     emoji: '🏢', public: true  },
  { label: 'Visiting?',     href: '/visiting',      emoji: '👋', public: true  },
]

const pageTitles: [string, string][] = [
  ['/admin',         'Admin'],
  ['/host',          'Host Panel'],
  ['/events',        'Events'],
  ['/clubs',         'Clubs'],
  ['/members',       'Members'],
  ['/board',       'Board'],
  ['/marketplace', 'Marketplace'],
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
  ['/cup',           'Smileys World Cup'],
  ['/directory',     'Business Directory'],
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
                            <span aria-hidden="true" className="text-base">{link.emoji}</span>
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
                  Why Smileys?
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
                  <div
                    className={`absolute right-0 top-full mt-2 w-56 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden z-50 transition-all duration-150 origin-top-right ${
                      dropdownOpen ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'
                    }`}
                  >
                    <AccountMenu onItemClick={() => setDropdownOpen(false)} />
                  </div>
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
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
                <MessagesIcon />
                <NotificationBell />
                <Link href="/card" aria-label="Member card" className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </Link>
              </>
            ) : (
              <Link href="/login" className="px-4 py-2.5 min-h-[44px] inline-flex items-center rounded-xl bg-amber-500 text-white text-sm font-semibold">Sign in</Link>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
