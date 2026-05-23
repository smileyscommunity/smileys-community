'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import Link from 'next/link'

export default function PartnerLayout({ children }: { children: ReactNode }) {
  const { user, isLoading, isLoggedIn } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (isLoading) return
    if (!isLoggedIn || user.role !== 'partner' || !user.partnerId) {
      router.replace('/login')
    }
  }, [user, isLoading, isLoggedIn, router])

  if (isLoading || !isLoggedIn || user.role !== 'partner') return null

  const navItems = [
    { label: 'Dashboard', href: '/partner', icon: '▦' },
    { label: 'Settings', href: '/partner/settings', icon: '⚙' },
  ]

  return (
    <div className="flex h-screen bg-black overflow-hidden">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-zinc-900 border-r border-zinc-800 transform transition-transform duration-200 ease-in-out md:static md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 h-full flex flex-col">
          <div className="text-xl font-bold text-white mb-8">Partner Portal</div>
          <nav className="flex-1 space-y-1">
            {navItems.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${pathname === item.href ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'}`}
              >
                <span className="text-lg">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-6 bg-zinc-900/50 backdrop-blur-sm">
          <button className="md:hidden text-zinc-400" onClick={() => setSidebarOpen(true)}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-400">{user.name}</span>
            <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-bold text-white">
              {user.name?.[0]}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-black">
          {children}
        </main>
      </div>
    </div>
  )
}
