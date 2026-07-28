'use client'

import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { neighborhoodToSlug } from '@/lib/neighborhoods'

interface LinkItem {
  label: string
  href: string
  icon: string
  isAction?: boolean
}

const BASE_LINKS: LinkItem[] = [
  { label: 'My tickets & QR',   href: '/my-events',       icon: '🎟' },
  { label: 'Browse events',     href: '/events',           icon: '🗓️' },
  { label: 'Explore clubs',     href: '/clubs',            icon: '🏛️' },
  { label: 'Meet members',      href: '/members',          icon: '🤝' },
  // neighborhood wall injected here when available
  { label: 'Profile visitors',  href: '/profile-visitors', icon: '👀' },
  { label: 'Notifications',     href: '/notifications',    icon: '🔔' },
  { label: 'Member Card',       href: '/card',             icon: '🪪' },
  { label: 'Community Board',   href: '/board',         icon: '📋' },
  { label: 'Istanbul Guide',    href: '/guide',            icon: '🗺️' },
  { label: 'The Handbook',      href: '/handbook',         icon: '📖' },
  { label: 'Community Rules',   href: '/guidelines',       icon: '📜' },
  { label: 'Install App',       href: '#install',          icon: '📲', isAction: true },
]

export default function QuickLinks() {
  const { user } = useAuth()
  const wallLink: LinkItem | null = user.neighborhood
    ? { label: `${user.neighborhood} wall`, href: `/neighborhoods/${neighborhoodToSlug(user.neighborhood)}#wall`, icon: '📍' }
    : null
  const LINKS = wallLink ? [...BASE_LINKS.slice(0, 4), wallLink, ...BASE_LINKS.slice(4)] : BASE_LINKS
  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <h2 className="text-base font-bold text-gray-900 mb-3">Quick links</h2>
      <div className="space-y-1">
        {LINKS.map(l => (
          l.isAction ? (
            <button
              key={l.label}
              onClick={(e) => {
                const btn = e.currentTarget
                btn.style.opacity = '0.5'
                setTimeout(() => btn.style.opacity = '1', 200)
                window.dispatchEvent(new CustomEvent('show-install-prompt'))
              }}
              className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-gray-50 transition-colors group text-left"
            >
              <span className="text-base w-5 text-center text-gray-400">{l.icon}</span>
              <span className="text-sm text-gray-700 group-hover:text-amber-600 transition-colors font-medium">{l.label}</span>
              <svg className="w-3.5 h-3.5 text-gray-300 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <Link key={l.href} href={l.href}
              className="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-gray-50 transition-colors group">
              <span className="text-base w-5 text-center text-gray-400">{l.icon}</span>
              <span className="text-sm text-gray-700 group-hover:text-amber-600 transition-colors font-medium">{l.label}</span>
              <svg className="w-3.5 h-3.5 text-gray-300 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )
        ))}
      </div>
    </div>
  )
}
