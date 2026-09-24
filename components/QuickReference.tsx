'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

// The quick-reference page (/handbook/quick-reference): Istanbul's link pack
// from data/city-guide.json. It replaced TransitLinks, which rendered every
// item as a fully expanded card — ~55 cards, 10,000px on a laptop and
// 17,500px on a phone, with no way to jump between sections or find one
// thing. Now each item is a one-line row that opens in place, with a search
// box, section tabs, and the handful of items marked urgent pulled up top.
//
// Everything is still in the server-rendered HTML (a closed <details> keeps
// its content in the DOM), so crawlers read the same text as before.

export interface Resource {
  title: string
  description: string
  href?: string
  badge?: string
  tip?: string
}

export interface Category {
  icon: string
  label: string
  // ISO date — shown as "Updated Mon YYYY" so readers can tell whether
  // visa/banking/tax info is current.
  updatedAt?: string
  resources: Resource[]
}

// Section ids are the slugified label. Handbook articles deep-link to them
// (lib/handbook-links.ts), so this must not change shape.
export function categoryId(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}


// Badges that mean "deal with this early", as opposed to Admin Pick, which
// is a recommendation. These are the "Start here" strip.
const URGENT_BADGES = new Set(['essential', 'do first', 'do this first', 'start here', 'save these'])

// Case- and accent-blind, Turkish ı included, so "ikamet" finds "İkamet"
// and "doviz" finds "döviz".
function norm(s: string) {
  return s.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Row ids go through norm() first: plain toLowerCase() turns "İkamet" into
// "i" + a combining dot, which slugged to "i-kamet". Section ids above keep
// the old rule — articles already link to them, and the labels are ASCII.
function rowId(cat: Category, r: Resource) {
  return `${categoryId(cat.label)}--${categoryId(norm(r.title))}`
}

function linkLabel(href: string) {
  if (href.startsWith('/')) return 'Read the guide →'
  try { return `${new URL(href).hostname.replace(/^www\./, '')} ↗` } catch { return 'Open ↗' }
}

function Row({ cat, r, forceOpen }: { cat: Category; r: Resource; forceOpen: boolean }) {
  const external = !!r.href && !r.href.startsWith('/')
  return (
    // Remounted (key) when search toggles forceOpen, so a search result
    // opens without fighting the reader's own open/close state.
    <details id={rowId(cat, r)} open={forceOpen || undefined}
      className="group border-b border-gray-100 last:border-b-0 scroll-mt-36">
      <summary className="flex items-start gap-3 px-4 py-3.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-gray-50 transition-colors">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">{r.title}</span>
            {r.badge && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide bg-amber-100 text-amber-700">
                {r.badge}
              </span>
            )}
          </div>
          {/* One line when closed; the full text shows once open. */}
          <p className="text-sm text-gray-500 mt-0.5 line-clamp-1 group-open:hidden">{r.description}</p>
        </div>
        <svg aria-hidden="true" className="w-4 h-4 mt-1 text-gray-400 shrink-0 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-4 pb-4 -mt-1">
        <p className="text-sm text-gray-700 leading-relaxed">{r.description}</p>
        {r.tip && (
          <p className="mt-3 text-sm text-amber-900 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 leading-relaxed">
            <span aria-hidden="true">💡 </span>{r.tip}
          </p>
        )}
        {r.href && (
          external
            ? <a href={r.href} target="_blank" rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-amber-700 hover:text-amber-800">
                {linkLabel(r.href)}<span className="sr-only"> (opens in a new tab)</span>
              </a>
            : <Link href={r.href} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-amber-700 hover:text-amber-800">
                {linkLabel(r.href)}
              </Link>
        )}
      </div>
    </details>
  )
}

