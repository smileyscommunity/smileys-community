'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { getInitials } from '@/lib/data'

interface HostEntry {
  userId: string
  user: { id: string; name: string; email: string; color: string }
  clubs: { id: string; name: string; emoji: string }[]
  eventCount: number
  totalAttendees: number
}

export default function AdminHostsPage() {
  const [hosts, setHosts] = useState<HostEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/app/api/admin/clubs', { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/admin/events', { credentials: 'include' }).then(r => r.json()),
    ]).then(async ([clubs, events]) => {
      if (!Array.isArray(clubs)) { setLoading(false); return }
      const eventsArr: any[] = Array.isArray(events) ? events : []

      const byUser = new Map<string, HostEntry>()
      await Promise.all(clubs.map(async (club: any) => {
        const members = await fetch(`/app/api/admin/clubs/${club.id}/memberships`, { credentials: 'include' }).then(r => r.json())
        if (!Array.isArray(members)) return
        members
          .filter((m: any) => m.role === 'host' && m.status === 'approved')
          .forEach((m: any) => {
            if (!byUser.has(m.userId)) {
              byUser.set(m.userId, { userId: m.userId, user: m.user, clubs: [], eventCount: 0, totalAttendees: 0 })
            }
            byUser.get(m.userId)!.clubs.push({ id: club.id, name: club.name, emoji: club.emoji })
          })
      }))

      // Overlay event stats
      eventsArr.forEach((e: any) => {
        if (e.hostId && byUser.has(e.hostId)) {
          const h = byUser.get(e.hostId)!
          h.eventCount++
          h.totalAttendees += e._count?.attendees ?? 0
        }
      })

      setHosts(Array.from(byUser.values()).sort((a, b) => b.eventCount - a.eventCount))
      setLoading(false)
    })
  }, [])

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-2xl font-extrabold tracking-tight">Club Hosts</h1>
          <p className="text-sm text-zinc-500 mt-0.5">{hosts.length} host{hosts.length !== 1 ? 's' : ''}</p>
        </div>
        <Link href="/admin/clubs" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-colors">
          Manage in Clubs →
        </Link>
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : hosts.length === 0 ? (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-10 text-center">
          <div className="text-3xl mb-2">👤</div>
          <p className="text-zinc-400 text-sm">No club hosts yet.</p>
          <p className="text-zinc-500 text-xs mt-1">Go to a club's members panel and set someone's role to Host.</p>
          <Link href="/admin/clubs" className="inline-block mt-4 text-xs bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl font-semibold transition-colors">Go to Clubs</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {hosts.map(host => (
            <div key={host.userId} className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0 mt-0.5"
                style={{ backgroundColor: host.user.color }}>
                {getInitials(host.user.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-white text-sm truncate">{host.user.name}</div>
                <div className="text-xs text-zinc-500 truncate">{host.user.email}</div>
                <div className="flex items-center gap-3 my-1.5">
                  <span className="text-xs text-zinc-400">🗓 <strong className="text-white">{host.eventCount}</strong> events</span>
                  <span className="text-xs text-zinc-400">👥 <strong className="text-white">{host.totalAttendees}</strong> attendees</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {host.clubs.map(club => (
                    <span key={club.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-800 rounded-lg text-xs text-amber-400 font-medium border border-zinc-700">
                      {club.emoji} {club.name}
                    </span>
                  ))}
                </div>
              </div>
              <Link href={`/admin/users/${host.userId}`}
                className="text-xs px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors font-semibold shrink-0">
                View
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
