'use client'

import { toast } from 'sonner'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getInitials } from '@/lib/data'

type TabKey = 'all' | 'member' | 'moderator' | 'admin' | 'unverified' | 'banned' | 'inactive'

interface DBUser {
  id: string
  name: string
  email: string
  role: string
  color: string
  emailVerified: boolean
  joinedAt: string
  lastActive: string | null
  status: string
  warningCount: number
  hasPassword: boolean
  phone: string | null
  // nationality drives the WhatsApp link's country-code logic — only
  // assume Turkey (+90) for a leading zero when the user has a Turkish
  // nationality recorded; otherwise pass digits through as-is.
  nationality: string | null
}

const TURKISH_NATIONALITIES = new Set(['turkey', 'türkiye', 'turkiye', 'tr', 'turkish'])

// WhatsApp URL with smarter country-code handling than the old
// `.replace(/^0/, '90')` shortcut, which mangled local-format phones from
// non-Turkish users (e.g. a French `0123456789` became `90123456789`).
function whatsappUrl(phone: string, nationality: string | null): string | null {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  const isTurkish = nationality
    ? TURKISH_NATIONALITIES.has(nationality.trim().toLowerCase())
    : false
  const normalized = (digits.startsWith('0') && isTurkish)
    ? '90' + digits.slice(1)
    : digits
  return `https://wa.me/${normalized}`
}

const roleBadge: Record<string, string> = {
  admin:     'bg-amber-500/10 text-amber-400',
  moderator: 'bg-purple-500/10 text-purple-400',
  member:    'bg-zinc-700 text-zinc-400',
}