export default function QuickReference({ categories }: { categories: Category[] }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(() => categoryId(categories[0]?.label ?? ''))
  const q = norm(query.trim())

  const shown = useMemo(() => categories
    .map(cat => ({
      cat,
      items: q
        ? cat.resources.filter(r => norm(`${r.title} ${r.description} ${r.tip ?? ''} ${cat.label}`).includes(q))
        : cat.resources,
    }))
    .filter(s => s.items.length > 0), [categories, q])
  const matchCount = shown.reduce((n, s) => n + s.items.length, 0)

  const urgent = useMemo(() => {
    const seen = new Set<string>()
    return categories.flatMap(cat => cat.resources
      .filter(r => r.badge && URGENT_BADGES.has(r.badge.toLowerCase()))
      .map(r => ({ cat, r })))
      // "Emergency Numbers" and "Emergency: 112" are the same thing twice.
      .filter(({ r }) => { const k = r.title.includes('112') || /emergency/i.test(r.title) ? 'emergency' : r.title; if (seen.has(k)) return false; seen.add(k); return true })
  }, [categories])

  // Which section is on screen, for the tabs and the sidebar.
  useEffect(() => {
    if (q) return
    const els = categories.map(c => document.getElementById(categoryId(c.label))).filter((e): e is HTMLElement => !!e)
    const obs = new IntersectionObserver(entries => {
      const top = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (top) setActive(top.target.id)
    }, { rootMargin: '-140px 0px -60% 0px' })
    els.forEach(e => obs.observe(e))
    return () => obs.disconnect()
  }, [categories, q])

  // Keep the phone tab row's active chip in view as the reader scrolls —
  // otherwise "Visa & Residence" is highlighted somewhere off to the right.
  // Scrolls the row only (scrollIntoView would also move the page).
  useEffect(() => {
    const row = document.getElementById('qr-tabs')
    const chip = row?.querySelector<HTMLElement>(`[data-tab="${active}"]`)
    if (!row || !chip) return
    row.scrollTo({ left: chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth' })
  }, [active])

  // Arriving at #some-section from a Handbook article, or tapping a
  // "Start here" chip: open the row it points at.
  function openRow(id: string) {
    const el = document.getElementById(id)
    if (el instanceof HTMLDetailsElement) el.open = true
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (id.includes('--')) openRow(id)
  }, [])

  function jump(id: string) {
    setQuery('')
    setActive(id)
    // After the search clears and every section is back in the DOM.
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    history.replaceState(null, '', `#${id}`)
  }

  const tabs = categories.map(c => ({ id: categoryId(c.label), icon: c.icon, label: c.label }))

  return (
    <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
      {/* Desktop: the sections as a sidebar that stays in view. */}
      <nav aria-label="Sections" className="hidden lg:block">
        <ul className="sticky top-24 space-y-0.5">
          {tabs.map(t => (
            <li key={t.id}>
              <a href={`#${t.id}`} onClick={e => { e.preventDefault(); jump(t.id) }}
                aria-current={!q && active === t.id ? 'true' : undefined}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors ${
                  !q && active === t.id ? 'bg-amber-50 text-amber-800 font-semibold' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}>
                <span aria-hidden="true" className="text-base">{t.icon}</span>{t.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="max-w-3xl min-w-0">
        {/* Search, and on phones the section tabs — sticky under the navbar. */}
        <div className="sticky top-16 z-10 -mx-4 px-4 sm:mx-0 sm:px-0 pt-3 pb-3 bg-white/95 backdrop-blur border-b border-gray-100 lg:border-0">
          <div className="relative">
            <svg aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
            </svg>
            <input type="search" value={query} onChange={e => setQuery(e.target.value)}
              aria-label="Search the quick reference"
              placeholder="Search — SIM, taxi, residence permit, pharmacy…"
              className="w-full pl-10 pr-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent" />
          </div>
          <nav id="qr-tabs" aria-label="Sections" className="lg:hidden relative mt-3 -mx-4 px-4 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map(t => (
              <a key={t.id} data-tab={t.id} href={`#${t.id}`} onClick={e => { e.preventDefault(); jump(t.id) }}
                aria-current={!q && active === t.id ? 'true' : undefined}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  !q && active === t.id ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-gray-200 text-gray-700 hover:border-amber-300'
                }`}>
                <span aria-hidden="true">{t.icon}</span>{t.label}
              </a>
            ))}
          </nav>
        </div>

        {q ? (
          <p className="text-sm text-gray-500 mt-5" aria-live="polite">
            {matchCount === 0
              ? <>Nothing matches “{query.trim()}”. Try a shorter word, or browse the sections.</>
              : <>{matchCount} {matchCount === 1 ? 'result' : 'results'} for “{query.trim()}”</>}
          </p>
        ) : urgent.length > 0 && (
          <section aria-labelledby="qr-start" className="mt-6">
            <h2 id="qr-start" className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Start here</h2>
            {/* One swipeable row on phones — wrapped, the strip ran to seven
                lines and pushed the sections below the fold. */}
            <div className="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-2 overflow-x-auto sm:flex-wrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {urgent.map(({ cat, r }) => (
                <a key={rowId(cat, r)} href={`#${rowId(cat, r)}`}
                  onClick={e => { e.preventDefault(); openRow(rowId(cat, r)); history.replaceState(null, '', `#${rowId(cat, r)}`) }}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-50 border border-amber-100 text-sm font-medium text-amber-900 hover:bg-amber-100 transition-colors whitespace-nowrap">
                  <span aria-hidden="true">{cat.icon}</span>{r.title}
                </a>
              ))}
            </div>
          </section>
        )}

        <div className="mt-8 space-y-10">
          {shown.map(({ cat, items }) => (
            <section key={cat.label} id={categoryId(cat.label)} aria-labelledby={`${categoryId(cat.label)}-h`} className="scroll-mt-48 lg:scroll-mt-28">
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <h2 id={`${categoryId(cat.label)}-h`} className="text-xl font-extrabold text-gray-900 tracking-tight flex items-center gap-2">
                  <span aria-hidden="true">{cat.icon}</span>{cat.label}
                </h2>
                <span className="text-xs text-gray-400 shrink-0">
                  {cat.updatedAt
                    ? `Updated ${new Date(cat.updatedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
                    : `${cat.resources.length} items`}
                </span>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                {items.map(r => <Row key={q ? `q-${rowId(cat, r)}` : rowId(cat, r)} cat={cat} r={r} forceOpen={!!q} />)}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
