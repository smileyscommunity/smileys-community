'use client'

import { useState, useEffect } from 'react'

type BannerType = 'sponsored' | 'promo' | 'strip'
type BannerPage = 'dashboard' | 'events' | 'clubs' | 'members' | 'neighborhoods'

interface Banner {
  active:   boolean
  type:     BannerType
  headline: string
  subtitle: string
  emoji:    string
  link:     string
  cta:      string
}

function Inner({ b }: { b: Banner }) {
  if (b.type === 'promo') {
    return (
      <div className="flex items-center gap-3 bg-gradient-to-r from-amber-500 to-orange-400 rounded-2xl px-4 py-3 overflow-hidden relative">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_20%_50%,#fff_0%,transparent_60%)]" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-amber-100 uppercase tracking-widest mb-0.5">From Smileys</p>
          <p className="text-sm font-bold text-white leading-snug truncate">{b.headline}</p>
          {b.subtitle && <p className="text-xs text-amber-100 truncate">{b.subtitle}</p>}
          {b.cta && <p className="text-xs font-bold text-white mt-0.5">{b.cta} →</p>}
        </div>
        <div className="shrink-0 w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-2xl">{b.emoji}</div>
      </div>
    )
  }

  if (b.type === 'strip') {
    return (
      <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
        <span className="text-lg shrink-0">{b.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900 truncate">{b.headline}</p>
          {b.subtitle && <p className="text-xs text-amber-700 truncate">{b.subtitle}</p>}
        </div>
        {b.cta && <span className="text-xs font-bold text-amber-600 shrink-0">{b.cta} →</span>}
      </div>
    )
  }

  // sponsored (default)
  return (
    <div className="flex items-center gap-3 bg-gradient-to-r from-gray-900 to-gray-700 rounded-2xl px-4 py-3 overflow-hidden relative group-hover:from-gray-800 transition-colors">
      <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_80%_50%,#f59e0b_0%,transparent_60%)]" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-0.5">Sponsored</p>
        <p className="text-sm font-bold text-white leading-snug truncate group-hover:text-amber-300 transition-colors">{b.headline}</p>
        {b.subtitle && <p className="text-xs text-gray-400 truncate">{b.subtitle}</p>}
        {b.cta && <p className="text-xs text-amber-400 font-semibold mt-0.5">{b.cta} →</p>}
      </div>
      <div className="shrink-0 w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-2xl">{b.emoji}</div>
    </div>
  )
}

export default function AdBannerStrip({ page }: { page: BannerPage }) {
  const [banner, setBanner] = useState<Banner | null>(null)

  useEffect(() => {
    fetch('/app/api/admin/banners', { credentials: 'include' })
      .then(r => r.json())
      .then((d: Record<BannerPage, Banner | Banner[]>) => {
        const raw = d?.[page]
        const list = Array.isArray(raw) ? raw : raw ? [raw] : []
        const active = list.find(b => b.active && b.headline)
        if (active) setBanner(active)
      })
      .catch(() => {})
  }, [page])

  if (!banner) return null

  if (banner.link) {
    return (
      <a href={banner.link} target="_blank" rel="noopener noreferrer" className="block mb-4 group">
        <Inner b={banner} />
      </a>
    )
  }
  return <div className="mb-4 group"><Inner b={banner} /></div>
}
