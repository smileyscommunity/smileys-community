'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'

// The nav's Cities entry. Populated from /api/cities at runtime — never a
// hard-coded list — so a city an admin takes live appears here without a
// deploy. Live cities link to their page; everything else is listed but not
// linked anywhere it can disappoint, matching the homepage cards.

interface City { slug: string; name: string; country: string; status: string }

export default function CitiesMenu({
  className = '',
  variant = 'dropdown',
  onNavigate,
  initial = [],
}: {
  className?: string
  // Server-rendered city list from the layout. Without it the menu was absent
  // from the HTML until a client fetch resolved — invisible to crawlers, and a
  // pop-in for a nav item that's meant to be first-class.
  initial?: City[]
  // 'inline' renders the list flat, for the mobile menu panel — a dropdown
  // inside an already-open drawer is a second thing to tap for no reason.
  variant?: 'dropdown' | 'inline'
  onNavigate?: () => void
}) {
  const [cities, setCities] = useState<City[]>(initial)
  const [open, setOpen]     = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Already server-rendered — don't spend a request re-fetching what we have.
    if (initial.length > 0) return
    fetch('/app/api/cities')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (Array.isArray(d)) setCities(d) })
      .catch(() => {})   // nav degrades to no menu rather than throwing
  }, [initial.length])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Nothing to show until the list loads.
  if (cities.length === 0) return null

  const live  = cities.filter(c => c.status === 'live')
  const soon  = cities.filter(c => c.status !== 'live')

  const rows = (
    <>
      {live.map(c => (
        <Link
          key={c.slug}
          href={`/${c.slug}`}
          onClick={() => { setOpen(false); onNavigate?.() }}
          className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 rounded-xl transition-colors"
        >
          <span className="font-semibold">{c.name}</span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-600">
            <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Live
          </span>
        </Link>
      ))}

      {soon.length > 0 && (
        <>
          <div className="mt-1 pt-2 border-t border-gray-100">
            <p className="px-4 pb-1 text-[11px] font-bold uppercase tracking-wider text-gray-400">Coming soon</p>
          </div>
          {soon.map(c => (
            // Goes to the city's own page, not the apply form. The page is
            // where the action lives — "Notify me" for signed-in members, the
            // application for guests — and a menu entry should navigate, not
            // dump you into a form you may not need.
            <Link
              key={c.slug}
              href={`/${c.slug}`}
              onClick={() => { setOpen(false); onNavigate?.() }}
              className="flex items-center justify-between gap-2 px-4 py-2 text-sm text-gray-500 hover:bg-gray-50 rounded-xl transition-colors"
            >
              <span>{c.name}</span>
              <span className="text-[11px] font-semibold text-amber-600">Coming soon</span>
            </Link>
          ))}
        </>
      )}
    </>
  )

  if (variant === 'inline') return <div className={className}>{rows}</div>

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors inline-flex items-center gap-1"
      >
        Cities
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-60 bg-white rounded-2xl shadow-lg border border-gray-100 py-2 z-50">
          {rows}
        </div>
      )}
    </div>
  )
}
