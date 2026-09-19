'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { resolveImageUrl, getInitials } from '@/lib/data'
import { notifyConnectionsChanged } from '@/lib/pendingConnections'

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


export default function PendingConnectionsWidget() {
  const [pending,  setPending]  = useState<PendingConn[]>([])
  const [loading,  setLoading]  = useState(true)
  const [acting,   setActing]   = useState<string | null>(null)

  useEffect(() => {
    // Only the requests waiting on me — the unfiltered endpoint returns the
    // member's whole network, both directions, to fill a card that is
    // usually empty.
    fetch('/app/api/connections?direction=received&status=pending', { credentials: 'include' })
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

  // The row leaves the list as soon as it's tapped. If the server says no, it
  // comes back where it was and the member is told why — a silent failure
  // used to leave the request looking handled when it wasn't. A 404 is the
  // exception: the request is gone (withdrawn, or the account is), so there
  // is nothing to put back.
  async function respond(connId: string, action: 'accept' | 'decline') {
    const index = pending.findIndex(c => c.id === connId)
    const row   = pending[index]
    if (!row) return
    setActing(connId)
    setPending(prev => prev.filter(c => c.id !== connId))
    try {
      const res = action === 'accept'
        ? await fetch(`/app/api/connections/${connId}`, {
            method: 'PATCH', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'accept' }),
          })
        : await fetch(`/app/api/connections/${connId}`, {
            method: 'DELETE', credentials: 'include',
          })
      if (res.ok) {
        // Nav badges hold their own count — tell them it moved.
        notifyConnectionsChanged()
        return
      }
      const data = await res.json().catch(() => ({}))
      const verb = action === 'accept' ? 'accept' : 'decline'
      if (res.status === 404) {
        toast.error('That request is no longer available')
        notifyConnectionsChanged()
        return
      }
      toast.error(data.error ?? `Couldn't ${verb} the request`)
      restore(row, index)
    } catch {
      toast.error('Something went wrong — check your connection')
      restore(row, index)
    } finally { setActing(null) }
  }

  function restore(row: PendingConn, index: number) {
    setPending(prev => {
      if (prev.some(c => c.id === row.id)) return prev
      const next = [...prev]
      next.splice(Math.min(index, next.length), 0, row)
      return next
    })
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
