'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { resolveImageUrl, getInitials } from '@/lib/data'
import { countryFlag } from '@/lib/countries'
import { useAuth } from '@/contexts/AuthContext'
import ReportButton from '@/components/ReportButton'
import AdBannerStrip from '@/components/AdBannerStrip'

interface ConnectionUser {
  id: string; name: string; color: string
  profilePhoto: string | null; neighborhood: string | null
}

interface ConnectionRecord {
  id:          string
  requesterId: string
  receiverId:  string
  status:      string
  requester?:  ConnectionUser
  receiver?:   ConnectionUser
}

interface MemberClub {
  id: string
  name: string
  emoji: string
  slug: string
  isHost: boolean
}

const SOCIAL_STYLE_MAP: Record<string, string> = {
  deep_talker:      '🗣️ Deep Talker',
  social_butterfly: '🎉 Social Butterfly',
  connector:        '🤝 Connector',
  initiator:        '🔥 Initiator',
  laid_back:        '🧘 Laid-back',
  new_in_town:      '🌱 New in Town',
  small_groups:     '☕ Small Groups',
  up_for_anything:  '🎭 Up for Anything',
}

interface Member {
  id: string
  name: string
  color: string
  bio: string | null
  neighborhood: string | null
  nationality: string | null
  interests: string[]
  languages: string[]
  socialStyles: string[]
  profilePhoto: string | null
  joinedAt: string
  role: string
  isHost: boolean
  clubs: MemberClub[]
  eventsCount: number
  eventIds?: string[]
  instagram: string | null
  lastActive: string | null
}

function displayRole(m: Member): { label: string; cls: string } {
  if (m.role === 'admin')     return { label: 'Admin', cls: 'bg-amber-100 text-amber-700' }
  if (m.role === 'moderator') return { label: 'Mod',   cls: 'bg-purple-100 text-purple-700' }
  return { label: 'Member', cls: 'bg-gray-100 text-gray-500' }
}

function Avatar({ m, size = 'md' }: { m: Member; size?: 'md' | 'lg' }) {
  const photo = resolveImageUrl(m.profilePhoto)
  if (size === 'lg') {
    return photo ? (
      <img src={photo} alt={m.name} loading="lazy" className="w-24 h-24 rounded-full object-cover shrink-0 border-4 border-white shadow-md" />
    ) : (
      <div className="w-24 h-24 rounded-full flex items-center justify-center text-white font-bold text-2xl shrink-0 border-4 border-white shadow-md" style={{ backgroundColor: m.color }}>
        {getInitials(m.name)}
      </div>
    )
  }
  return photo ? (
    <img src={photo} alt={m.name} loading="lazy" className="w-14 h-14 rounded-full object-cover shrink-0" />
  ) : (
    <div className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0" style={{ backgroundColor: m.color }}>
      {getInitials(m.name)}
    </div>
  )
}

