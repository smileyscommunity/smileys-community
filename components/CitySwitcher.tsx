'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

// The member-facing city selector: which city's events, clubs and board am I
// looking at right now.
//
// Deliberately absent when there's only one live city — a dropdown with a
// single option is a control that does nothing, and it would imply a network
// that doesn't exist yet. It appears on its own the moment a second city goes
// live, with no code change.
//
// Switching is a view change, not a state change: it sets a cookie the server
// reads, grants no permissions anywhere, and "Back to <home>" always undoes it.

interface City { slug: string; name: string; status: string }

export default function CitySwitcher({
  cities,
  homeSlug,
  viewingSlug,
}: {
  cities: City[]
  homeSlug?: string
  viewingSlug?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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

  const live = cities.filter(c => c.status === 'live')
  // One city (or none) means nothing to switch between.
  if (live.length < 2) return null

  const current = live.find(c => c.slug === (viewingSlug || homeSlug)) ?? live[0]
  const away    = current.slug !== homeSlug

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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        disabled={busy}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors ${
          away ? 'bg-amber-50 text-amber-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        {current.name}
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-lg border border-gray-100 py-2 z-50">
          <p className="px-4 pb-1 text-[11px] font-bold uppercase tracking-wider text-gray-400">Viewing</p>
          {live.map(c => (
            <button
              key={c.slug}
              onClick={() => switchTo(c.slug === homeSlug ? null : c.slug)}
              className={`w-full text-left flex items-center justify-between gap-2 px-4 py-2.5 text-sm transition-colors ${
                c.slug === current.slug ? 'bg-amber-50 text-amber-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span>{c.name}</span>
              {c.slug === homeSlug && <span className="text-[11px] text-gray-400 uppercase tracking-wide">Home</span>}
            </button>
          ))}
          {away && (
            <div className="mt-1 pt-1 border-t border-gray-100">
              <button
                onClick={() => switchTo(null)}
                className="w-full text-left px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Back to {live.find(c => c.slug === homeSlug)?.name ?? 'my city'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
