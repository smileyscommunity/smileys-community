'use client'

// Host dashboard identity + quality panel. The dashboard used to show
// event vanity metrics and club shortcuts but nothing about the host
// as a person — this adds who they are (avatar, role, clubs, public
// profile link) and how members actually rate their events (the same
// post-event survey rollup admins see, minus anomaly data — see
// /api/host/quality for the redaction rationale).

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { resolveImageUrl } from '@/lib/data'

interface RecentEvent {
  id: string; title: string; emoji: string; date: string
  responses: number; wouldReturnRate: number | null; responseRate: number | null
}
interface QualityPayload {
  eventsHosted: number
  quality: { surveyResponses: number; wouldReturnRate: number | null; responseRate: number | null } | null
  recent: RecentEvent[]
}
interface HostClub { id: string; slug: string; name: string; emoji?: string }

export default function HostProfileCard() {
  const { user } = useAuth()
  const [data,  setData]  = useState<QualityPayload | null>(null)
  const [clubs, setClubs] = useState<HostClub[]>([])

  useEffect(() => {
    fetch('/app/api/host/quality', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !d.error) setData(d) })
      .catch(() => {})
    fetch('/app/api/host/clubs', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setClubs(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  const photo = resolveImageUrl(user.profilePhoto ?? null)

  return (
    <div className="mb-6 sm:mb-8 space-y-4">
      {/* Identity */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex items-center gap-4 flex-wrap">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={user.name} className="w-14 h-14 rounded-full object-cover shrink-0 border-2 border-zinc-700" />
        ) : (
          <div className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold shrink-0"
            style={{ backgroundColor: user.color }}>
            {user.initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-white font-bold">{user.name}</p>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
              {user.role === 'admin' ? 'Admin' : 'Host'}
            </span>
          </div>
          {clubs.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              {clubs.map(c => (
                <Link key={c.id} href={`/host/clubs/${c.slug}`}
                  className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded-full transition-colors">
                  {c.emoji ? `${c.emoji} ` : ''}{c.name}
                </Link>
              ))}
            </div>
          )}
        </div>
        <Link href={`/members/${user.id}`}
          className="shrink-0 text-xs text-zinc-400 hover:text-amber-400 border border-zinc-700 hover:border-amber-500/50 px-3 py-1.5 rounded-lg transition-colors">
          View public profile →
        </Link>
      </div>

      {/* Quality — only once there's at least one hosted event. */}
      {data && data.eventsHosted > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-white">How members rate your events</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {data.quality
                ? `${data.quality.surveyResponses} post-event survey response${data.quality.surveyResponses === 1 ? '' : 's'} across ${data.eventsHosted} event${data.eventsHosted === 1 ? '' : 's'}`
                : 'Members get a short survey after each event — responses will show up here.'}
            </p>
          </div>

          {data.quality && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-zinc-950/50 rounded-xl p-3">
                <div className={`text-2xl font-extrabold ${
                  data.quality.wouldReturnRate === null  ? 'text-zinc-600'
                    : data.quality.wouldReturnRate >= 80 ? 'text-green-400'
                    : data.quality.wouldReturnRate >= 60 ? 'text-amber-400'
                    : 'text-red-400'
                }`}>
                  {data.quality.wouldReturnRate === null ? '—' : `${data.quality.wouldReturnRate}%`}
                </div>
                <div className="text-xs text-zinc-500 mt-1">Would attend again</div>
              </div>
              <div className="bg-zinc-950/50 rounded-xl p-3">
                <div className="text-2xl font-extrabold text-white">
                  {data.quality.responseRate === null ? '—' : `${data.quality.responseRate}%`}
                </div>
                <div className="text-xs text-zinc-500 mt-1">Response rate</div>
              </div>
              <div className="bg-zinc-950/50 rounded-xl p-3">
                <div className="text-2xl font-extrabold text-white">{data.quality.surveyResponses}</div>
                <div className="text-xs text-zinc-500 mt-1">Responses</div>
              </div>
            </div>
          )}

          {data.recent.some(e => e.responses > 0) && (
            <div className="mt-4 pt-4 border-t border-zinc-800">
              <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider mb-2">Recent events</p>
              <div className="space-y-1.5">
                {data.recent.map(e => (
                  <div key={e.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-950/50">
                    <span className="text-base shrink-0" aria-hidden="true">{e.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-white truncate">{e.title}</p>
                      <p className="text-[10px] text-zinc-600">{e.date}</p>
                    </div>
                    <div className="text-right shrink-0 text-xs">
                      {e.wouldReturnRate !== null ? (
                        <span className={`font-bold ${
                          e.wouldReturnRate >= 80 ? 'text-green-400'
                            : e.wouldReturnRate >= 60 ? 'text-amber-400'
                            : 'text-red-400'
                        }`}>{e.wouldReturnRate}% would return</span>
                      ) : (
                        <span className="text-zinc-600">
                          {e.responses > 0 ? `${e.responses} response${e.responses === 1 ? '' : 's'} — needs 3+ for a rate` : 'no responses yet'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
