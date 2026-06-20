'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { resolveImageUrl } from '@/lib/data'

interface ConnectedUser {
  id: string; name: string; color: string
  profilePhoto: string | null; neighborhood: string | null
}

interface Connection {
  id: string; status: string; createdAt: string; note?: string | null
  requester?: ConnectedUser
  receiver?: ConnectedUser
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function Avatar({ user, size = 'md' }: { user: ConnectedUser; size?: 'sm' | 'md' | 'lg' }) {
  const photo = resolveImageUrl(user.profilePhoto)
  const cls = size === 'lg' ? 'w-14 h-14 text-base' : size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm'
  return photo ? (
    <img src={photo} alt={user.name} loading="lazy"
      className={`${cls} rounded-full object-cover shrink-0`} />
  ) : (
    <div className={`${cls} rounded-full flex items-center justify-center text-white font-bold shrink-0`}
      style={{ backgroundColor: user.color }}>
      {user.name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
    </div>
  )
}

export default function ContactsPage() {
  const [sent,     setSent]     = useState<Connection[]>([])
  const [received, setReceived] = useState<Connection[]>([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    fetch('/app/api/connections', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { sent: [], received: [] })
      .then(d => { setSent(d.sent ?? []); setReceived(d.received ?? []) })
      .finally(() => setLoading(false))
  }, [])

  const pendingReceived  = received.filter(c => c.status === 'pending')
  const accepted         = [
    ...sent.filter(c => c.status === 'accepted').map(c => ({ conn: c, user: c.receiver! })),
    ...received.filter(c => c.status === 'accepted').map(c => ({ conn: c, user: c.requester! })),
  ].sort((a, b) => new Date(b.conn.createdAt).getTime() - new Date(a.conn.createdAt).getTime())
  const pendingSent      = sent.filter(c => c.status === 'pending')

  async function accept(id: string) {
    const res = await fetch(`/app/api/connections/${id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept' }),
    })
    if (res.ok) {
      setReceived(prev => prev.map(c => c.id === id ? { ...c, status: 'accepted' } : c))
    }
  }

  async function decline(id: string) {
    const res = await fetch(`/app/api/connections/${id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'decline' }),
    })
    if (res.ok) setReceived(prev => prev.filter(c => c.id !== id))
  }

  async function remove(id: string) {
    if (!confirm('Remove this connection?')) return
    const res = await fetch(`/app/api/connections/${id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) {
      setSent(prev => prev.filter(c => c.id !== id))
      setReceived(prev => prev.filter(c => c.id !== id))
    }
  }

  async function withdraw(id: string) {
    const res = await fetch(`/app/api/connections/${id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) setSent(prev => prev.filter(c => c.id !== id))
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
        <div className="h-7 w-40 bg-gray-100 rounded animate-pulse" />
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="bg-white border border-gray-100 rounded-2xl p-4 flex gap-3 animate-pulse">
              <div className="w-10 h-10 rounded-full bg-gray-200 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-1/3" />
                <div className="h-2.5 bg-gray-100 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const empty = accepted.length === 0 && pendingReceived.length === 0 && pendingSent.length === 0

  return (
    <div className="min-h-screen bg-warm">

      {/* Hero */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-10 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">Contacts</h1>
              <p className="text-base text-gray-600 mt-1">
                {accepted.length} connection{accepted.length !== 1 ? 's' : ''}
              </p>
            </div>
            <Link href="/members"
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors">
              Find members
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-10">

      {/* Incoming requests */}
      {pendingReceived.length > 0 && (
        <section>
          <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-4">
            Requests ({pendingReceived.length})
          </h2>
          <div className="space-y-3">
            {pendingReceived.map(c => {
              const user = c.requester!
              return (
                <div key={c.id} className="bg-white border border-amber-100 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
                  <Link href={`/members/${user.id}`}>
                    <Avatar user={user} />
                  </Link>
                  <div className="flex-1 min-w-0">
                    <Link href={`/members/${user.id}`}
                      className="text-sm font-semibold text-gray-900 hover:text-amber-600 transition-colors truncate block">
                      {user.name}
                    </Link>
                    {user.neighborhood && (
                      <p className="text-xs text-gray-400 truncate">📍 {user.neighborhood}</p>
                    )}
                    {c.note && (
                      <p className="text-xs text-gray-600 italic mt-1 line-clamp-2">"{c.note}"</p>
                    )}
                    <p className="text-xs text-gray-400">{timeAgo(c.createdAt)}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => accept(c.id)}
                      className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg transition-colors">
                      Accept
                    </button>
                    <button onClick={() => decline(c.id)}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold rounded-lg transition-colors">
                      Decline
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Connected */}
      {accepted.length > 0 && (
        <section>
          <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-4">
            Connected ({accepted.length})
          </h2>
          <div className="space-y-2">
            {accepted.map(({ conn, user }) => (
              <div key={conn.id} className="bg-white border border-gray-100 rounded-2xl p-3 flex items-center gap-3 shadow-sm group">
                <Link href={`/members/${user.id}`}>
                  <Avatar user={user} />
                </Link>
                <div className="flex-1 min-w-0">
                  <Link href={`/members/${user.id}`}
                    className="text-sm font-semibold text-gray-900 hover:text-amber-600 transition-colors truncate block">
                    {user.name}
                  </Link>
                  {user.neighborhood && (
                    <p className="text-xs text-gray-400 truncate">📍 {user.neighborhood}</p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Link href={`/messages/${user.id}`}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-amber-50 hover:text-amber-600 text-gray-600 text-xs font-semibold rounded-lg transition-colors">
                    Message
                  </Link>
                  <button onClick={() => remove(conn.id)}
                    className="px-2 py-1.5 text-gray-300 hover:text-red-400 text-xs transition-colors opacity-0 group-hover:opacity-100">
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Sent pending */}
      {pendingSent.length > 0 && (
        <section>
          <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-4">
            Sent requests ({pendingSent.length})
          </h2>
          <div className="space-y-2">
            {pendingSent.map(c => {
              const user = c.receiver!
              return (
                <div key={c.id} className="bg-white border border-gray-100 rounded-2xl p-3 flex items-center gap-3 shadow-sm">
                  <Link href={`/members/${user.id}`}>
                    <Avatar user={user} size="sm" />
                  </Link>
                  <div className="flex-1 min-w-0">
                    <Link href={`/members/${user.id}`}
                      className="text-sm font-semibold text-gray-900 hover:text-amber-600 transition-colors truncate block">
                      {user.name}
                    </Link>
                    <p className="text-xs text-gray-400">Request sent {timeAgo(c.createdAt)}</p>
                  </div>
                  <button onClick={() => withdraw(c.id)}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-red-50 hover:text-red-500 text-gray-600 text-xs font-semibold rounded-lg transition-colors shrink-0">
                    Withdraw
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Empty state */}
      {empty && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">👋</div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">No connections yet</h2>
          <p className="text-sm text-gray-400 mb-6">
            Meet other Smileys members at events and send them a connection request.
          </p>
          <Link href="/members"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors">
            Browse members
          </Link>
        </div>
      )}

      </div>
    </div>
  )
}
