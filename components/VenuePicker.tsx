'use client'

import { useEffect, useId, useRef, useState } from 'react'

// The event forms' "Venue name" field, with the business directory behind it.
// Typing searches the event city's live listings; picking one links the event
// to it (Event.businessId), which is what the event page's "View in directory"
// chip, the listing's "Smileys has been here", the survey's venue question and
// the review prompts all read. The link used to be the typed name alone, so a
// venue spelled any other way than its listing ("Dozze" / "Dozze Kadıköy")
// linked nothing.
//
// Editing the text after a pick drops the link: the link says the venue IS
// that listing. Leaving it unpicked is fine — on save the server links the
// listing that exact name has in the city, or files a pending one for review.

export type PickedVenue = {
  id: string
  name: string
  neighborhood?: string | null
  address?: string | null
  latitude?: number | null
  longitude?: number | null
}

export type LinkedVenue = { id: string; name: string; live?: boolean }

export default function VenuePicker({
  value, onText, venue, onVenue, cityParam, className, placeholder, required,
}: {
  value: string
  onText: (text: string) => void
  venue: LinkedVenue | null
  onVenue: (venue: PickedVenue | null) => void
  /** `city=<slug>` or `cityId=<id>` — the event's city; '' = the viewer's. */
  cityParam: string
  className: string
  placeholder?: string
  required?: boolean
}) {
  const [results, setResults] = useState<PickedVenue[]>([])
  const [open, setOpen]       = useState(false)
  const [active, setActive]   = useState(-1)
  const typed = useRef(false)
  const box   = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    // Only what the organiser types searches — not the value a loaded event
    // or a duplicate prefilled.
    if (!typed.current) return
    const q = value.replace(/\s+/g, ' ').trim()
    if (q.length < 2 || venue) { setResults([]); return }
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      fetch(`/app/api/admin/events/venues?q=${encodeURIComponent(q)}${cityParam ? `&${cityParam}` : ''}`, { credentials: 'include', signal: ctrl.signal })
        .then(r => r.ok ? r.json() : { venues: [] })
        .then(d => { setResults(Array.isArray(d?.venues) ? d.venues : []); setActive(-1) })
        .catch(() => {})
    }, 250)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [value, venue, cityParam])

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  function pick(v: PickedVenue) {
    onVenue(v)
    setOpen(false)
    setResults([])
  }

  const showList = open && !venue && results.length > 0

  return (
    <div ref={box} className="relative">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={e => {
          typed.current = true
          onText(e.target.value)
          if (venue) onVenue(null)
          setOpen(true)
        }}
        onKeyDown={e => {
          if (!showList) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(results.length - 1, i + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)) }
          else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(results[active]) }
          else if (e.key === 'Escape') setOpen(false)
        }}
        className={className}
      />
      {showList && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl">
          <li className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">In the directory</li>
          {results.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(r)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${i === active ? 'bg-zinc-800' : 'hover:bg-zinc-800'}`}
              >
                <span className="text-white">🏪 {r.name}</span>
                {r.neighborhood && <span className="text-zinc-500"> · {r.neighborhood}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {venue && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-emerald-400">
          <span>🏪 Linked to the directory listing <strong className="font-semibold">{venue.name}</strong>{venue.live === false && <span className="text-zinc-500"> (pending review)</span>}</span>
          <button type="button" onClick={() => onVenue(null)} className="text-zinc-500 underline hover:text-zinc-300">Unlink</button>
        </p>
      )}
    </div>
  )
}
