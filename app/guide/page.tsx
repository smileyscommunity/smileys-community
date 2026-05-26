export const dynamic = 'force-dynamic'

import { readFileSync } from 'fs'
import { join } from 'path'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { neighborhoodToSlug, getNeighborhoodMeta } from '@/lib/neighborhoods'
import TransitLinks, { categoryId, type Category } from '@/components/TransitLinks'

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

function loadGuide(): Category[] {
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'city-guide.json'), 'utf8'))
    return (raw.categories ?? []).map((cat: any) => ({
      icon:      cat.icon,
      label:     cat.label,
      color:     COLOR_MAP[cat.color] ?? COLOR_MAP.blue,
      updatedAt: cat.updatedAt,
      resources: (cat.resources ?? []).map((r: any) => ({
        title:       r.title,
        description: r.description,
        href:        r.href || undefined,
        badge:       r.badge || undefined,
        badgeColor:  r.badge ? (BADGE_COLOR_MAP[r.badgeColor] ?? BADGE_COLOR_MAP['']) : undefined,
        tip:         r.tip  || undefined,
      })),
    }))
  } catch {
    return []
  }
}

export default async function GuidePage() {
  const today = new Date().toISOString().split('T')[0]
  // Public route — guide is readable by non-members so it can pull in prospects
  // from Google. We branch the CTA at the bottom of the page on this.
  const session = await getSession()

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
        events:  typeof n._count === 'object' && '_all' in n._count ? (n._count as any)._all : 0,
        members: memberMap[n.neighborhood!] ?? 0,
        emoji:   meta.emoji,
        vibe:    meta.vibe,
        side:    meta.side,
      }
    })

  const categories = loadGuide()
  const banner = loadBanner()

  const navItems = [
    ...categories.map(c => ({ id: categoryId(c.label), icon: c.icon, label: c.label })),
    ...(neighborhoods.length > 0 ? [{ id: 'neighborhoods', icon: '🏘️', label: 'Neighborhoods' }] : []),
  ]

  return (
    <div className="min-h-screen bg-white">

      {/* Hero */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 pb-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-500 flex items-center justify-center text-2xl shadow-sm shrink-0">
              🗺️
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-1">Member Resource</p>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight leading-tight">
                Istanbul City Guide
              </h1>
              <p className="text-base text-gray-500 leading-relaxed mt-2 max-w-xl">
                Practical, vetted resources for getting around and settling into Istanbul — put together by the Smileys team and updated regularly.
              </p>
            </div>
          </div>
        </div>

        {/* Quick-jump nav */}
        <div className="border-t border-gray-100">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            <div className="flex gap-1.5 overflow-x-auto py-3 scrollbar-hide">
              {navItems.map(item => (
                <a key={item.id} href={`#${item.id}`}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-gray-600 hover:text-amber-700 hover:bg-amber-50 border border-gray-200 hover:border-amber-200 transition-colors whitespace-nowrap">
                  <span>{item.icon}</span>
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-0">

        {/* Banner */}
        {banner && (
          <div className="mb-10">
            {banner.link ? (
              <a href={banner.link} target="_blank" rel="noopener noreferrer" className="block group">
                {banner.type === 'strip' ? (
                  <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                    <span className="text-lg shrink-0">{banner.emoji}</span>
                    <p className="flex-1 text-sm font-semibold text-amber-900 truncate">{banner.headline}</p>
                    {banner.cta && <span className="text-xs font-bold text-amber-600 shrink-0">{banner.cta} →</span>}
                  </div>
                ) : banner.type === 'promo' ? (
                  <div className="flex items-center gap-3 bg-gradient-to-r from-amber-500 to-orange-400 rounded-2xl px-4 py-3 relative overflow-hidden">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-amber-100 uppercase tracking-widest mb-0.5">From Smileys</p>
                      <p className="text-sm font-bold text-white truncate">{banner.headline}</p>
                      {banner.subtitle && <p className="text-xs text-amber-100 truncate">{banner.subtitle}</p>}
                    </div>
                    <div className="shrink-0 w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-2xl">{banner.emoji}</div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 bg-gradient-to-r from-gray-900 to-gray-700 rounded-2xl px-4 py-3 overflow-hidden relative group">
                    <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_80%_50%,#f59e0b_0%,transparent_60%)]" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-0.5">Sponsored</p>
                      <p className="text-sm font-bold text-white truncate group-hover:text-amber-300 transition-colors">{banner.headline}</p>
                      {banner.subtitle && <p className="text-xs text-gray-400 truncate">{banner.subtitle}</p>}
                    </div>
                    <div className="shrink-0 w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-2xl">{banner.emoji}</div>
                  </div>
                )}
              </a>
            ) : banner.type === 'strip' ? (
              <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                <span className="text-lg shrink-0">{banner.emoji}</span>
                <p className="flex-1 text-sm font-semibold text-amber-900 truncate">{banner.headline}</p>
                {banner.cta && <span className="text-xs font-bold text-amber-600 shrink-0">{banner.cta} →</span>}
              </div>
            ) : banner.type === 'promo' ? (
              <div className="flex items-center gap-3 bg-gradient-to-r from-amber-500 to-orange-400 rounded-2xl px-4 py-3 relative overflow-hidden">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-amber-100 uppercase tracking-widest mb-0.5">From Smileys</p>
                  <p className="text-sm font-bold text-white truncate">{banner.headline}</p>
                  {banner.subtitle && <p className="text-xs text-amber-100 truncate">{banner.subtitle}</p>}
                </div>
                <div className="shrink-0 w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-2xl">{banner.emoji}</div>
              </div>
            ) : (
              <div className="flex items-center gap-3 bg-gradient-to-r from-gray-900 to-gray-700 rounded-2xl px-4 py-3 overflow-hidden relative">
                <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_80%_50%,#f59e0b_0%,transparent_60%)]" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-0.5">Sponsored</p>
                  <p className="text-sm font-bold text-white truncate">{banner.headline}</p>
                  {banner.subtitle && <p className="text-xs text-gray-400 truncate">{banner.subtitle}</p>}
                </div>
                <div className="shrink-0 w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-2xl">{banner.emoji}</div>
              </div>
            )}
          </div>
        )}

        <TransitLinks categories={categories} />

        {/* Neighborhoods */}
        {neighborhoods.length > 0 && (
          <div className="border-t border-gray-100 pt-14" id="neighborhoods">
            <div className="flex items-center gap-3 mb-5">
              <span className="w-9 h-9 rounded-xl flex items-center justify-center text-lg bg-amber-100 text-amber-700 shrink-0">
                🏘️
              </span>
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest flex-1">Neighborhoods</h2>
              <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-100 px-2.5 py-1 rounded-full shrink-0">
                ● Live
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {neighborhoods.map(n => (
                <Link key={n.slug} href={`/neighborhoods/${n.slug}`}
                  className="group bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-amber-200 transition-all block">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl shrink-0 mt-0.5">{n.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-sm font-semibold text-gray-900 group-hover:text-amber-700 transition-colors truncate">
                          {n.name}
                        </span>
                        <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide bg-amber-100 text-amber-700">
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
                  <div className="mt-2.5 pt-2.5 border-t border-gray-50">
                    <span className="text-xs font-semibold text-amber-600">Explore neighborhood →</span>
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

        {/* CTA — different copy for members vs visitors */}
        {session ? (
          <Link href="/contact?topic=guide"
            className="mt-14 block bg-gray-50 hover:bg-amber-50 border border-gray-100 hover:border-amber-200 rounded-2xl p-6 text-center transition-colors">
            <div className="text-2xl mb-2">💬</div>
            <p className="text-base font-bold text-gray-900 mb-1">Have a tip to share?</p>
            <p className="text-sm text-gray-500 max-w-xs mx-auto">
              Send your recommendations and we&apos;ll add the best ones here.
            </p>
          </Link>
        ) : (
          <div className="mt-14 bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl p-8 text-center text-white shadow-lg">
            <div className="text-3xl mb-3">😊</div>
            <p className="text-xl font-extrabold mb-2">Living in Istanbul?</p>
            <p className="text-sm text-amber-50 max-w-md mx-auto mb-5 leading-relaxed">
              Smileys is a curated community of locals and expats hosting events across Istanbul every week. Apply to join — it&apos;s free.
            </p>
            <Link href="/apply"
              className="inline-block px-6 py-3 bg-white text-amber-600 font-bold rounded-xl hover:bg-amber-50 transition-colors text-sm">
              Apply to join →
            </Link>
            <p className="text-xs text-amber-100 mt-4">
              Already a member? <Link href="/login" className="font-semibold underline">Sign in</Link>
            </p>
          </div>
        )}

      </div>
    </div>
  )
}
