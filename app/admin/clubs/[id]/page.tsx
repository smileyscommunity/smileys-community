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

// Aggregate quality rollup for the club — mirrors host quality on
// /admin/users/[id]. Null when the club has zero events. Numbers
// stay null until at least one survey response lands. responseRate
// is an approximation: (approved attendees - 1 host - cohosts).
interface ClubQuality {
  eventsHosted:    number
  surveyResponses: number
  wouldReturnRate: number | null
  anomalyCount:    number
  responseRate:    number | null
  recent: {
    id: string; title: string; emoji: string; date: string
    wouldReturnRate: number | null; responses: number; anomalyCount: number; responseRate: number | null
  }[]
}

interface ClubEvent {
  id: string; title: string; date: string; emoji: string
  status: string; totalSpots: number; spotsLeft: number
}

interface AuditEntry {
  id: string; action: string; adminName: string
  description: string | null; meta: unknown; createdAt: string
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
  const [clubIsActive, setClubIsActive] = useState<boolean | null>(null)
  const [quality,     setQuality]     = useState<ClubQuality | null>(null)
  const [events,      setEvents]      = useState<ClubEvent[]>([])
  const [auditLog,    setAuditLog]    = useState<AuditEntry[]>([])
  const [showAudit,   setShowAudit]   = useState(false)
  const [archiving,   setArchiving]   = useState(false)
  const [archiveReason, setArchiveReason] = useState('')
  const [showArchiveDialog, setShowArchiveDialog] = useState(false)
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [allUsers,    setAllUsers]    = useState<Member[]>([])

  useEffect(() => {
    // The new /api/admin/clubs/[id] GET returns club + quality in
    // one round trip; the old "fetch all clubs and find by id" path
    // was always wasteful and gets worse as the club list grows.
    Promise.all([
      fetch(`/app/api/admin/clubs/${id}/memberships`, { credentials: 'include' }).then(r => r.json()),
      fetch(`/app/api/admin/clubs/${id}`,             { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/admin/users',                   { credentials: 'include' }).then(r => r.json()),
    ]).then(([mems, club, users]) => {
      setMemberships(Array.isArray(mems) ? mems : [])
      if (club && !club.error) {
        setClubName(club.name)
        setClubIsActive(typeof club.isActive === 'boolean' ? club.isActive : null)
        setQuality(club.quality ?? null)
        setEvents(Array.isArray(club.events)   ? club.events   : [])
        setAuditLog(Array.isArray(club.auditLog) ? club.auditLog : [])
      }
      setAllUsers(Array.isArray(users) ? users : [])
    }).finally(() => setLoading(false))
  }, [id])

  async function archiveClub() {
    if (!clubName) return
    setArchiving(true)
    const res = await fetch(`/app/api/admin/clubs/${id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false, _deactivateReason: archiveReason.trim() }),
    })
    setArchiving(false)
    if (res.ok) {
      setClubIsActive(false)
      setShowArchiveDialog(false)
      setArchiveReason('')
      toast.success(`"${clubName}" archived · members notified`)
    } else {
      toast.error('Could not archive')
    }
  }

  async function reactivateClub() {
    if (!clubName) return
    setArchiving(true)
    const res = await fetch(`/app/api/admin/clubs/${id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    })
    setArchiving(false)
    if (res.ok) {
      setClubIsActive(true)
      toast.success(`"${clubName}" reactivated`)
    }
  }

  async function patch(userId: string, data: { status?: string; role?: string }) {
    const res = await fetch(`/app/api/admin/clubs/${id}/memberships`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, ...data }),
    })
    if (!res.ok) { toast.error('Something went wrong'); return }
    // Rejection deletes the row server-side now, so we filter it
    // out of local state too. Previously the row stayed in the
    // array as status='rejected' and blocked re-adds because the
    // user ended up in `memberIds`, which excluded them from the
    // "Add a member" search results.
    if (data.status === 'rejected') {
      setMemberships(prev => prev.filter(m => m.user.id !== userId))
    } else {
      setMemberships(prev => prev.map(m => m.user.id === userId ? { ...m, ...data } : m))
    }
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