function SuspendMenu({ u, onSuspend, onBan }: {
  u: DBUser
  onSuspend: (u: DBUser, days: number) => void
  onBan: (u: DBUser) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="p-2 rounded-lg text-orange-400 hover:bg-orange-500/10 transition-colors" title="Suspend / Ban">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 bg-zinc-800 border border-zinc-700 rounded-xl shadow-xl z-20 py-1 min-w-[140px]">
            <p className="px-3 pt-2 pb-1 text-xs font-bold text-zinc-600 uppercase tracking-wider">Suspend</p>
            {[1, 3, 7].map(d => (
              <button key={d} onClick={() => { setOpen(false); onSuspend(u, d) }}
                className="w-full text-left px-3 py-2 text-xs text-orange-400 hover:bg-zinc-700 transition-colors">
                {d} day{d > 1 ? 's' : ''}
              </button>
            ))}
            <div className="border-t border-zinc-700 mt-1 pt-1">
              <button onClick={() => { setOpen(false); onBan(u) }}
                className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-zinc-700 transition-colors font-semibold">
                Ban permanently
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function AdminUsersPage() {
  return <Suspense><AdminUsersPageInner /></Suspense>
}

function AdminUsersPageInner() {
  const searchParams = useSearchParams()
  const [users,   setUsers]   = useState<DBUser[]>([])
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState<TabKey>('all')
  const [search,  setSearch]  = useState(searchParams.get('search') ?? '')

  useEffect(() => {
    fetch('/app/api/admin/users', { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setUsers(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])


  async function changeRole(u: DBUser, role: string) {
    const res = await fetch(`/app/api/admin/users/${u.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    if (res.ok) {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, role } : x))
      toast.success(`${u.name} → ${role}`)
    } else {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Failed to change role')
    }
  }

  async function banUser(u: DBUser) {
    if (!window.confirm(`Ban ${u.name}? They will be signed out and blocked.`)) return
    const res = await fetch(`/app/api/admin/users/${u.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'banned', banReason: 'Banned by admin' }),
    })
    if (res.ok) {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, status: 'banned' } : x))
      toast.success(`${u.name} banned`)
    } else {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Failed to ban')
    }
  }

  async function suspendUser(u: DBUser, days: number) {
    const until = new Date(Date.now() + days * 86400000).toISOString()
    const res = await fetch(`/app/api/admin/users/${u.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suspendedUntil: until, suspensionNote: `Suspended ${days}d by admin` }),
    })
    if (res.ok) {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, status: 'suspended' } : x))
      toast.success(`${u.name} suspended ${days}d`)
    } else {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Failed to suspend')
    }
  }

  async function resendApproval(u: DBUser) {
    const res = await fetch(`/app/api/admin/users/${u.id}/resend-approval`, {
      method: 'POST',
      credentials: 'include',
    })
    if (res.ok) {
      toast(`Approval email resent to ${u.email}`)
    } else {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Failed to resend')
    }
  }

  async function removeUser(u: DBUser) {
    if (!window.confirm(`Remove ${u.name}? This cannot be undone.`)) return
    const res = await fetch(`/app/api/admin/users/${u.id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (res.ok) {
      setUsers(prev => prev.filter(x => x.id !== u.id))
      toast(`${u.name} removed`)
    }
  }

  // Search filter runs once and memoizes, so the tab counts below ALL
  // reflect the search-narrowed set instead of pretending nothing was
  // searched (the old code's counts ignored the search box, showing
  // misleading totals like "423 members" while only "1" was visible).
  const searchFiltered = useMemo(() => {
    if (!search) return users
    const s = search.toLowerCase()
    return users.filter(u => u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s))
  }, [users, search])

  const ninetyDaysAgo = Date.now() - (90 * 86400000)
  const counts: Record<TabKey, number> = useMemo(() => ({
    all:        searchFiltered.length,
    member:     searchFiltered.filter(u => u.role === 'member').length,
    moderator:  searchFiltered.filter(u => u.role === 'moderator').length,
    admin:      searchFiltered.filter(u => u.role === 'admin').length,
    unverified: searchFiltered.filter(u => !u.emailVerified).length,
    banned:     searchFiltered.filter(u => u.status === 'banned').length,
    inactive:   searchFiltered.filter(u =>
      !u.lastActive || new Date(u.lastActive).getTime() < ninetyDaysAgo
    ).length,
  }), [searchFiltered, ninetyDaysAgo])

  const visible = useMemo(() => searchFiltered.filter(u => {
    if (tab === 'member')    return u.role === 'member'
    if (tab === 'moderator') return u.role === 'moderator'
    if (tab === 'admin')     return u.role === 'admin'
    if (tab === 'unverified') return !u.emailVerified
    if (tab === 'banned')     return u.status === 'banned'
    if (tab === 'inactive') {
      return !u.lastActive || new Date(u.lastActive).getTime() < ninetyDaysAgo
    }
    return true  // 'all'
  }), [searchFiltered, tab, ninetyDaysAgo])

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'all',       label: 'All'        },
    { key: 'member',    label: 'Members'    },
    { key: 'moderator', label: 'Moderators' },
    { key: 'admin',     label: 'Admins'     },
    { key: 'unverified',label: 'Unverified' },
    { key: 'banned',    label: 'Banned'     },
    { key: 'inactive',  label: 'Inactive'   },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-white">Users</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          {loading ? 'Manage member accounts and roles' : <><span className="text-white font-bold">{users.length}</span> members · Manage accounts and roles</>}
        </p>
      </div>

      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex gap-1 bg-zinc-900 rounded-xl p-1 border border-zinc-800 overflow-x-auto scrollbar-hide">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                tab === t.key ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'
              }`}
            >
              {t.label}
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                tab === t.key ? 'bg-zinc-600 text-zinc-300' : 'bg-zinc-700 text-zinc-400'
              }`}>{counts[t.key]}</span>
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder="Search by name or email…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <button
          onClick={() => {
            const headers = ['Name', 'Email', 'Role', 'Status', 'Joined', 'Last Active']
            const rows = visible.map(u => [
              u.name, u.email, u.role, u.status,
              new Date(u.joinedAt).toLocaleDateString('en-GB'),
              u.lastActive ? new Date(u.lastActive).toLocaleDateString('en-GB') : '',
            ])
            const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
            // Revoke the object URL after the browser has had a beat to
            // start the download — without revoke, each Export click
            // leaks the blob until the page unloads.
            const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
            const a = Object.assign(document.createElement('a'), { href: url, download: 'members.csv' })
            a.click()
            setTimeout(() => URL.revokeObjectURL(url), 200)
          }}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          Export CSV
        </button>
        <div className="flex-1 hidden sm:block" />
      </div>

      {/* Table */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
        {/* Desktop header */}
        <div className="hidden md:grid grid-cols-12 gap-3 px-6 py-3 border-b border-zinc-800 text-xs font-bold text-zinc-500 uppercase tracking-wider">
          <div className="col-span-5">Name</div>
          <div className="col-span-4">Role</div>
          <div className="col-span-3 text-right">Actions</div>
        </div>

        <div className="divide-y divide-zinc-800">
          {loading && <div className="px-6 py-12 text-center text-zinc-500 text-sm">Loading…</div>}
          {!loading && visible.length === 0 && <div className="px-6 py-12 text-center text-zinc-500 text-sm">No users found.</div>}
          {visible.map(u => {
            // waLink replaces the earlier dead-code + duplicate of this
            // inline string. The helper applies the +90 prefix only when
            // nationality is Turkish (was unconditional before, which
            // broke non-Turkish users' local-format numbers).
            const waLink = u.phone ? whatsappUrl(u.phone, u.nationality) : null
            const userActions = (
              <div className="flex gap-1.5 items-center">
                {waLink && (
                  <a href={waLink} target="_blank" rel="noopener noreferrer"
                    className="p-2 rounded-lg text-green-400 hover:bg-green-500/10 transition-colors" title="Message on WhatsApp"
                    onClick={e => e.stopPropagation()}>
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                  </a>
                )}
                {u.status === 'approved' && !u.hasPassword && (
                  <button onClick={() => resendApproval(u)} className="p-2 rounded-lg text-amber-400 hover:bg-amber-500/10 transition-colors" title="Resend approval link">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  </button>
                )}
                {u.role !== 'admin' && u.status !== 'banned' && (
                  <SuspendMenu u={u} onSuspend={suspendUser} onBan={banUser} />
                )}
                {u.role !== 'admin' && (
                  <button onClick={() => removeUser(u)} className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors" title="Remove">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                )}
              </div>
            )
            return (
              <div key={u.id}>
                {/* Mobile card */}
                <div className="md:hidden px-4 py-3 flex items-center gap-3">
                  <Link href={`/admin/users/${u.id}`} className="shrink-0">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: u.color }}>{getInitials(u.name)}</div>
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/admin/users/${u.id}`} className="font-semibold text-sm text-white truncate hover:text-amber-400 transition-colors">{u.name}</Link>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize shrink-0 ${roleBadge[u.role] ?? 'bg-zinc-700 text-zinc-400'}`}>{u.role}</span>
                    </div>
                    <div className="text-xs text-zinc-500">{new Date(u.joinedAt).toLocaleDateString('en-GB')}</div>
                    {(u.status === 'banned' || u.status === 'suspended' || u.warningCount > 0) && (
                      <div className="flex items-center gap-1.5 mt-1">
                        {u.status === 'banned' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">banned</span>}
                        {u.status === 'suspended' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">suspended</span>}
                        {u.warningCount > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">⚠ {u.warningCount} warning{u.warningCount !== 1 ? 's' : ''}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">{userActions}</div>
                </div>

                {/* Desktop row */}
                <div className="hidden md:grid grid-cols-12 gap-3 px-6 py-3.5 items-center hover:bg-zinc-800/40 transition-colors">
                  <Link href={`/admin/users/${u.id}`} className="col-span-5 flex items-center gap-3 min-w-0 group">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: u.color }}>{getInitials(u.name)}</div>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-white truncate group-hover:text-amber-400 transition-colors">{u.name}</div>
                      <div className="text-xs text-zinc-500">{new Date(u.joinedAt).toLocaleDateString('en-GB')}</div>
                    </div>
                  </Link>
                  <div className="col-span-4">
                    {u.role === 'admin' ? (
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${roleBadge[u.role] ?? 'bg-zinc-700 text-zinc-400'}`}>{u.role}</span>
                    ) : (
                      <select
                        value={u.role}
                        onChange={e => changeRole(u, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="text-xs font-semibold px-2 py-1 rounded-full bg-zinc-700 text-zinc-300 border-0 focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
                      >
                        <option value="member">member</option>
                        <option value="moderator">moderator</option>
                        <option value="admin">admin</option>
                      </select>
                    )}
                  </div>
                  <div className="col-span-3 flex gap-1.5 justify-end">{userActions}</div>
                </div>
              </div>
            )
          })}
        </div>

        {visible.length > 0 && (
          <div className="px-6 py-3 border-t border-zinc-800 bg-zinc-800/50 text-xs text-zinc-500">
            Showing {visible.length} of {users.length} users
          </div>
        )}
      </div>
    </div>
  )
}
