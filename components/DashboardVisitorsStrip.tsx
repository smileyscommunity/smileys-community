'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { getInitials } from '@/lib/data'

interface VisitorUser {
  id:           string
  name:         string
  color:        string
  profilePhoto: string | null
}

interface Visitor {
  id:       string
  name:     string
  startsOn: string
  endsOn:   string
  user:     VisitorUser | null
}

interface Props {
  visitors: Visitor[]
}

function formatRange(startsOn: string, endsOn: string) {
  const s = new Date(startsOn + 'T00:00:00')
  const e = new Date(endsOn + 'T00:00:00')
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
  const fmt = (d: Date, withMonth: boolean) => d.toLocaleDateString('en-GB', withMonth
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric' })
  return sameMonth ? `${fmt(s, false)}–${fmt(e, true)}` : `${fmt(s, true)} – ${fmt(e, true)}`
}

function WaveButton({ targetUserId, targetName }: { targetUserId: string; targetName: string }) {
  const [sending, setSending] = useState(false)
  const [sent,    setSent]    = useState(false)

  async function handleWave() {
    if (sending || sent) return
    setSending(true)
    try {
      const res = await fetch('/app/api/visiting/wave', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ targetUserId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'Couldn\'t send wave')
        return
      }
      setSent(true)
      if (!data.alreadySent) {
        toast.success(`👋 Wave sent to ${targetName.split(' ')[0]}!`)
      }
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <Link href={`/messages/${targetUserId}`}
        className="shrink-0 text-[11px] font-bold text-green-700 bg-green-100 px-2.5 py-1 rounded-full whitespace-nowrap hover:bg-green-200 transition-colors">
        ✓ Open chat
      </Link>
    )
  }

  return (
    <button onClick={handleWave} disabled={sending}
      className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-60 disabled:cursor-default whitespace-nowrap">
      {sending ? '…' : '👋 Wave'}
    </button>
  )
}

// Visitors this week — surfaces /visiting on the dashboard so the
// wave feature lives on the highest-traffic surface. Renders nothing
// when there are no upcoming visitors so empty days don't get a
// hollow widget; the strip earns its real estate by content alone.
export default function DashboardVisitorsStrip({ visitors }: Props) {
  if (visitors.length === 0) return null

  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Visitors this week 👋</h2>
          <p className="text-xs text-gray-400 mt-0.5">Members passing through Istanbul — say hello before they arrive.</p>
        </div>
        <Link href="/visiting" className="text-xs font-bold text-amber-600 hover:underline shrink-0">View all →</Link>
      </div>

      <div className="space-y-3">
        {visitors.map(v => (
          <div key={v.id} className="flex items-center gap-3">
            {v.user?.profilePhoto ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={v.user.profilePhoto} alt={v.name}
                className="w-9 h-9 rounded-full object-cover shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ backgroundColor: v.user?.color || '#f59e0b' }}>
                {getInitials(v.name)}
              </div>
            )}
            <div className="flex-1 min-w-0">
              {v.user ? (
                <Link href={`/members/${v.user.id}`}
                  className="text-sm font-bold text-gray-900 hover:text-amber-600 transition-colors truncate block">
                  {v.name}
                </Link>
              ) : (
                <p className="text-sm font-bold text-gray-900 truncate">{v.name}</p>
              )}
              <p className="text-xs text-amber-700 font-semibold">{formatRange(v.startsOn, v.endsOn)}</p>
            </div>
            {v.user && (
              <WaveButton targetUserId={v.user.id} targetName={v.user.name} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
