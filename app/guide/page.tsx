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
import Image from 'next/image'
import { prisma } from '@/lib/prisma'
import { neighborhoodToSlug, getNeighborhoodMeta } from '@/lib/neighborhoods'
import GuideCTA from './GuideCTA'
import GuideStickyNav from './GuideStickyNav'
import ExperienceExplorer from './ExperienceExplorer'
import MyIstanbul from './MyIstanbul'
import IstanbulToday, { computeTodayPicks } from './IstanbulToday'
import { GUIDE_COLLECTIONS } from '@/lib/guide'
import { loadExperiences, loadRoutes } from '@/lib/guideContent'

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

  const banner = loadBanner()

  const experiences = loadExperiences()
  // De-duplication across homepage sections (reviewer feedback): the
  // explorer's default six lead; Istanbul Today picks around them; the
  // editorial Popular list picks around both. Collections stay the one
  // complete catalog.
  const defaultSix = experiences.slice(0, 6).map(e => e.slug)
  const todayPicks = computeTodayPicks(defaultSix)
  const shownAbove = new Set([...defaultSix, ...todayPicks.slugs])

  const navItems = [
    ...(experiences.length > 0 ? [
      { id: 'experiences', icon: '✨', label: 'Experiences' },
      { id: 'collections', icon: '🗂️', label: 'Collections' },
    ] : []),
    ...(neighborhoods.length > 0 ? [{ id: 'neighborhoods', icon: '🏘️', label: 'Neighborhoods' }] : []),
  ]

  return (
    <div className="min-h-screen bg-white">

      {/* Hero — typographic, no avatar block. Gives the title and
          tagline more breathing room and removes the icon-vs-text
          alignment that was crowding mobile. */}
      {/* Hero (§29) — the real photo. The left-heavy gradient is what keeps
          white copy readable over the bright sky and sunset; the image's
          subject (right of center) stays clear of the text block. */}
      <div className="relative bg-gray-900 overflow-hidden">
        <Image
          src="/app/images/guide-hero.jpg"
          alt="A traveler with a straw hat overlooking the Golden Horn at sunset, Galata Tower to the left, ferries crossing toward the old city"
          fill
          priority
          fetchPriority="high"
          sizes="100vw"
          className="object-cover object-center"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/45 to-black/15" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/50 to-transparent" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-12 sm:pt-20 sm:pb-16">
          <span className="inline-block bg-white/10 text-amber-300 text-xs font-bold tracking-[0.2em] uppercase rounded-full px-4 py-1.5 mb-4 backdrop-blur-sm">🗺️ Istanbul Guide</span>
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white max-w-3xl leading-tight">
            Experience Istanbul like you know someone here.
          </h1>
          <p className="text-base sm:text-lg text-gray-300 mt-4 max-w-2xl">
            Things worth doing, places worth discovering and experiences recommended by people who actually live here.
          </p>
          <div className="flex flex-wrap gap-3 mt-7">
            <a href="#experiences"
              className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
              Explore Istanbul
            </a>
            {experiences.length > 0 && (() => {
              /* Rotates with the page's ISR window — a genuinely different
                 action from the Explore anchor (the old second button
                 scrolled to essentially the same place). Retire when
                 "What should I do today?" becomes a full feature. */
              const surprise = experiences[Math.floor(Math.random() * experiences.length)]
              return (
                <Link href={`/guide/${surprise.slug}`}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-white/10 hover:bg-white/20 text-white text-sm font-bold rounded-xl transition-colors backdrop-blur-sm">
                  <span aria-hidden="true">🎲</span> Surprise me
                </Link>
              )
            })()}
          </div>
        </div>
      </div>

      {/* Sticky quick-jump nav — client island, runs IntersectionObserver
          scrollspy to highlight the section the user is currently
          reading. `scroll-mt-16` on each section anchor keeps the
          in-view header just below the sticky bar (~52px tall). */}
      <GuideStickyNav navItems={navItems} />

      {experiences.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10">
          {/* §4 — mood-based discovery over the full experience set. */}
          <div id="experiences" className="scroll-mt-16">
            <ExperienceExplorer experiences={experiences} />
          </div>

          {/* §6's first-timer strip moved to /visiting — same curated
              experiences were also reachable via the Explorer above and
              Collections below, so it was pure duplication on this page.
              "First time in Istanbul?" is /visiting's exact audience; the
              "Visiting first?" cross-link further down sends people there. */}

          {/* §5 — Istanbul Today: time + season aware suggestions. */}
          <IstanbulToday exclude={defaultSix} />

          {/* §12 — Popular Right Now, from real save/recommend counts.
              Below the engagement floor it falls back to an editorial
              list HONESTLY labelled as curated — never faked numbers. */}
          {await (async () => {
            const counts = await prisma.guideSave.groupBy({
              by: ['slug'],
              where: { OR: [{ saved: true }, { recommended: true }] },
              _count: { _all: true },
              orderBy: { _count: { slug: 'desc' } },
              take: 4,
            })
            const bySlug = new Map(experiences.map(e => [e.slug, e]))
            const dataDriven = counts.map(c => bySlug.get(c.slug)).filter((e): e is NonNullable<typeof e> => !!e)
            // Editorial fallback avoids everything already on screen above —
            // a "popular" row repeating the default grid read as filler.
            const editorial = experiences
              .filter(e => !shownAbove.has(e.slug))
              .slice(0, 4)
            const enough = dataDriven.length >= 3
            const list = enough ? dataDriven : editorial
            if (list.length === 0) return null
            return (
              <div className="mt-12">
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900 mb-1">
                  {enough ? 'Popular right now' : 'Popular with Smileys'}
                </h2>
                <p className="text-gray-600 mb-5">
                  {enough ? 'What members are saving and recommending.' : 'The experiences members keep coming back to.'}
                </p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {list.map(e => (
                    <Link key={e.slug} href={`/guide/${e.slug}`}
                      className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-amber-200 hover:shadow-md transition-all group">
                      <span aria-hidden="true" className="block text-3xl mb-2">{e.emoji}</span>
                      <p className="text-sm font-bold text-gray-900 leading-snug group-hover:text-amber-700 transition-colors">{e.title}</p>
                      <span className="inline-block text-xs font-bold text-amber-600 mt-2">Explore →</span>
                    </Link>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* §7 — collections: browsable shelves instead of category trees. */}
          <div id="collections" className="mt-12 scroll-mt-16">
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900 mb-6">Istanbul Collections</h2>
            <div className="space-y-8">
              {GUIDE_COLLECTIONS.map(col => {
                const items = experiences.filter(e => e.collection === col.value)
                if (items.length === 0) return null
                return (
                  <div key={col.value}>
                    <h3 className="text-sm font-bold text-gray-600 uppercase tracking-widest mb-3">
                      <span aria-hidden="true">{col.emoji}</span> {col.label}
                    </h3>
                    <div className="flex gap-3 overflow-x-auto pb-1 -mx-2 px-2">
                      {items.map(e => (
                        <Link key={e.slug} href={`/guide/${e.slug}`}
                          className="shrink-0 w-64 bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-amber-200 hover:shadow-md transition-all group">
                          <div className="flex items-center gap-2.5">
                            <span aria-hidden="true" className="text-2xl shrink-0">{e.emoji}</span>
                            <p className="text-sm font-bold text-gray-900 leading-snug group-hover:text-amber-700 transition-colors">{e.title}</p>
                          </div>
                          <p className="text-xs text-gray-500 mt-2 line-clamp-2">{e.tagline}</p>
                        </Link>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* §29 — routes: sequenced days built from the experiences. */}
          {(() => {
            const routes = loadRoutes()
            if (routes.length === 0) return null
            return (
              <div className="mt-12">
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900 mb-1">Make a day of it</h2>
                <p className="text-gray-600 mb-5">Curated routes that string the experiences together.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {routes.map(r => (
                    <Link key={r.slug} href={`/guide/routes/${r.slug}`}
                      className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:border-amber-200 hover:shadow-md hover:-translate-y-0.5 transition-all group">
                      <span aria-hidden="true" className="block text-3xl mb-2">{r.emoji}</span>
                      <p className="font-bold text-gray-900 leading-snug group-hover:text-amber-700 transition-colors">{r.title}</p>
                      <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{r.tagline}</p>
                      <span className="inline-block text-[11px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded-full px-2 py-0.5 mt-3">{r.time}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* §15/16 — experience it with people. Static cross-links in
              phase 1; live counts arrive with the save/social phase. */}
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Link href="/clubs" className="bg-white border border-gray-200 rounded-3xl p-6 sm:p-8 group hover:border-amber-300 hover:shadow-md transition-all">
              <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-2">Find your people</p>
              <p className="text-xl font-extrabold text-gray-900 leading-snug">Clubs for what you love</p>
              <p className="text-sm text-gray-600 mt-2">Sailing, hiking, brunch, live music — communities around every experience.</p>
              <span className="inline-block text-sm font-bold text-amber-600 mt-4 group-hover:translate-x-0.5 transition-transform">Explore clubs →</span>
            </Link>
            <Link href="/events" className="bg-gray-900 rounded-3xl p-6 sm:p-8 group relative overflow-hidden">
              <div aria-hidden="true" className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_80%_20%,#f59e0b_0%,transparent_60%)]" />
              <p className="relative text-xs font-bold text-amber-400 uppercase tracking-widest mb-2">Do it together</p>
              <p className="relative text-xl font-extrabold text-white leading-snug">Experience it at a Smileys event</p>
              <p className="relative text-sm text-gray-300 mt-2">Sailing, dinners, walks, live music — organized and waiting.</p>
              <span className="relative inline-block text-sm font-bold text-amber-400 mt-4 group-hover:translate-x-0.5 transition-transform">Browse events →</span>
            </Link>
            <Link href="/hangouts" className="bg-amber-500 rounded-3xl p-6 sm:p-8 group relative overflow-hidden">
              <p className="text-xs font-bold text-amber-100 uppercase tracking-widest mb-2">Right now</p>
              <p className="text-xl font-extrabold text-white leading-snug">Someone's probably doing it today</p>
              <p className="text-sm text-amber-50 mt-2">Spontaneous coffees, walks and plans — join a hangout.</p>
              <span className="inline-block text-sm font-bold text-white mt-4 group-hover:translate-x-0.5 transition-transform">See hangouts →</span>
            </Link>
          </div>

          {/* §18/§27 — the viewer's saved list. Client island; renders
              nothing for guests or empty lists. */}
          <MyIstanbul experiences={experiences.map(e => ({ slug: e.slug, title: e.title, emoji: e.emoji }))} />
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="max-w-3xl space-y-0">

        {/* IA cleanup: the practical quick-links block moved to /handbook
            (its canonical owner — "how Istanbul works"). The Guide keeps a
            compact pointer instead of a duplicate. */}
        <div className="border-t border-gray-100 mt-6 pt-8 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link href="/handbook"
            className="bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-2xl px-5 py-4 transition-colors group">
            <p className="text-sm font-bold text-gray-900"><span aria-hidden="true">📖</span> Understand Istanbul</p>
            <p className="text-xs text-gray-600 mt-1">Residence permits, banking, transport, quick links — the Handbook.</p>
            <span className="inline-block text-xs font-bold text-gray-700 mt-2 group-hover:translate-x-0.5 transition-transform">Read the Handbook →</span>
          </Link>
          <Link href="/directory"
            className="bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-2xl px-5 py-4 transition-colors group">
            <p className="text-sm font-bold text-gray-900"><span aria-hidden="true">🏢</span> Find what you need</p>
            <p className="text-xs text-gray-600 mt-1">Cafés, restaurants, services — member-vetted businesses.</p>
            <span className="inline-block text-xs font-bold text-gray-700 mt-2 group-hover:translate-x-0.5 transition-transform">Browse the Directory →</span>
          </Link>
        </div>

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

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {neighborhoods.slice(0, 6).map(n => (
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
    </div>
  )
}
