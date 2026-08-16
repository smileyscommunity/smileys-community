'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

// The nav's one city control. Populated from /api/cities at runtime — never a
// hard-coded list — so a city an admin takes live appears here without a
// deploy. Live cities link to their page; everything else is listed but not
// linked anywhere it can disappoint, matching the homepage cards.
//
// It answers "which city am I in?" as well as "where else are you?", because
// splitting those into two adjacent dropdowns taught nobody anything: a
// separate switcher shipped alongside this menu and was never mounted, so
// picking a city here navigated and left no trace of what was picked. The
// button now carries the answer.
//
// For a signed-in member, picking a live city is a VIEW change — it sets the
// cookie the server scopes events, clubs and the board by, grants no
// permissions anywhere (authorization reads session.cityId, never this), and
// "Back to <home>" always undoes it. For a guest there is no such state, so
// picking a city is plain navigation and the button stays labelled "Cities".

interface City { slug: string; name: string; country: string; status: string }

export default function CitiesMenu({
  className = '',
  variant = 'dropdown',
  onNavigate,
  initial = [],
  homeSlug,
  viewingSlug,
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
  // Both from the layout, so they're server truth. homeSlug doubles as the
  // signed-in signal: useAuth() reports logged-out for a moment on first
  // paint, and a control that renamed itself a beat after load would be
  // worse than one that never changed.
  homeSlug?: string
  viewingSlug?: string
}) {
  const router = useRouter()
  const [cities, setCities] = useState<City[]>(initial)
  const [open, setOpen]     = useState(false)
  const [busy, setBusy]     = useState(false)
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

  const signedIn = !!homeSlug
  // The city being viewed: the cookie if one is set, otherwise home. Guests
  // have neither, and the control says "Cities" rather than claiming a city
  // they never chose.
  const current  = signedIn ? live.find(c => c.slug === (viewingSlug || homeSlug)) : undefined
  const away     = !!current && current.slug !== homeSlug

  async function switchTo(slug: string | null) {
    if (busy) return
    setBusy(true)
    try {
      const res = slug
        ? await fetch('/app/api/me/view-city', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug }),
          })
        : await fetch('/app/api/me/view-city', { method: 'DELETE', credentials: 'include' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error ?? 'Could not switch city'); return }
      setOpen(false)
      onNavigate?.()
      // Land on the city you just switched to. Refreshing in place left members
      // on whatever page they happened to be on with silently different data —
      // switching city is a destination change, so it should look like one.
      // The refresh still matters: server components hold the city-scoped data.
      router.push(`/${slug ?? homeSlug ?? ''}`)
      router.refresh()
    } catch {
      toast.error('Could not switch city')
    } finally { setBusy(false) }
  }

  // The right-hand slot on a live row. Precedence is deliberate: what you're
  // looking at now beats what you belong to, which beats the generic fact that
  // a city is running — the most specific true thing wins the space.
  function badge(c: City) {
    if (current?.slug === c.slug) {
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-600">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Viewing
        </span>
      )
    }
    if (c.slug === homeSlug) {
      return <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Home</span>
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-600">
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Live
      </span>
    )
  }

  const liveRowClass = (c: City) =>
    `w-full text-left flex items-center justify-between gap-2 px-4 py-2.5 text-sm rounded-xl transition-colors ${
      current?.slug === c.slug
        ? 'bg-amber-50 text-amber-700 font-semibold'
        : 'text-gray-700 hover:bg-gray-50'
    }`

  const rows = (
    <>
      {live.map(c => (
        signedIn ? (
          <button
            key={c.slug}
            onClick={() => switchTo(c.slug === homeSlug ? null : c.slug)}
            disabled={busy}
            aria-current={current?.slug === c.slug ? 'true' : undefined}
            className={`${liveRowClass(c)} disabled:opacity-50`}
          >
            <span className="font-semibold">{c.name}</span>
            {badge(c)}
          </button>
        ) : (
          <Link
            key={c.slug}
            href={`/${c.slug}`}
            onClick={() => { setOpen(false); onNavigate?.() }}
            className={liveRowClass(c)}
          >
            <span className="font-semibold">{c.name}</span>
            {badge(c)}
          </Link>
        )
      ))}

      {away && (
        <div className="mt-1 pt-1 border-t border-gray-100">
          <button
            onClick={() => switchTo(null)}
            disabled={busy}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 rounded-xl transition-colors disabled:opacity-50"
          >
            ← Back to {live.find(c => c.slug === homeSlug)?.name ?? 'my city'}
          </button>
        </div>
      )}

      {soon.length > 0 && (
        <>
          <div className="mt-1 pt-2 border-t border-gray-100">
            <p className="px-4 pb-1 text-[11px] font-bold uppercase tracking-wider text-gray-400">Coming soon</p>
          </div>
          {soon.map(c => (
            // Goes to the city's own page, not the apply form. The page is
            // where the action lives — "Notify me" for signed-in members, the
            // application for guests — and a menu entry should navigate, not
            // dump you into a form you may not need. Never a view switch
            // either: there is nothing there to scope to yet.
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

      {/* A way to see the whole network, now that there's a page for it. */}
      <div className="mt-1 pt-1 border-t border-gray-100">
        <Link
          href="/cities"
          onClick={() => { setOpen(false); onNavigate?.() }}
          className="block px-4 py-2.5 text-sm font-semibold text-amber-600 hover:bg-gray-50 rounded-xl transition-colors"
        >
          Explore all cities →
        </Link>
      </div>
    </>
  )

  if (variant === 'inline') return <div className={className}>{rows}</div>

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        disabled={busy}
        className={`px-3 py-2 rounded-lg text-sm transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 ${
          away ? 'bg-amber-50 text-amber-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        {current && (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )}
        {current?.name ?? 'Cities'}
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-lg border border-gray-100 py-2 z-50">
          {signedIn && (
            <p className="px-4 pb-1 text-[11px] font-bold uppercase tracking-wider text-gray-400">Viewing</p>
          )}
          {rows}
        </div>
      )}
    </div>
  )
}
