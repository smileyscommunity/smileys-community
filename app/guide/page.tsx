// ISR — the two Prisma groupBys (events-per-neighborhood, members-
// per-neighborhood) don't change second-by-second, and the rest of
// the page is static JSON. Revalidating every 5 min cuts the DB load
// from every-request to once-per-5-min while keeping the "Live"
// neighborhood ordering effectively current. The per-viewer CTA
// moved to a small client island (./GuideCTA) so the cookie read
// doesn't force-dynamic the whole route.
export const revalidate = 300

import { readFileSync } from 'fs'
import { join } from 'path'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { neighborhoodToSlug, getNeighborhoodMeta } from '@/lib/neighborhoods'
import TransitLinks, { categoryId, type Category } from '@/components/TransitLinks'
import GuideCTA from './GuideCTA'
import GuideStickyNav from './GuideStickyNav'

interface Banner {
  id: string; type: string; active: boolean
  headline: string; subtitle: string; emoji: string; link: string; cta: string
}

function loadBanner(): Banner | null {
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'banners.json'), 'utf-8'))
    const list: Banner[] = Array.isArray(raw?.guide) ? raw.guide : []
    return list.find(b => b.active && b.headline) ?? null
  } catch { return null }
}

const COLOR_MAP: Record<string, string> = {
  blue:   'bg-blue-100 text-blue-700',
  green:  'bg-green-100 text-green-700',
  amber:  'bg-amber-100 text-amber-700',
  rose:   'bg-rose-100 text-rose-700',
  violet: 'bg-violet-100 text-violet-700',
  teal:   'bg-teal-100 text-teal-700',
  orange: 'bg-orange-100 text-orange-700',
}

const BADGE_COLOR_MAP: Record<string, string> = {
  '':      'bg-amber-100 text-amber-700',
  blue:    'bg-blue-100 text-blue-700',
  green:   'bg-green-100 text-green-700',
  violet:  'bg-violet-100 text-violet-700',
  rose:    'bg-rose-100 text-rose-700',
}

// Dev-only: surface unknown color keys from data/city-guide.json so a
// typo doesn't silently fall back to blue/amber in prod. Prod stays
// quiet — a bad key still renders, just in the fallback color.
function pickColor(map: Record<string, string>, key: string | undefined, fallback: string, source: string) {
  const hit = map[key ?? '']
  if (hit) return hit
  if (process.env.NODE_ENV !== 'production' && key) {
    console.warn(`[guide] unknown ${source} color "${key}" — falling back. Add it to the map or fix the JSON.`)
  }
  return fallback
}

function loadGuide(): Category[] {
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'city-guide.json'), 'utf8'))
    return (raw.categories ?? []).map((cat: any) => ({
      icon:      cat.icon,
      label:     cat.label,
      color:     pickColor(COLOR_MAP, cat.color, COLOR_MAP.blue, 'category'),
      updatedAt: cat.updatedAt,
      resources: (cat.resources ?? []).map((r: any) => ({
        title:       r.title,
        description: r.description,
        href:        r.href || undefined,
        badge:       r.badge || undefined,
        badgeColor:  r.badge ? pickColor(BADGE_COLOR_MAP, r.badgeColor, BADGE_COLOR_MAP[''], 'badge') : undefined,
        tip:         r.tip  || undefined,
      })),
    }))
  } catch {
    return []
  }
}

