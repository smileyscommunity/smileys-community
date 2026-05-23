'use client'

import { toast } from 'sonner'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { resolveImageUrl } from '@/lib/data'

interface Member {
  id: string
  name: string
  color: string
  profilePhoto: string | null
  email?: string
  role?: string
}

interface ClubMembership {
  status: string
  role: string
  joinedAt: string
  user: Member
}

function Avatar({ user }: { user: Member }) {
  const photo = resolveImageUrl(user.profilePhoto)
  const initials = user.name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  return photo ? (
    <img src={photo} alt={user.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
  ) : (
    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
      style={{ backgroundColor: user.color }}>
      {initials}
    </div>
  )
}

export default function AdminClubDetailPage() {
  const { id } = useParams<{ id: string }>()

  const [memberships, setMemberships] = useState<ClubMembership[]>([])
  const [clubName,    setClubName]    = useState('')
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [allUsers,    setAllUsers]    = useState<Member[]>([])

  useEffect(() => {
    Promise.all([
      fetch(`/app/api/admin/clubs/${id}/memberships`, { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/admin/clubs', { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/admin/users', { credentials: 'include' }).then(r => r.json()),
    ]).then(([mems, clubs, users]) => {
      setMemberships(Array.isArray(mems) ? mems : [])
      const club = Array.isArray(clubs) ? clubs.find((c: any) => c.id === id) : null
      if (club) setClubName(club.name)
      setAllUsers(Array.isArray(users) ? users : [])
    }).finally(() => setLoading(false))
  }, [id])

  async function patch(userId: string, data: { status?: string; role?: string }) {
    const res = await fetch(`/app/api/admin/clubs/${id}/memberships`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, ...data }),
    })
    if (!res.ok) { toast.error('Something went wrong'); return }
    setMemberships(prev => prev.map(m =>
      m.user.id === userId ? { ...m, ...data } : m
    ))
    if (data.status === 'approved') toast.success('Approved ✓')
    else if (data.status === 'rejected') toast('Request declined')
    else if (data.role === 'host') toast.success('Host assigned ✓')
    else if (data.role === 'member') toast('Host removed')
  }

  async function remove(userId: string) {
    const res = await fetch(`/app/api/admin/clubs/${id}/memberships`, {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    if (!res.ok) { toast.error('Something went wrong'); return }
    setMemberships(prev => prev.filter(m => m.user.id !== userId))
    toast('Member removed')
  }

  async function addMember(userId: string) {
    const res = await fetch(`/app/api/admin/clubs/${id}/memberships`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    if (!res.ok) { toast.error('Already a member or error'); return }
    const mem = await res.json()
    setMemberships(prev => [...prev, mem])
    toast.success('Member added ✓')
    setSearch('')
  }

  const pending  = memberships.filter(m => m.status === 'pending')
  const approved = memberships.filter(m => m.status === 'approved')
  const memberIds = new Set(memberships.map(m => m.user.id))

  const searchResults = search.trim()
    ? allUsers.filter(u =>
        u.name.toLowerCase().includes(search.toLowerCase()) && !memberIds.has(u.id)
      ).slice(0, 6)
    : []

  return (
    <div className="p-6 max-w-2xl space-y-6">

      <div className="flex items-center gap-3">
        <Link href="/admin/clubs" className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-white">{clubName || 'Club'}</h1>
          <p className="text-sm text-zinc-400">Manage members</p>
        </div>
      </div>

      {/* Pending requests */}
      {(loading || pending.length > 0) && (
        <div className="bg-zinc-900 border border-amber-500/30 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">
            Pending requests
            {pending.length > 0 && (
              <span className="ml-2 bg-amber-500 text-black text-xs font-bold px-2 py-0.5 rounded-full">
                {pending.length}
              </span>
            )}
          </h2>

          {loading && <p className="text-zinc-500 text-sm">Loading…</p>}

          {!loading && pending.length === 0 && (
            <p className="text-zinc-500 text-sm">No pending requests.</p>
          )}

          <div className="space-y-2">
            {pending.map(({ user }) => (
              <div key={user.id} className="flex items-center gap-3 py-2">
                <Avatar user={user} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{user.name}</p>
                  {user.email && <p className="text-xs text-zinc-500 truncate">{user.email}</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => patch(user.id, { status: 'approved' })}
                    className="text-xs bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 font-semibold px-3 py-2 rounded-lg transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => patch(user.id, { status: 'rejected' })}
                    className="text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 font-semibold px-3 py-2 rounded-lg transition-colors"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approved members */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-white mb-4">
          Members <span className="text-zinc-500 font-normal">({approved.length})</span>
        </h2>

        {loading && <p className="text-zinc-500 text-sm">Loading…</p>}

        {!loading && approved.length === 0 && (
          <p className="text-zinc-500 text-sm">No approved members yet.</p>
        )}

        <div className="space-y-2">
          {approved.map(({ user, role }) => (
            <div key={user.id} className="flex items-center gap-3 py-2">
              <Avatar user={user} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{user.name}</p>
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                  role === 'host' ? 'bg-blue-900 text-blue-300' : 'bg-zinc-800 text-zinc-400'
                }`}>
                  {role === 'host' ? 'Host' : 'Member'}
                </span>
              </div>
              <div className="flex gap-2 shrink-0">
                {role !== 'host' ? (
                  <button
                    onClick={() => patch(user.id, { role: 'host' })}
                    className="text-xs text-amber-400 hover:text-amber-300 transition-colors px-2 py-1 rounded-lg hover:bg-amber-900/20"
                  >
                    Make host
                  </button>
                ) : (
                  <button
                    onClick={() => patch(user.id, { role: 'member' })}
                    className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors px-2 py-1 rounded-lg hover:bg-zinc-800"
                  >
                    Remove host
                  </button>
                )}
                <button
                  onClick={() => remove(user.id)}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded-lg hover:bg-red-900/20"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add member manually */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Add a member</h2>
        <div className="relative">
          <input
            type="text"
            placeholder="Search members by name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-4 py-2.5 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
          />
          {searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden z-10 shadow-xl">
              {searchResults.map(user => (
                <button
                  key={user.id}
                  onClick={() => addMember(user.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-700 transition-colors text-left"
                >
                  <Avatar user={user} />
                  <span className="text-sm font-medium text-white">{user.name}</span>
                  <span className="ml-auto text-xs text-amber-400 font-semibold">Add →</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-xs text-zinc-500 mt-2">Manually add any approved member to this club.</p>
      </div>

    </div>
  )
}
