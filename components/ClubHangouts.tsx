'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import posthog from 'posthog-js'

interface ClubHangout {
  id: string; title: string; neighborhood: string | null; startsAt: string
  clubId: string | null
  joins?: unknown[]
}

// Spontaneous plans shared with this club (Clubs brief §17) — canonical
// Hangout records filtered by clubId. Empty state invites members to
// start one instead of showing a bare "no hangouts".
export default function ClubHangouts({ slug, isMember }: { slug: string; isMember: boolean }) {
  const [clubId,   setClubId]   = useState<string | null>(null)
  const [hangouts, setHangouts] = useState<ClubHangout[]>([])
  const [loaded,   setLoaded]   = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/app/api/clubs/${slug}`, { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/app/api/hangouts', { credentials: 'include' }).then(r => r.ok ? r.json() : { hangouts: [] }).catch(() => ({ hangouts: [] })),
    ]).then(([club, hs]) => {
      const id = club?.id ?? club?.club?.id ?? null
      setClubId(id)
      if (id) setHangouts(((hs.hangouts ?? []) as ClubHangout[]).filter(h => h.clubId === id).slice(0, 3))
    }).finally(() => setLoaded(true))
  }, [slug])

  if (!loaded) return null

  return (
    <section>
      <h3 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-3 flex items-center gap-2">
        <span aria-hidden="true">⚡</span> Spontaneous plans
      </h3>
      {hangouts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {hangouts.map(h => (
            <Link key={h.id} href={`/hangouts/${h.id}`}
              onClick={() => posthog.capture('club_to_hangout', { club: slug, hangoutId: h.id })}
              className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-amber-200 hover:shadow-md transition-all group">
              <p className="text-sm font-bold text-gray-900 group-hover:text-amber-700 transition-colors">{h.title}</p>
              <p className="text-xs text-gray-500 mt-1">
                🕐 {new Date(h.startsAt).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Istanbul' })}
                {h.neighborhood && <> · 📍 {h.neighborhood}</>}
                {(h.joins?.length ?? 0) > 0 && <> · 👥 {h.joins!.length + 1} going</>}
              </p>
              <span className="inline-block text-xs font-bold text-amber-600 mt-2">Join →</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="bg-gray-50 border border-dashed border-gray-200 rounded-2xl p-6 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-gray-600">Nothing spontaneous right now.</p>
          {isMember && (
            <Link href="/hangouts?new=1"
              className="text-sm font-bold text-amber-600 hover:underline shrink-0">
              Start a hangout →
            </Link>
          )}
        </div>
      )}
    </section>
  )
}
