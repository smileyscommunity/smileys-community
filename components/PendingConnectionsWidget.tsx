'use client'

import { useState, useEffect } from 'react'
import { resolveImageUrl } from '@/lib/data'

interface Requester {
  id: string
  name: string
  color: string
  profilePhoto: string | null
  neighborhood: string | null
}

interface PendingConn {
  id: string
  requesterId: string
  requester: Requester
  createdAt: string
}

function getInitials(name: string) {
  return name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

export default function PendingConnectionsWidget() {
  const [pending,  setPending]  = useState<PendingConn[]>([])
  const [loading,  setLoading]  = useState(true)
  const [acting,   setActing]   = useState<string | null>(null)

  useEffect(() => {
    fetch('/app/api/connections', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const received: PendingConn[] = Array.isArray(d.received)
          ? d.received.filter((c: any) => c.status === 'pending')
          : []
        setPending(received)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function respond(connId: string, action: 'accept' | 'decline') {
    setActing(connId)
    try {
      if (action === 'accept') {
        const res = await fetch(`/app/api/connections/${connId}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'accept' }),
        })
        if (res.ok) setPending(prev => prev.filter(c => c.id !== connId))
      } else {
        const res = await fetch(`/app/api/connections/${connId}`, {
          method: 'DELETE', credentials: 'include',
        })
        if (res.ok) setPending(prev => prev.filter(c => c.id !== connId))
      }
    } finally { setActing(null) }
  }

  if (loading || pending.length === 0) return null

  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-base">🤝</span>
        <h2 className="font-bold text-gray-900 text-sm">
          Connection requests
          <span className="ml-2 text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
            {pending.length}
          </span>
        </h2>
      </div>

      <div className="space-y-3">
        {pending.map(c => {
          const photo = resolveImageUrl(c.requester.profilePhoto)
          return (
            <div key={c.id} className="flex items-center gap-3">
              {photo ? (
                <img src={photo} alt={c.requester.name}
                  className="w-10 h-10 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: c.requester.color }}>
                  {getInitials(c.requester.name)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{c.requester.name}</p>
                {c.requester.neighborhood && (
                  <p className="text-xs text-gray-400 truncate">📍 {c.requester.neighborhood}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => respond(c.id, 'accept')}
                  disabled={acting === c.id}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                >
                  {acting === c.id ? '…' : 'Accept'}
                </button>
                <button
                  onClick={() => respond(c.id, 'decline')}
                  disabled={acting === c.id}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                >
                  Decline
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