function ConnectButton({ m, currentUserId, connections, onConnectionChange }: {
  m: Member
  currentUserId: string
  connections: ConnectionRecord[]
  onConnectionChange: (updated: ConnectionRecord | null, removed?: string) => void
}) {
  const [loading,  setLoading]  = useState(false)
  const [showNote, setShowNote] = useState(false)
  const [note,     setNote]     = useState('')

  const conn = connections.find(c =>
    (c.requesterId === currentUserId && c.receiverId === m.id) ||
    (c.receiverId === currentUserId && c.requesterId === m.id)
  )

  const iRequested = conn?.requesterId === currentUserId
  const theyRequested = conn?.requesterId === m.id && conn?.receiverId === currentUserId

  async function sendRequest() {
    setLoading(true)
    try {
      const res = await fetch('/app/api/connections', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverId: m.id, note: note.trim() || undefined }),
      })
      if (res.ok) {
        const data = await res.json()
        onConnectionChange(data.connection)
        setShowNote(false)
        setNote('')
      }
    } finally { setLoading(false) }
  }

  async function accept() {
    if (!conn) return
    setLoading(true)
    try {
      const res = await fetch(`/app/api/connections/${conn.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept' }),
      })
      if (res.ok) {
        const data = await res.json()
        onConnectionChange(data.connection)
      }
    } finally { setLoading(false) }
  }

  async function remove() {
    if (!conn) return
    setLoading(true)
    try {
      const res = await fetch(`/app/api/connections/${conn.id}`, {
        method: 'DELETE', credentials: 'include',
      })
      if (res.ok) onConnectionChange(null, conn.id)
    } finally { setLoading(false) }
  }

  if (!conn) {
    if (showNote) {
      return (
        <div className="flex flex-col gap-2 w-full max-w-xs">
          <textarea
            value={note} onChange={e => setNote(e.target.value)}
            placeholder={`How do you know ${m.name.split(' ')[0]}? (optional)`}
            rows={2} maxLength={200} autoFocus
            className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <div className="flex gap-2">
            <button onClick={sendRequest} disabled={loading}
              className="flex-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-60">
              {loading ? '...' : 'Send'}
            </button>
            <button onClick={() => setShowNote(false)}
              className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )
    }
    return (
      <button onClick={() => setShowNote(true)} disabled={loading}
        className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60">
        + Connect
      </button>
    )
  }

  if (theyRequested && conn.status === 'pending') {
    return (
      <div className="flex items-center gap-2">
        <button onClick={accept} disabled={loading}
          className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60">
          ✓ Accept
        </button>
        <button onClick={remove} disabled={loading}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold rounded-xl transition-colors disabled:opacity-60">
          Decline
        </button>
      </div>
    )
  }

  if (conn.status === 'pending' && iRequested) {
    return (
      <button onClick={remove} disabled={loading}
        className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-gray-600 text-sm font-semibold rounded-xl border border-gray-200 transition-colors disabled:opacity-60">
        {loading ? '...' : 'Pending…'}
      </button>
    )
  }

  // accepted — just a small disconnect link, badge in name row is the visual indicator
  return (
    <button onClick={remove} disabled={loading}
      className="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
      title="Remove connection">
      {loading ? '…' : 'Disconnect'}
    </button>
  )
}

function MemberModal({ m, onClose, currentUserId, currentUserRole, myClubIds, myEventIds, members, connections, onConnectionChange }: {
  m: Member; onClose: () => void; currentUserId: string; currentUserRole: string
  myClubIds: string[]; myEventIds: string[]; members: Member[]
  connections: ConnectionRecord[]
  onConnectionChange: (updated: ConnectionRecord | null, removed?: string) => void
}) {
  const flag        = countryFlag(m.nationality)
  const photo       = resolveImageUrl(m.profilePhoto)
  const role        = displayRole(m)
  const commonClubs = m.clubs.filter(c => myClubIds.includes(c.id))
  const commonEvents = myEventIds.filter(id => (m.eventIds ?? []).includes(id)).length

  const isPrivileged = currentUserRole === 'admin' || currentUserRole === 'moderator'

  const conn = connections.find(c =>
    (c.requesterId === currentUserId && c.receiverId === m.id) ||
    (c.receiverId === currentUserId && c.requesterId === m.id)
  )
  const isConnected = isPrivileged || conn?.status === 'accepted'

  const [blocked,  setBlocked]  = useState(false)
  const [blocking, setBlocking] = useState(false)

  async function handleBlock() {
    if (!confirm(`Block ${m.name.split(' ')[0]}? They won't be able to see your profile or message you.`)) return
    setBlocking(true)
    const res = await fetch('/app/api/members/block', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: m.id }),
    })
    setBlocking(false)
    if (res.ok) { setBlocked(true); onClose() }
  }

  async function handleUnblock() {
    setBlocking(true)
    const res = await fetch('/app/api/members/block', {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: m.id }),
    })
    setBlocking(false)
    if (res.ok) setBlocked(false)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const roleBadge = m.isHost
    ? <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500 text-white">Host</span>
    : <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${role.cls}`}>{role.label}</span>

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-white w-full md:max-w-md rounded-t-3xl md:rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <button onClick={onClose} className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-black/20 hover:bg-black/30 transition-colors">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Photo — compact on mobile, left column on desktop */}
        <div className="relative w-full h-48 md:w-44 md:h-full md:shrink-0 bg-gray-100">
          {photo ? (
            <img src={photo} alt={m.name} className="w-full h-full object-cover" style={{ objectPosition: '50% 10%' }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-5xl font-bold text-white" style={{ backgroundColor: m.color }}>
              {getInitials(m.name)}
            </div>
          )}
          <div className="absolute bottom-2 left-2">{roleBadge}</div>
        </div>

        {/* Content — scrollable */}
        <div className="flex-1 overflow-y-auto">
          {/* Identity — always visible */}
          <div className="px-4 pt-3 pb-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-base font-extrabold text-gray-900 truncate">
                  {isConnected || m.id === currentUserId ? m.name : m.name.split(' ')[0]}
                </h2>
                {conn?.status === 'accepted' && (
                  <span className="text-xs font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    Connected
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {m.id !== currentUserId && (
                  <ConnectButton m={m} currentUserId={currentUserId} connections={connections} onConnectionChange={onConnectionChange} />
                )}
              </div>
            </div>
          </div>

          {/* Locked state — not connected */}
          {!isConnected && m.id !== currentUserId && (
            <div className="px-4 pb-5 pt-3 flex flex-col items-center text-center gap-2">
              <div className="text-3xl">🔒</div>
              <p className="text-sm font-semibold text-gray-700">Connect to see more</p>
              <p className="text-xs text-gray-400">Bio, interests, clubs, and social links are only visible to connected members.</p>
            </div>
          )}

          {/* Full profile — connected or own profile */}
          {(isConnected || m.id === currentUserId) && (
            <>
              <div className="px-4 pb-1">
                {flag && <span className="text-base">{flag}</span>}
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  {m.neighborhood
                    ? <p className="text-xs text-gray-400">📍 {m.neighborhood}</p>
                    : <span />
                  }
                  {m.id !== currentUserId && (conn?.status === 'accepted' || isPrivileged) && (
                    <Link href={`/messages/${m.id}`} onClick={onClose}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg transition-colors shrink-0">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      Message
                    </Link>
                  )}
                </div>
              </div>

              {/* Stats row */}
              <div className="flex divide-x divide-gray-100 border-y border-gray-100 mx-4 my-2">
                <div className="flex-1 py-2 text-center">
                  <p className="text-sm font-extrabold text-gray-900">🎟 {m.eventsCount}</p>
                  <p className="text-xs text-gray-400">{commonEvents > 0 ? `${commonEvents} shared` : 'Events'}</p>
                </div>
                <div className="flex-1 py-2 text-center">
                  <p className="text-sm font-extrabold text-gray-900">🏛 {m.clubs.length}</p>
                  <p className="text-xs text-gray-400">Clubs</p>
                </div>
                <div className="flex-1 py-2 text-center">
                  <p className="text-sm font-extrabold text-gray-900">📅 {new Date(m.joinedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</p>
                  <p className="text-xs text-gray-400">Joined</p>
                </div>
              </div>

              <div className="px-4 pb-4 space-y-3">
                {m.bio && (
                  <p className="text-sm text-gray-600 leading-relaxed">{m.bio}</p>
                )}

                {m.socialStyles?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.socialStyles.map(s => (
                      <span key={s} className="px-2.5 py-1 bg-violet-50 text-violet-700 border border-violet-100 rounded-full text-xs font-medium">
                        {SOCIAL_STYLE_MAP[s] ?? s}
                      </span>
                    ))}
                  </div>
                )}

                {m.instagram && (
                  <a
                    href={`https://instagram.com/${m.instagram.replace('@', '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 bg-gradient-to-r from-pink-50 to-purple-50 border border-pink-100 rounded-xl text-sm font-semibold text-pink-600 hover:from-pink-100 hover:to-purple-100 transition-colors"
                  >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                    </svg>
                    {m.instagram.startsWith('@') ? m.instagram : `@${m.instagram}`}
                  </a>
                )}

                {m.interests.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.interests.map(i => (
                      <span key={i} className="px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded-full text-xs font-medium">{i}</span>
                    ))}
                  </div>
                )}

                {m.clubs.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {m.clubs.map(c => {
                      const shared = myClubIds.includes(c.id)
                      return (
                        <Link key={c.id} href={`/clubs/${c.slug}`} onClick={onClose}
                          className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-xl text-xs font-medium transition-colors ${
                            shared
                              ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                              : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-amber-50 hover:border-amber-200 hover:text-amber-700'
                          }`}>
                          <span>{c.emoji}</span>
                          <span>{c.name}</span>
                          {c.isHost && <span className="text-[9px] font-bold text-amber-500">HOST</span>}
                          {shared && <span className="text-[9px] font-bold text-amber-500">SHARED</span>}
                        </Link>
                      )
                    })}
                  </div>
                )}

                {m.id !== currentUserId && (
                  <div className="pt-2 border-t border-gray-100 flex items-center gap-4">
                    <ReportButton reportedId={m.id} reportedName={m.name} />
                    <span className="w-px h-3 bg-gray-200 shrink-0" />
                    <button onClick={blocked ? handleUnblock : handleBlock} disabled={blocking}
                      className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 transition-colors disabled:opacity-50">
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                      {blocked ? 'Unblock' : `Block ${m.name.split(' ')[0]}`}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Report + Block — accessible when not connected */}
          {!isConnected && m.id !== currentUserId && (
            <div className="px-4 pb-4 border-t border-gray-100 pt-3 flex items-center gap-4">
              <ReportButton reportedId={m.id} reportedName={m.name} />
              <span className="w-px h-3 bg-gray-200 shrink-0" />
              <button onClick={blocked ? handleUnblock : handleBlock} disabled={blocking}
                className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 transition-colors disabled:opacity-50">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                {blocked ? 'Unblock' : `Block ${m.name.split(' ')[0]}`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MemberCard({ m, onClick, connectionStatus }: { m: Member; onClick: () => void; connectionStatus?: string }) {
  const flag    = countryFlag(m.nationality)
  const photo   = resolveImageUrl(m.profilePhoto)
  const isOnline = m.lastActive
    ? (Date.now() - new Date(m.lastActive).getTime()) < 20 * 60 * 1000
    : false
  const isConnected = connectionStatus === 'accepted' || connectionStatus === 'privileged'

  return (
    <button
      onClick={onClick}
      className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden text-left hover:-translate-y-0.5 hover:shadow-md hover:border-gray-200 transition-all duration-200 w-full flex flex-col group"
    >
      {/* Portrait photo */}
      <div className="relative w-full aspect-[3/4] bg-gray-100">
        {photo ? (
          <img src={photo} alt={m.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" style={{ objectPosition: '50% 20%' }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl font-bold text-white" style={{ backgroundColor: m.color }}>
            {getInitials(m.name)}
          </div>
        )}

        <div className="absolute top-2 right-2">
          {connectionStatus === 'accepted' && (
            <span className="flex items-center gap-0.5 bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </span>
          )}
          {connectionStatus === 'pending' && (
            <span className="bg-amber-400 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">●</span>
          )}
        </div>

        {/* Online dot */}
        {isOnline && (
          <span className="absolute bottom-2 left-2 flex items-center gap-1">
            <span className="w-2 h-2 bg-green-400 border-2 border-white rounded-full shadow-sm" />
          </span>
        )}

        {/* Bottom gradient overlay with flag */}
        <div className="absolute bottom-0 inset-x-0 h-12 bg-gradient-to-t from-black/40 to-transparent" />
        {flag && (
          <span className="absolute bottom-2 right-2 text-base drop-shadow-sm">{flag}</span>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div>
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="font-bold text-gray-900 text-sm leading-tight truncate">
              {isConnected ? m.name : m.name.split(' ')[0]}
            </p>
            {m.isHost && (
              <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500 text-white">Host</span>
            )}
          </div>
          {isConnected && m.neighborhood && (
            <p className="text-[11px] text-gray-400 truncate mt-0.5">📍 {m.neighborhood}</p>
          )}
        </div>

        {m.socialStyles?.length > 0 && (
          <span className="self-start px-2 py-0.5 bg-violet-50 text-violet-600 border border-violet-100 rounded-full text-[11px] font-medium truncate max-w-full">
            {SOCIAL_STYLE_MAP[m.socialStyles[0]] ?? m.socialStyles[0]}
          </span>
        )}

        <div className="flex items-center gap-1.5 mt-auto pt-2 border-t border-gray-50 text-[11px] text-gray-400">
          {m.eventsCount > 0 && (
            <span className="flex items-center gap-0.5">
              <span>🎟</span> {m.eventsCount}
            </span>
          )}
          {m.eventsCount > 0 && m.clubs.length > 0 && <span className="text-gray-200">·</span>}
          {m.clubs.length > 0 && (
            <span className="flex items-center gap-0.5">
              <span>🏛</span> {m.clubs.length}
            </span>
          )}
          <span className="ml-auto text-[10px] text-gray-300">
            {new Date(m.joinedAt).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}
          </span>
        </div>
      </div>
    </button>
  )
}

type RoleFilter = 'All' | 'Hosts' | 'Admins'
type SortOption = 'newest' | 'active' | 'az'

const ROLE_FILTERS: RoleFilter[] = ['All', 'Hosts', 'Admins']

export default function MembersPage() {
  return <Suspense><MembersPageInner /></Suspense>
}

function MembersPageInner() {
  const searchParams   = useSearchParams()
  const neighborhoodParam = searchParams.get('neighborhood') ?? ''
  const { user } = useAuth()
  const [members,      setMembers]      = useState<Member[]>([])
  const [filteredMembers, setFilteredMembers] = useState<Member[] | null>(null)
  const [total,        setTotal]        = useState(0)
  const [hostTotal,    setHostTotal]    = useState(0)
  const [adminTotal,   setAdminTotal]   = useState(0)
  const [hasMore,      setHasMore]      = useState(false)
  const [loadingMore,  setLoadingMore]  = useState(false)
  const [loading,      setLoading]      = useState(true)
  const [filterLoading, setFilterLoading] = useState(false)
  const [search,       setSearch]       = useState(neighborhoodParam)
  const [roleFilter,   setRoleFilter]   = useState<RoleFilter>('All')
  const [sort,         setSort]         = useState<SortOption>('newest')
  const [selected,     setSelected]     = useState<Member | null>(null)
  const [myClubIds,    setMyClubIds]    = useState<string[]>([])
  const [myEventIds,   setMyEventIds]   = useState<string[]>([])
  const [connections,  setConnections]  = useState<ConnectionRecord[]>([])
  const [hero, setHero] = useState({ badge: 'People', headline: 'Members', subtitle: 'Connect with the Smileys community.' })

  const handleConnectionChange = useCallback((updated: ConnectionRecord | null, removed?: string) => {
    if (removed) {
      setConnections(prev => prev.filter(c => c.id !== removed))
    } else if (updated) {
      setConnections(prev => {
        const idx = prev.findIndex(c => c.id === updated.id)
        if (idx >= 0) { const next = [...prev]; next[idx] = updated; return next }
        return [...prev, updated]
      })
    }
  }, [])

  useEffect(() => {
    fetch('/app/api/content').then(r => r.json()).then(d => {
      if (d.members) setHero(h => ({ ...h, ...d.members }))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    Promise.all([
      fetch('/app/api/members?offset=0',  { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/clubs/memberships', { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/events/attending',  { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/connections',       { credentials: 'include' }).then(r => r.json()),
    ]).then(([membersData, clubsData, eventsData, connData]) => {
      setMembers(Array.isArray(membersData?.members) ? membersData.members : [])
      setTotal(membersData?.total ?? 0)
      setHostTotal(membersData?.hostTotal ?? 0)
      setAdminTotal(membersData?.adminTotal ?? 0)
      setHasMore(membersData?.hasMore ?? false)
      setMyClubIds(Array.isArray(clubsData) ? clubsData.map((c: any) => c.clubId ?? c.id) : [])
      setMyEventIds(Array.isArray(eventsData) ? eventsData.map((e: any) => e.eventId ?? e.id) : [])
      const sentList   = Array.isArray(connData?.sent)     ? connData.sent     : []
      const rcvList    = Array.isArray(connData?.received) ? connData.received : []
      setConnections([...sentList, ...rcvList])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (roleFilter === 'All') { setFilteredMembers(null); return }
    setFilterLoading(true)
    const param = roleFilter === 'Hosts' ? 'isHost=true' : 'adminOnly=true'
    fetch(`/app/api/members?${param}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setFilteredMembers(Array.isArray(d?.members) ? d.members : []))
      .catch(() => setFilteredMembers([]))
      .finally(() => setFilterLoading(false))
  }, [roleFilter])

  async function loadMore() {
    setLoadingMore(true)
    const data = await fetch(`/app/api/members?offset=${members.length}`, { credentials: 'include' }).then(r => r.json())
    if (data?.members) {
      setMembers(prev => [...prev, ...data.members])
      setHasMore(data.hasMore)
    }
    setLoadingMore(false)
  }

  const hostCount  = hostTotal
  const adminCount = adminTotal

  const activeMembers = filteredMembers ?? members

  const visible = activeMembers
    .filter(m => {
      if (roleFilter === 'All') return true
      return true // server already filtered
    })
    .filter(m => {
      if (!search) return true
      const q = search.toLowerCase()
      return (
        m.name.toLowerCase().includes(q) ||
        m.neighborhood?.toLowerCase().includes(q) ||
        m.nationality?.toLowerCase().includes(q) ||
        m.interests.some(i => i.toLowerCase().includes(q)) ||
        m.clubs.some(c => c.name.toLowerCase().includes(q))
      )
    })
    .sort((a, b) => {
      if (sort === 'active')  return b.eventsCount - a.eventsCount
      if (sort === 'az')      return a.name.localeCompare(b.name)
      return new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime()
    })

  const pendingRequests = connections.filter(c => c.receiverId === user.id && c.status === 'pending')
  const connectedCount  = connections.filter(c => c.status === 'accepted').length

  const isPrivilegedUser = user.role === 'admin' || user.role === 'moderator'

  function getConnectionStatus(memberId: string): string | undefined {
    const c = connections.find(x =>
      (x.requesterId === user.id && x.receiverId === memberId) ||
      (x.receiverId === user.id && x.requesterId === memberId)
    )
    if (c) return c.status
    if (isPrivilegedUser) return 'privileged'
    return undefined
  }

  return (
    <div className="min-h-screen bg-warm pb-20 md:pb-0">
      {selected && <MemberModal m={selected} onClose={() => setSelected(null)} currentUserId={user.id} currentUserRole={user.role} myClubIds={myClubIds} myEventIds={myEventIds} members={members} connections={connections} onConnectionChange={handleConnectionChange} />}

      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-0">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-6">
            <div className="flex-1">
              <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">{hero.badge}</span>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">{hero.headline}</h1>
              {!loading && (
                <p className="text-base text-gray-500 mt-1">
                  {total} members
                  {hostCount  > 0 && <span className="text-gray-400"> · {hostCount} hosts</span>}
                  {adminCount > 0 && <span className="text-gray-400"> · {adminCount} admins</span>}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-72">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search name, interest, club…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
              </div>
              <select
                value={sort}
                onChange={e => setSort(e.target.value as SortOption)}
                className="shrink-0 py-2.5 pl-3 pr-7 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white text-gray-700 appearance-none"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239ca3af'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', backgroundSize: '14px' }}
              >
                <option value="newest">Newest</option>
                <option value="active">Most active</option>
                <option value="az">A–Z</option>
              </select>
            </div>
          </div>

          <AdBannerStrip page="members" />

          {/* Role filter pills */}
          <div className="flex gap-2 pb-4 overflow-x-auto scrollbar-hide">
            {(['All', 'Hosts', 'Admins'] as RoleFilter[]).map(f => {
              const count = f === 'Hosts' ? hostCount : f === 'Admins' ? adminCount : total
              const activeCls = f === 'Hosts' ? 'bg-amber-500 text-white border-amber-500'
                : f === 'Admins' ? 'bg-violet-500 text-white border-violet-500'
                : 'bg-gray-900 text-white border-gray-900'
              return (
                <button key={f} onClick={() => setRoleFilter(f)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap transition-all ${
                    roleFilter === f ? activeCls : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}>
                  {f === 'Hosts' && '🔥 '}{f === 'Admins' && '⚡ '}{f}
                  {!loading && count > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${roleFilter === f ? 'bg-white/20' : 'bg-gray-100 text-gray-400'}`}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Pending connection requests */}
        {pendingRequests.length > 0 && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <h3 className="text-sm font-bold text-amber-800 mb-3">
              🤝 {pendingRequests.length} connection request{pendingRequests.length !== 1 ? 's' : ''} waiting
            </h3>
            <div className="flex flex-col gap-2">
              {pendingRequests.map(req => {
                const inPage = members.find(x => x.id === req.requesterId)
                const u = inPage ?? req.requester
                if (!u) return null
                return (
                  <div key={req.id} className="flex items-center gap-3 bg-white border border-amber-200 rounded-xl px-3 py-2.5">
                    {inPage ? (
                      <button onClick={() => setSelected(inPage)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                        {u.profilePhoto ? (
                          <img src={resolveImageUrl(u.profilePhoto)} alt={u.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                            style={{ backgroundColor: u.color }}>{getInitials(u.name)}</div>
                        )}
                        <span className="text-sm font-semibold text-gray-800 truncate">{u.name}</span>
                      </button>
                    ) : (
                      <Link href={`/members/${u.id}`} className="flex items-center gap-2 flex-1 min-w-0">
                        {u.profilePhoto ? (
                          <img src={resolveImageUrl(u.profilePhoto)} alt={u.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                            style={{ backgroundColor: u.color }}>{getInitials(u.name)}</div>
                        )}
                        <span className="text-sm font-semibold text-gray-800 truncate">{u.name}</span>
                      </Link>
                    )}
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => {
                          fetch(`/app/api/connections/${req.id}`, {
                            method: 'PATCH', credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'accept' }),
                          }).then(r => r.ok ? r.json() : null).then(d => {
                            if (d) handleConnectionChange(d.connection)
                          })
                        }}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg transition-colors">
                        Accept
                      </button>
                      <button
                        onClick={() => {
                          fetch(`/app/api/connections/${req.id}`, {
                            method: 'PATCH', credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'decline' }),
                          }).then(r => { if (r.ok) handleConnectionChange(null, req.id) })
                        }}
                        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold rounded-lg transition-colors">
                        Decline
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* My connections summary */}
        {connectedCount > 0 && !loading && (
          <p className="text-xs text-gray-400 mb-4">
            You're connected with {connectedCount} member{connectedCount !== 1 ? 's' : ''}
          </p>
        )}

        {(loading || filterLoading) && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl shadow-card overflow-hidden animate-pulse">
                <div className="w-full aspect-square bg-gray-200" />
                <div className="p-3 space-y-2">
                  <div className="h-3.5 bg-gray-200 rounded-full w-3/4" />
                  <div className="h-3 bg-gray-200 rounded-full w-1/2" />
                  <div className="flex gap-3 pt-1.5 border-t border-gray-100 mt-1">
                    <div className="h-3 bg-gray-200 rounded-full w-8" />
                    <div className="h-3 bg-gray-200 rounded-full w-8" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !filterLoading && visible.length === 0 && (
          <div className="text-center py-20 max-w-xs mx-auto">
            <div className="text-6xl mb-4">🔍</div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">No members found</h3>
            <p className="text-sm text-gray-500 mb-6">Try a different name, neighborhood, or interest.</p>
            <button
              onClick={() => { setSearch(''); setRoleFilter('All') }}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              Clear search
            </button>
          </div>
        )}

        {!loading && !filterLoading && visible.length > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {visible.map(m => (
                <MemberCard key={m.id} m={m} onClick={() => setSelected(m)} connectionStatus={getConnectionStatus(m.id)} />
              ))}
            </div>
            {hasMore && !search && roleFilter === 'All' && (
              <div className="flex flex-col items-center gap-2 mt-8">
                <p className="text-sm text-gray-400">Showing {members.length} of {total} members</p>
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
                >
                  {loadingMore ? 'Loading…' : 'Load more members'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