export default async function GuidePage() {
  const today = new Date().toISOString().split('T')[0]

  const [eventCounts, memberCounts] = await Promise.all([
    prisma.event.groupBy({
      by:      ['neighborhood'],
      where:   { status: 'published', date: { gte: today } },
      _count:  { _all: true },
      orderBy: { _count: { neighborhood: 'desc' } },
      take:    10,
    }),
    prisma.user.groupBy({
      by:    ['neighborhood'],
      where: { status: 'approved', neighborhood: { not: null } },
      _count: { _all: true },
    }),
  ])

  const memberMap = Object.fromEntries(memberCounts.map(m => [m.neighborhood, m._count._all]))

  const neighborhoods = eventCounts
    .filter(n => n.neighborhood)
    .map(n => {
      const meta = getNeighborhoodMeta(n.neighborhood!)
      return {
        name:    n.neighborhood!,
        slug:    neighborhoodToSlug(n.neighborhood!),
        events:  n._count._all,
        members: memberMap[n.neighborhood!] ?? 0,
        emoji:   meta.emoji,
        vibe:    meta.vibe,
        side:    meta.side,
      }
    })

  const categories = loadGuide()
  // Dev-only: surface empty guide content so a missing/invalid
  // data/city-guide.json doesn't silently render a gap where the
  // category list should be.
  if (process.env.NODE_ENV !== 'production' && categories.length === 0) {
    console.warn('[guide] loadGuide() returned no categories — TransitLinks section will be skipped. Check data/city-guide.json.')
  }
  const banner = loadBanner()

  const navItems = [
    ...categories.map(c => ({ id: categoryId(c.label), icon: c.icon, label: c.label })),
    ...(neighborhoods.length > 0 ? [{ id: 'neighborhoods', icon: '🏘️', label: 'Neighborhoods' }] : []),
  ]

  return (
    <div className="min-h-screen bg-white">

      {/* Hero — typographic, no avatar block. Gives the title and
          tagline more breathing room and removes the icon-vs-text
          alignment that was crowding mobile. */}
      <div className="bg-gradient-to-b from-amber-50/40 to-white border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 pb-6">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-2">🗺️ Istanbul Guide</p>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-gray-900 tracking-tight leading-[1.05]">
            Quick links members trust.
          </h1>
          <p className="text-base text-gray-600 leading-relaxed mt-3 max-w-xl">
            Apps, services, and websites for getting around and settling into Istanbul — vetted by the Smileys team. Updated regularly.
          </p>
        </div>
      </div>

      {/* Sticky quick-jump nav — client island, runs IntersectionObserver
          scrollspy to highlight the section the user is currently
          reading. `scroll-mt-16` on each section anchor keeps the
          in-view header just below the sticky bar (~52px tall). */}
      <GuideStickyNav navItems={navItems} />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-0">

        {/* Banner — one inner per banner.type, then wrap in <a> (or
            fragment) depending on whether banner.link is set. Was 6
            nearly-identical JSX trees (link × no-link, ×3 types);
            now 3. The sponsored variant's group-hover:text-amber-300
            on the headline only fires when the parent <a> carries
            the 'group' class — inert otherwise, which is the no-link
            behaviour. */}
        {banner && (() => {
          const inner =
            banner.type === 'strip' ? (
              <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2.5">
                <span className="text-lg shrink-0">{banner.emoji}</span>
                <p className="flex-1 text-sm font-semibold text-amber-900 truncate">{banner.headline}</p>
                {banner.cta && <span className="text-xs font-bold text-amber-600 shrink-0">{banner.cta} →</span>}
              </div>
            ) : banner.type === 'promo' ? (
              <div className="flex items-center gap-3 bg-gradient-to-r from-amber-500 to-orange-400 rounded-2xl px-4 py-3 relative overflow-hidden">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white uppercase tracking-widest mb-0.5">From Smileys</p>
                  <p className="text-sm font-bold text-white truncate">{banner.headline}</p>
                  {banner.subtitle && <p className="text-xs text-amber-50 truncate">{banner.subtitle}</p>}
                </div>
                <div className="shrink-0 w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-2xl">{banner.emoji}</div>
              </div>
            ) : (
              <div className="flex items-center gap-3 bg-gradient-to-r from-gray-900 to-gray-700 rounded-2xl px-4 py-3 overflow-hidden relative">
                <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_80%_50%,#f59e0b_0%,transparent_60%)]" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-0.5">Sponsored</p>
                  <p className="text-sm font-bold text-white truncate group-hover:text-amber-300 transition-colors">{banner.headline}</p>
                  {banner.subtitle && <p className="text-xs text-gray-300 truncate">{banner.subtitle}</p>}
                </div>
                <div className="shrink-0 w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-2xl">{banner.emoji}</div>
              </div>
            )
          return (
            <div className="mb-6">
              {banner.link ? (
                <a href={banner.link} target="_blank" rel="noopener noreferrer" className="block group">
                  {inner}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : inner}
            </div>
          )
        })()}

        {/* Two cross-links sit side-by-side on tablet+ (one row, less
            vertical noise) and stack on mobile. Both lead to a different
            shape of help — Visiting for newcomers passing through,
            Handbook for the deep how-to reads. Single grid replaces the
            two stacked banner cards that previously dominated the top
            of the page. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
          <Link href="/visiting"
            className="bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-2xl px-4 py-3.5 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="text-xl shrink-0">👋</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-amber-900 leading-tight">Visiting first?</p>
                <p className="text-xs text-amber-700 mt-0.5 line-clamp-1">Post your dates — locals reach out.</p>
              </div>
              <span className="text-sm font-bold text-amber-600 shrink-0 group-hover:translate-x-0.5 transition-transform">→</span>
            </div>
          </Link>
          <Link href="/handbook"
            className="bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-2xl px-4 py-3.5 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="text-xl shrink-0">📖</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 leading-tight">Settling in?</p>
                <p className="text-xs text-gray-600 mt-0.5 line-clamp-1">The Handbook — long-form how-tos.</p>
              </div>
              <span className="text-sm font-bold text-gray-700 shrink-0 group-hover:translate-x-0.5 transition-transform">→</span>
            </div>
          </Link>
        </div>

        {categories.length > 0 && <TransitLinks categories={categories} />}

        {/* Neighborhoods — header redesigned to match the new
            TransitLinks section style (title + meta line) instead of
            the cramped single-row flexbox that was overlapping the
            "Live" pill on narrow screens. scroll-mt-16 keeps the
            heading clear of the sticky quick-jump nav when jumped to. */}
        {neighborhoods.length > 0 && (
          <div className="border-t border-gray-100 pt-10 scroll-mt-16" id="neighborhoods">
            <div className="mb-6">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl flex items-center justify-center text-xl bg-amber-100 text-amber-700 shrink-0">
                  🏘️
                </span>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight leading-tight">
                  Neighborhoods
                </h2>
              </div>
              <div className="mt-2 ml-[52px] flex items-center gap-2 text-xs font-medium">
                <span className="inline-flex items-center gap-1 text-green-700" aria-label="Live — neighborhoods are sorted by upcoming-event count in real time">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" aria-hidden="true" />
                  Live
                </span>
                <span className="text-gray-300">·</span>
                <span className="text-gray-400">{neighborhoods.length} {neighborhoods.length === 1 ? 'area' : 'areas'}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {neighborhoods.map(n => (
                <Link key={n.slug} href={`/neighborhoods/${n.slug}`}
                  className="group bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-amber-200 transition-all flex flex-col justify-center">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl shrink-0 mt-0.5">{n.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-sm font-semibold text-gray-900 group-hover:text-amber-700 transition-colors truncate">
                          {n.name}
                        </span>
                        <span className="shrink-0 text-xs text-gray-500 tabular-nums">
                          {n.events} event{n.events !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 truncate">{n.vibe}</p>
                      {n.members > 0 && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {n.members} local member{n.members !== 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            <p className="text-xs text-gray-400 text-center mt-4">
              Sorted by upcoming events ·{' '}
              <Link href="/neighborhoods" className="text-amber-600 hover:underline">See all neighborhoods</Link>
            </p>
          </div>
        )}

        {/* CTA — client island, branches on useAuth().isLoggedIn.
            Lives outside the cached server tree so the same HTML can
            be served to members and visitors. */}
        <GuideCTA />

      </div>
    </div>
  )
}
