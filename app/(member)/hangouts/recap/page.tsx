'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { resolveImageUrl } from '@/lib/data'
import { toast } from 'sonner'

// The recap surface — admins land here from the sweeper's recap push.
// Lists the caller's last 30 days of hangouts and lets them leave a
// reference (good / meh / no_show) for each other participant. The trust
// model (HangoutReference) lives in prisma/schema.prisma.

interface Participant {
  id:           string
  name:         string
  color:        string
  profilePhoto: string | null
  role:         'host' | 'joiner'
}

interface RecapHangout {
  id:                string
  title:             string
  location:          string
  neighborhood:      string | null
  endsAt:            string
  iWasHost:          boolean
  participants:      Participant[]
  myRefs:            Record<string, 'good' | 'meh' | 'no_show'>
  outstandingCount:  number
}

const VIBE_LABEL: Record<string, string> = {
  good:    '✓ Good',
  meh:     '😐 Fine',
  no_show: '👻 Didn’t show',
}

function timeAgo(dateStr: string) {
  const ms = Date.now() - new Date(dateStr).getTime()
  const d  = Math.floor(ms / 86400000)
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 7)   return `${d}d ago`
  return `${Math.floor(d / 7)}w ago`
}

export default function HangoutRecapPage() {
  const { user } = useAuth()
  const [hangouts, setHangouts] = useState<RecapHangout[]>([])
  const [loading,  setLoading]  = useState(true)
  const [busy,     setBusy]     = useState<string | null>(null)  // "hangoutId:toUserId" in flight

  useEffect(() => {
    fetch('/app/api/hangouts/my-recap', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.hangouts) setHangouts(d.hangouts) })
      .finally(() => setLoading(false))
  }, [])

  async function rate(hangoutId: string, toUserId: string, vibe: 'good' | 'meh' | 'no_show') {
    const key = `${hangoutId}:${toUserId}`
    setBusy(key)
    try {
      const res = await fetch(`/app/api/hangouts/${hangoutId}/references`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ toUserId, vibe }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({}))
        toast.error(error || 'Could not save reference')
        return
      }
      // Optimistic update — bump the count and stamp the vibe locally.
      setHangouts(prev => prev.map(h => {
        if (h.id !== hangoutId) return h
        const wasOutstanding = !h.myRefs[toUserId]
        return {
          ...h,
          myRefs: { ...h.myRefs, [toUserId]: vibe },
          outstandingCount: wasOutstanding ? h.outstandingCount - 1 : h.outstandingCount,
        }
      }))
      toast.success('Reference saved')
    } finally {
      setBusy(null)
    }
  }

  if (!user) return null

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10">
      <div className="mb-6">
        <Link href="/hangouts" className="text-xs text-amber-600 font-semibold">← Back to hangouts</Link>
        <h1 className="text-2xl font-extrabold text-gray-900 mt-2">Hangout recap</h1>
        <p className="text-sm text-gray-500 mt-1">
          Leave a quick reference for the people you met. Good references build trust so people feel safer joining your next hangout.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="h-32 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : hangouts.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center text-gray-500 text-sm shadow-sm">
          <p className="text-3xl mb-3">☕</p>
          <p>No recent hangouts to review.</p>
          <Link href="/hangouts" className="text-amber-600 font-semibold text-xs mt-2 inline-block">Post one →</Link>
        </div>
      ) : (
        <div className="space-y-4">
          {hangouts.map(h => (
            <div key={h.id} className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{h.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      📍 {h.location}{h.neighborhood && ` · ${h.neighborhood}`} · ended {timeAgo(h.endsAt)}
                    </p>
                  </div>
                  {h.outstandingCount > 0 ? (
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
                      {h.outstandingCount} pending
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 shrink-0">
                      All done
                    </span>
                  )}
                </div>
              </div>
              <div className="divide-y divide-gray-100">
                {h.participants.length === 0 ? (
                  <p className="px-5 py-6 text-xs text-gray-500 text-center">Just you on this one.</p>
                ) : h.participants.map(p => {
                  const avatar = p.profilePhoto ? resolveImageUrl(p.profilePhoto) : null
                  const current = h.myRefs[p.id]
                  const inFlight = busy === `${h.id}:${p.id}`
                  return (
                    <div key={p.id} className="px-5 py-3 flex items-center gap-3">
                      {avatar
                        ? <img src={avatar} alt={p.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                        : <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                            style={{ backgroundColor: p.color }}>{p.name[0]}</div>}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                        <p className="text-[11px] text-gray-400 capitalize">{p.role}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {(['good', 'meh', 'no_show'] as const).map(v => (
                          <button
                            key={v}
                            onClick={() => rate(h.id, p.id, v)}
                            disabled={inFlight}
                            className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
                              current === v
                                ? v === 'good'   ? 'bg-green-500 text-white border-green-500'
                                : v === 'meh'    ? 'bg-gray-300 text-gray-900 border-gray-300'
                                                 : 'bg-red-500 text-white border-red-500'
                                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                            }`}
                            title={VIBE_LABEL[v]}
                          >
                            {VIBE_LABEL[v]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
