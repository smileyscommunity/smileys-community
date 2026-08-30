'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { canEnterHostPanel, canHostEvents, canHostClubs } from '@/lib/auth'

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const { user, logout } = useAuth()

  const canEvents = canHostEvents(user)
  const canClubs  = canHostClubs(user)

  const navItems = [
    { label: 'Dashboard', href: '/host',          exact: true,  show: true       },
    { label: 'My Events', href: '/host/events',   exact: false, show: canEvents  },
    { label: 'My Clubs',  href: '/host/clubs',    exact: false, show: canClubs   },
    { label: 'Check-In',  href: '/host/checkin',  exact: false, show: canEvents  },
  ].filter(i => i.show)

  const isActive = (item: typeof navItems[0]) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href)

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden" onClick={onClose} />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-50 w-56 bg-black border-r border-zinc-800 p-4 flex flex-col
        transform transition-transform duration-200 ease-in-out
        md:static md:translate-x-0 md:shrink-0
        ${open ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex items-center justify-between mb-1 px-3">
          <div className="text-xl font-bold text-white">Smileys</div>
          <button onClick={onClose} className="md:hidden p-1 text-zinc-400 hover:text-white">
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

        <div className="border-t border-zinc-800 pt-4 mt-4 shrink-0">
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
  const router = useRouter()
  const { user, isLoading, isLoggedIn } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Club hosts, city-level hosts (consul / city-host grant), admins and
  // moderators. canEnterHostPanel is shared with the dashboard's own gates so
  // the two can't drift — they did, and the city roles reached neither.
  const mayEnter = isLoggedIn && canEnterHostPanel(user)

  useEffect(() => {
    if (isLoading) return
    if (!mayEnter) router.replace('/login')
  }, [mayEnter, isLoading, router])

  if (isLoading || !mayEnter) return null

  return (
    <div className="flex h-screen bg-black overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <div className="md:hidden h-14 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="text-sm font-semibold text-white">Host Panel</div>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
            style={{ backgroundColor: user.color }}
          >
            {user.initials}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  )
}
