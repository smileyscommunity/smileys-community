'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import posthog from 'posthog-js'
import { useAuth } from '@/contexts/AuthContext'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import { DEFAULT_TZ } from '@/lib/cityTime'

interface LiveHangout { id: string; title: string; neighborhood: string | null; startsAt: string }

// §16 — "people doing this today". Hangouts are member content, so this
// island fetches only for signed-in viewers (guests render nothing) and
// filters to the experience's neighborhoods. Same member-gated-fetch
// pattern as BoardFeed's hangouts module.
export default function LiveHangouts({ neighborhoods }: { neighborhoods: string[] }) {
  // Times belong to the city the content is in, not the reader's device.
  const tz = useCurrentCity()?.timezone ?? DEFAULT_TZ
  const { isLoggedIn } = useAuth()
  const [hangouts, setHangouts] = useState<LiveHangout[]>([])

  useEffect(() => {
    if (!isLoggedIn) return
    fetch('/app/api/hangouts', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { hangouts: [] })
      .then(d => {
        const list = (d.hangouts ?? []) as LiveHangout[]
        setHangouts(list.filter(h => h.neighborhood && neighborhoods.includes(h.neighborhood)).slice(0, 2))
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn])

  if (hangouts.length === 0) return null

  return (
    <div className="relative mt-5 space-y-2">
      <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">People near this right now</p>
      {hangouts.map(h => (
        <Link key={h.id} href={`/hangouts/${h.id}`}
          onClick={() => posthog.capture('guide_to_hangout', { hangoutId: h.id })}
          className="flex items-center gap-3 bg-white/10 hover:bg-white/20 rounded-xl px-4 py-2.5 transition-colors group">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white truncate">{h.title}</p>
            <p className="text-xs text-gray-300 mt-0.5">
              🕐 {new Date(h.startsAt).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz })}
              {h.neighborhood && <> · 📍 {h.neighborhood}</>}
            </p>
          </div>
          <span className="shrink-0 text-xs font-bold text-amber-400">Join →</span>
        </Link>
      ))}
    </div>
  )
}
