'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { canEnterHostPanel, canHostEvents, canHostClubs, canRunDoor } from '@/lib/auth'

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const { user, logout } = useAuth()

  const canEvents = canHostEvents(user)
  const canClubs  = canHostClubs(user)

  const navItems = [
    { label: 'Dashboard', href: '/host',          exact: true,  show: true       },
    { label: 'My Events', href: '/host/events',   exact: false, show: canEvents  },
    { label: 'My Clubs',  href: '/host/clubs',    exact: false, show: canClubs   },
    { label: 'Check-In',  href: '/host/checkin',  exact: false, show: canRunDoor(user) },
  ].filter(i => i.show)

  const isActive = (item: typeof navItems[0]) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href)

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden" onClick={onClose} />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-50 w-56 bg-black border-r border-zinc-800 p-4 flex flex-col overflow-y-auto
        transform transition-transform duration-200 ease-in-out
        md:static md:translate-x-0 md:shrink-0
        ${open ? 'translate-x-0' : '-translate-x-full'}
      `} aria-label="Host panel">
        <div className="flex items-center justify-between mb-1 px-3">
          <div className="text-xl font-bold text-white">Smileys</div>
          <button onClick={onClose} aria-label="Close menu" className="md:hidden p-1 text-zinc-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="text-xs text-zinc-500 mb-6 px-3">Host Panel</div>

        <nav className="space-y-1">
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={`block px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive(item)
                  ? 'bg-zinc-800 text-white font-medium'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex-1" />

        <div className="border-t border-zinc-800 pt-4 mt-4 shrink-0 safe-area-pb">
          {/* The member site's navbar and bottom nav stand aside on /host, so
              the way back to it lives here. */}
          <Link
            href="/dashboard"
            onClick={onClose}
            className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg text-sm text-zinc-300 hover:bg-zinc-900 hover:text-white transition-colors"
          >
            <BackIcon />
            Back to Smileys
          </Link>
          {user.role === 'moderator' && (
            <Link
              href="/admin/moderator"
              onClick={onClose}
              className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg text-sm font-semibold text-violet-400 hover:bg-violet-500/10 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Mod Panel
            </Link>
          )}
          <div className="flex items-center gap-3 px-3 mb-3">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ backgroundColor: user.color }}
            >
              {user.initials}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-white truncate">{user.name}</div>
              <div className="text-xs text-zinc-500 capitalize">{user.role} · Host</div>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full text-left px-3 py-2 text-xs text-zinc-400 hover:text-white hover:bg-zinc-900 rounded-lg transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>
    </>
  )
}

export default function HostLayout({ children }: { children: ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const { user, isLoading, isLoggedIn } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // The drawer closes on any navigation (Back included) and on Esc — the same
  // rule as the admin panel's.
  useEffect(() => { setSidebarOpen(false) }, [pathname])
  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

  // Club hosts, city-level hosts (consul / city-host grant), admins and
  // moderators. canEnterHostPanel is shared with the dashboard's own gates so
  // the two can't drift — they did, and the city roles reached neither.
  const mayEnter = isLoggedIn && canEnterHostPanel(user)

  useEffect(() => {
    if (isLoading) return
    if (!mayEnter) router.replace('/login')
  }, [mayEnter, isLoading, router])

  if (isLoading || !mayEnter) return null

  // A full-screen shell, like /admin: the member Navbar, Footer and bottom nav
  // stand aside on these routes (lib/bottomNav isHostPanelRoute), so the panel
  // owns the whole viewport and scrolls inside <main>. h-dvh, not h-screen —
  // on a phone 100vh runs under the browser's toolbar and hid the last rows.
  return (
    <div className="flex h-dvh bg-black overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <div className="md:hidden h-14 border-b border-zinc-800 flex items-center justify-between gap-2 px-4 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="text-sm font-semibold text-white">Host Panel</div>
          <Link
            href="/dashboard"
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white px-2 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <BackIcon />
            Smileys
          </Link>
        </div>
        {/* The installed app runs edge to edge (viewportFit cover): the last
            row — check-in's close-out button — must clear the home indicator. */}
        <main className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {children}
        </main>
      </div>
    </div>
  )
}

function BackIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
  )
}