      {/* Club quality card — mirrors host quality on /admin/users/[id].
          Surfaces only when the club has hosted at least one event.
          wouldReturn = signal, responseRate = trust-the-signal.
          Recent-6 row lets admins drill into "which event tanked
          the rate?" without leaving the page. */}
      {quality && quality.eventsHosted > 0 && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <div>
              <h3 className="text-sm font-bold text-white">Club quality</h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                {quality.surveyResponses > 0
                  ? `${quality.surveyResponses} post-event survey response${quality.surveyResponses === 1 ? '' : 's'} across ${quality.eventsHosted} event${quality.eventsHosted === 1 ? '' : 's'}`
                  : `${quality.eventsHosted} event${quality.eventsHosted === 1 ? '' : 's'} — no survey responses yet`}
              </p>
            </div>
            {quality.anomalyCount > 0 && (
              <span className="text-xs font-bold px-2 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 shrink-0">
                ⚠ {quality.anomalyCount} anomal{quality.anomalyCount === 1 ? 'y' : 'ies'}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-zinc-950/40 rounded-xl p-3">
              <div className={`text-2xl sm:text-3xl font-extrabold ${
                quality.wouldReturnRate === null  ? 'text-zinc-600'
                  : quality.wouldReturnRate >= 80 ? 'text-green-400'
                  : quality.wouldReturnRate >= 60 ? 'text-amber-400'
                  : 'text-red-400'
              }`}>
                {quality.wouldReturnRate === null ? '—' : `${quality.wouldReturnRate}%`}
              </div>
              <div className="text-xs text-zinc-500 mt-1">Would attend again</div>
            </div>
            <div className="bg-zinc-950/40 rounded-xl p-3">
              <div className={`text-2xl sm:text-3xl font-extrabold ${
                quality.responseRate === null  ? 'text-zinc-600'
                  : quality.responseRate >= 50 ? 'text-green-400'
                  : quality.responseRate >= 25 ? 'text-amber-400'
                  : 'text-red-400'
              }`}>
                {quality.responseRate === null ? '—' : `${quality.responseRate}%`}
              </div>
              <div className="text-xs text-zinc-500 mt-1">Response rate</div>
            </div>
            <div className="bg-zinc-950/40 rounded-xl p-3">
              <div className="text-2xl sm:text-3xl font-extrabold text-white">{quality.eventsHosted}</div>
              <div className="text-xs text-zinc-500 mt-1">Events</div>
            </div>
            <div className="bg-zinc-950/40 rounded-xl p-3">
              <div className="text-2xl sm:text-3xl font-extrabold text-white">{quality.surveyResponses}</div>
              <div className="text-xs text-zinc-500 mt-1">Responses</div>
            </div>
          </div>

          {quality.recent.length > 0 && (
            <div className="mt-4 pt-4 border-t border-zinc-800">
              <p className="text-xs font-bold text-zinc-600 uppercase tracking-wider mb-2">Recent — last {quality.recent.length}</p>
              <div className="space-y-1.5">
                {quality.recent.map(e => (
                  <Link key={e.id} href={`/admin/events/${e.id}/edit`}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-950/40 hover:bg-zinc-800 transition-colors">
                    <span className="text-base shrink-0">{e.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-white truncate">{e.title}</p>
                      <p className="text-[10px] text-zinc-600">{new Date(e.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
                    </div>
                    <div className="text-right shrink-0 text-xs">
                      {e.wouldReturnRate !== null ? (
                        <span className={`font-bold ${
                          e.wouldReturnRate >= 80 ? 'text-green-400'
                            : e.wouldReturnRate >= 60 ? 'text-amber-400'
                            : 'text-red-400'
                        }`}>{e.wouldReturnRate}%</span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                      <span className="text-zinc-600 ml-1">
                        {e.responses > 0
                          ? `(${e.responses}${e.responseRate !== null ? ` · ${e.responseRate}%` : ''})`
                          : ''}
                      </span>
                      {e.anomalyCount > 0 && (
                        <span className="ml-1.5 px-1 rounded bg-red-500/20 text-red-400 font-bold">⚠{e.anomalyCount}</span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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

      {/* Events list — drill-down from "club quality is dipping"
          straight to "which events tanked it". Status badges so the
          admin spots drafts/archived without filtering. */}
      {events.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-white mb-3">
            Events <span className="text-zinc-500 font-normal">({events.length})</span>
          </h2>
          <div className="space-y-1.5">
            {events.slice(0, 10).map(e => (
              <Link key={e.id} href={`/admin/events/${e.id}/edit`}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-950/40 hover:bg-zinc-800 transition-colors">
                <span className="text-base shrink-0">{e.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white truncate">{e.title}</p>
                  <p className="text-[10px] text-zinc-600">{new Date(e.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {e.totalSpots - e.spotsLeft}/{e.totalSpots} RSVPs</p>
                </div>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                  e.status === 'published' ? 'bg-emerald-500/15 text-emerald-400'
                    : e.status === 'archived' ? 'bg-zinc-700 text-zinc-400'
                    : e.status === 'pending'  ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-red-500/15 text-red-400'
                }`}>
                  {e.status}
                </span>
              </Link>
            ))}
            {events.length > 10 && (
              <p className="text-[10px] text-zinc-600 text-center pt-2">+ {events.length - 10} older events</p>
            )}
          </div>
        </div>
      )}

      {/* Audit trail — every club.* and club.member_* action
          targeted at this club, newest first. Collapsed by default
          since most viewing sessions don't need it; one tap to
          expand. */}
      {auditLog.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <button onClick={() => setShowAudit(s => !s)}
            className="w-full flex items-center justify-between text-left">
            <h2 className="text-sm font-semibold text-white">
              Audit trail <span className="text-zinc-500 font-normal">({auditLog.length})</span>
            </h2>
            <svg className={`w-4 h-4 text-zinc-500 transition-transform ${showAudit ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showAudit && (
            <div className="mt-3 space-y-1.5 max-h-96 overflow-y-auto">
              {auditLog.map(a => (
                <div key={a.id} className="px-3 py-2 rounded-lg bg-zinc-950/40">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="text-[10px] font-bold text-amber-400 font-mono">{a.action}</span>
                    <span className="text-[10px] text-zinc-600">·</span>
                    <span className="text-[10px] text-zinc-500">{a.adminName}</span>
                    <span className="text-[10px] text-zinc-600">·</span>
                    <span className="text-[10px] text-zinc-600">{new Date(a.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  {a.description && <p className="text-xs text-zinc-400">{a.description}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Soft archive — the recoverable destructive action. Hard
          delete still lives on the list page (with the type-name
          confirm) because it's a destination, not an in-context
          action. Reactivation is one-click since coming back online
          shouldn't be friction. */}
      {clubIsActive !== null && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-white mb-1">
            {clubIsActive ? 'Archive this club' : 'Club is archived'}
          </h2>
          <p className="text-xs text-zinc-500 mb-3">
            {clubIsActive
              ? 'Members keep their memberships, the club stops accepting new events, and everyone gets a notification with your reason.'
              : 'Members were notified. Reactivate anytime — they\'ll be notified the club is back.'}
          </p>
          {clubIsActive ? (
            <button onClick={() => setShowArchiveDialog(true)}
              className="px-4 py-2 rounded-xl bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 text-sm font-semibold transition-colors">
              Archive club
            </button>
          ) : (
            <button onClick={reactivateClub} disabled={archiving}
              className="px-4 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-sm font-semibold transition-colors disabled:opacity-50">
              {archiving ? 'Reactivating…' : 'Reactivate'}
            </button>
          )}
        </div>
      )}

      {/* Archive confirm dialog — same reason-capture pattern as
          /admin/clubs list page for consistency. */}
      {showArchiveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowArchiveDialog(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-white font-bold text-base mb-1">Archive &ldquo;{clubName}&rdquo;?</h2>
            <p className="text-sm text-zinc-500 mb-4">
              Members keep their membership but new events stop. They&apos;ll get a notification — add a reason if you want them to know why.
            </p>
            <textarea value={archiveReason} onChange={e => setArchiveReason(e.target.value)}
              placeholder="Optional · e.g. Host is on sabbatical until October"
              rows={3}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none mb-4" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowArchiveDialog(false)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-semibold transition-colors">
                Cancel
              </button>
              <button onClick={archiveClub} disabled={archiving}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-60">
                {archiving ? 'Archiving…' : 'Archive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
