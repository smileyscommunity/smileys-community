'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'

interface ExperienceCard { slug: string; title: string; emoji: string }

// §18/§27 — the viewer's saved list on the guide homepage. Client island
// (the page is ISR-cached); guests and members with nothing saved render
// nothing at all. Named for what it does rather than for one city — it was
// MyIstanbul, which is a heading Bodrum members were also shown.
export default function MySaved({ cityName, experiences }: { cityName: string; experiences: ExperienceCard[] }) {
  const { isLoggedIn } = useAuth()
  const [savedSlugs, setSavedSlugs] = useState<string[]>([])
  const [doneCount,  setDoneCount]  = useState(0)

  useEffect(() => {
    if (!isLoggedIn) return
    fetch('/app/api/guide/saves', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { saves: [] })
      .then(d => {
        const rows = (d.saves ?? []) as { slug: string; saved: boolean; done?: boolean }[]
        setSavedSlugs(rows.filter(r => r.saved).map(r => r.slug))
        setDoneCount(rows.filter(r => r.done).length)
      })
      .catch(() => {})
  }, [isLoggedIn])

  const saved = experiences.filter(e => savedSlugs.includes(e.slug))
  if (saved.length === 0 && doneCount === 0) return null

  return (
    <div className="mt-12 bg-gray-900 rounded-3xl p-6 sm:p-8 relative overflow-hidden">
      <div aria-hidden="true" className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_80%_20%,#f59e0b_0%,transparent_60%)]" />
      <h2 className="relative text-xl sm:text-2xl font-extrabold text-white">My {cityName}</h2>
      <p className="relative text-sm text-gray-300 mt-1 mb-5">
        {saved.length > 0 && <>{saved.length} experience{saved.length !== 1 ? 's' : ''} on your list.</>}
        {doneCount > 0 && <> <span className="text-green-400 font-bold">{doneCount} completed ✓</span></>}
      </p>
      <div className="relative grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {saved.map(e => (
          <Link key={e.slug} href={`/guide/${e.slug}`}
            className="bg-white/10 hover:bg-white/20 rounded-2xl p-4 transition-colors group">
            <span aria-hidden="true" className="block text-3xl mb-2">{e.emoji}</span>
            <p className="text-sm font-bold text-white leading-snug">{e.title}</p>
            <span className="inline-block text-xs font-bold text-amber-400 mt-2 group-hover:translate-x-0.5 transition-transform">Do it →</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
