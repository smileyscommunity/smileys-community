'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import Sidebar, { ICON_PATHS } from '@/components/admin/Sidebar'
import { navItems, MODERATOR_BOTTOM_NAV, isModeratorPageAllowed } from '@/lib/adminNav'
import Topbar from '@/components/admin/Topbar'

function NavIcon({ name }: { name: string }) {
  const p = ICON_PATHS[name]
  if (!p) return null
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={p.d} />
      {p.d2 && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={p.d2} />}
    </svg>
  )
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const { user, isLoading, isLoggedIn } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const allowed  = user?.role === 'admin' || user?.role === 'moderator'
  const isMod    = user?.role === 'moderator'
  // Admins must enroll in 2FA before they see anything but /admin/security.
  // Moderators are exempt (their routes never pass requireStepUp anyway).
  const needs2fa = allowed && !isMod && !user?.totpEnabled && !pathname.startsWith('/admin/security')

  // Which pages a moderator may open is derived from the sidebar nav in
  // lib/adminNav — the two used to be separate lists and drifted.
  const isModPageAllowed = !isMod || isModeratorPageAllowed(pathname)

  useEffect(() => {
    if (isLoading) return
    if (!isLoggedIn) { router.replace('/login'); return }
    if (!allowed) { router.replace('/login'); return }
    if (needs2fa) { router.replace('/admin/security?require2fa=1'); return }
    if (!isModPageAllowed) router.replace('/admin/moderator')
  }, [user, isLoading, isLoggedIn, allowed, needs2fa, isModPageAllowed, router])

  if (isLoading || !isLoggedIn || !allowed || needs2fa || !isModPageAllowed) return null

  // Bottom nav derived from sidebar navItems — automatically includes every section
  const userRoles = [user.role, ...(user.isClubHost ? ['host'] : [])]
  const bottomNav = navItems.filter(item => item.roles.some(r => userRoles.includes(r)))
    .map(item => {
      const [hrefPath, hrefQuery] = item.href.split('?')
      const active = item.exact
        ? pathname === hrefPath
        : pathname.startsWith(hrefPath) && (!hrefQuery || (() => {
            const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
            const [key, val] = hrefQuery.split('=')
            return params.get(key) === val
          })())
      return { ...item, active }
    })

  return (
    <div className="flex h-dvh bg-black overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav — 6 pinned shortcuts + More */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-zinc-950 border-t border-white/5 flex">
        {(isMod ? MODERATOR_BOTTOM_NAV : [
          { label: 'Home',   href: '/admin',              icon: 'dashboard',    exact: true  },
          { label: 'Apps',   href: '/admin/applications', icon: 'applications', exact: false },
          { label: 'Events', href: '/admin/events',       icon: 'events',       exact: false },
          { label: 'Users',  href: '/admin/users',        icon: 'users',        exact: false },
          { label: 'Reports',href: '/admin/moderation',   icon: 'moderation',   exact: false },
          { label: 'Pay',    href: '/admin/payments',     icon: 'payments',     exact: false },
        ]).map(item => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href)
          return (
            <Link key={item.href} href={item.href}
              className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors ${
                active ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300'
              }`}>
              <NavIcon name={item.icon} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          )
        })}
        <button
          onClick={() => setSidebarOpen(true)}
          className="flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>
    </div>
  )
}
