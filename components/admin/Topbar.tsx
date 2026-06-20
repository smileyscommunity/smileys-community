'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { navItems } from './Sidebar'

function getPageTitle(pathname: string): string {
  const search = typeof window !== 'undefined' ? window.location.search : ''
  const params = new URLSearchParams(search)
  const match = [...navItems].reverse().find((item) => {
    const [hrefPath, hrefQuery] = item.href.split('?')
    if (item.exact) return pathname === hrefPath
    if (!pathname.startsWith(hrefPath)) return false
    if (hrefQuery) {
      const [key, val] = hrefQuery.split('=')
      return params.get(key) === val
    }
    return true
  })
  return match?.label ?? 'Admin'
}

interface ModCounts {
  pendingApplications: number
  pendingReports: number
  approvalQueueEvents: number
}

function AlertBadge({ count, label, href, color }: { count: number; label: string; href: string; color: string }) {
  if (!count) return null
  return (
    <Link
      href={href}
      className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors ${color}`}
    >
      <span className="font-bold">{count}</span>
      <span className="hidden sm:inline opacity-75">{label}</span>
    </Link>
  )
}

function ModPanel() {
  const [counts, setCounts] = useState<ModCounts | null>(null)

  useEffect(() => {
    fetch('/app/api/admin/mod-stats', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setCounts(d) })
  }, [])

  if (!counts) return null
  const total = counts.pendingApplications + counts.pendingReports + counts.approvalQueueEvents
  if (!total) return null

  return (
    <>
      {/* Mobile: single combined alert pill that links to Mod Home.
          Avoids the 3-badge cluster squeezing the page title on
          narrow screens. The colour leans on the highest-severity
          bucket present (reports = red, else amber). */}
      <Link href="/admin/moderator"
        className={`sm:hidden flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
          counts.pendingReports > 0
            ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20'
            : 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/20'
        }`}
        title={`${counts.pendingApplications} apps · ${counts.pendingReports} reports · ${counts.approvalQueueEvents} events`}>
        <span className="font-bold">{total}</span>
        <span className="opacity-75">●</span>
      </Link>

      {/* sm+ : keep the original three independent badges. */}
      <div className="hidden sm:flex items-center gap-1">
        <AlertBadge count={counts.pendingApplications} label="Applications" href="/admin/applications" color="bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/20" />
        <AlertBadge count={counts.pendingReports}       label="Reports"      href="/admin/moderation"   color="bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20"     />
        <AlertBadge count={counts.approvalQueueEvents}  label="Events"       href="/admin/events"       color="bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 border border-violet-500/20" />
      </div>
    </>
  )
}

interface Props {
  onMenuClick: () => void
}

export default function Topbar({ onMenuClick }: Props) {
  const pathname  = usePathname()
  const { user }  = useAuth()
  const pageTitle = getPageTitle(pathname)
  const isMod     = user?.role === 'moderator' || user?.role === 'admin'

  return (
    <div className="h-14 border-b border-white/5 flex items-center justify-between px-4 sm:px-6 shrink-0 bg-zinc-950/50 backdrop-blur-sm sticky top-0 z-30">

      {/* Left */}
      <div className="flex items-center gap-2">
        <button
          onClick={onMenuClick}
          className="md:hidden p-2.5 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <h1 className="text-sm font-semibold text-white">{pageTitle}</h1>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        {isMod && <ModPanel />}

        <div className="w-px h-5 bg-white/10 mx-1 hidden sm:block" />

        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200 px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          <span className="hidden sm:inline">View site</span>
        </Link>
      </div>
    </div>
  )
}
