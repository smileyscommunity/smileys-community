'use client'

import { toast } from 'sonner'

import { useState, useEffect, useMemo, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { getInitials } from '@/lib/data'

type TabKey = 'all' | 'member' | 'moderator' | 'admin' | 'unverified' | 'banned' | 'suspended' | 'inactive' | 'warned'

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
  // FingerprintJS visitorId from the user's last successful login.
  // Used for cross-account risk flagging — if two accounts share this,
  // they were last logged in from the same device.
  lastFingerprint: string | null
  // ISO string. User is "suspended" iff this is set and in the future.
  // Status enum doesn't have a 'suspended' value, so this is the only
  // source of truth — see isSuspended() below.
  suspendedUntil: string | null
}

function isSuspended(u: { suspendedUntil: string | null }): boolean {
  return !!u.suspendedUntil && new Date(u.suspendedUntil).getTime() > Date.now()
}

type SortKey = 'recent' | 'active' | 'warnings'

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

const ROLE_BADGE_FALLBACK = 'bg-zinc-700 text-zinc-400'
const roleBadge: Record<string, string> = {
  admin:     'bg-amber-500/10 text-amber-400',
  moderator: 'bg-purple-500/10 text-purple-400',
  member:    ROLE_BADGE_FALLBACK,
}

// One source of truth for the role pill's color classes. Previously the
// fallback string `bg-zinc-700 text-zinc-400` was inlined at every call
// site, so adding a new role would need three edits and the desktop +
// mobile pills could silently drift out of sync.
function roleBadgeClass(role: string): string {
  return roleBadge[role] ?? ROLE_BADGE_FALLBACK
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
  const router       = useRouter()
  const pathname     = usePathname()
  const [users,       setUsers]       = useState<DBUser[]>([])
  const [loading,     setLoading]     = useState(true)
  const [tab,         setTab]         = useState<TabKey>('all')
  const [search,      setSearch]      = useState(searchParams.get('search') ?? '')
  const [sortBy,      setSortBy]      = useState<SortKey>('recent')
  // Date-range filter — two ISO yyyy-mm-dd strings, both optional. Restricts
  // to users whose joinedAt falls within the range.
  const [joinedFrom,  setJoinedFrom]  = useState('')
  const [joinedTo,    setJoinedTo]    = useState('')
  // Bulk-action selection — Set of user ids. Same pattern the applications
  // page uses; bulk-action bar appears once any are selected.
  const [selected,    setSelected]    = useState<Set<string>>(new Set())
  const [bulkSaving,  setBulkSaving]  = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [, setTick] = useState(0)  // forces re-render so the "Updated Xs ago" label ages

  // load() runs the initial fetch and the auto-refresh poll. background=true
  // skips the skeleton flicker so the 30s refresh doesn't blank the page.
  const load = useCallback((background = false) => {
    if (!background) setLoading(true)
    fetch('/app/api/admin/users', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setUsers(data)
          setLastRefresh(new Date())
        }
      })
      .catch(() => {})
      .finally(() => { if (!background) setLoading(false) })
  }, [])

  useEffect(() => { load(false) }, [load])

  // Background auto-refresh every 30s, paused via the Page Visibility API
  // when the tab is hidden (matches the applications page pattern) and
  // resumed on focus with an immediate refresh.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => { if (!timer) timer = setInterval(() => { if (!document.hidden) load(true) }, 30_000) }
    const stop  = () => { if (timer) { clearInterval(timer); timer = null } }
    const onVisibility = () => { if (document.hidden) stop(); else { load(true); start() } }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [load])

  // 1s tick so the "Updated Xs ago" label ages without refetching.
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Auto-pick the "most warnings" sort when the admin clicks the Warned
  // tab. Otherwise they see warned users in joined-date order and have to
  // hit the sort dropdown to surface the worst offender. Only fires on the
  // tab change (not the user picking a different sort while on Warned).
  useEffect(() => {
    if (tab === 'warned') setSortBy('warnings')
  }, [tab])

  // URL-sync the search input — debounced 250ms so typing doesn't spam
  // history. Replace (not push) so the back button doesn't re-create every
  // intermediate query state.
  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (search) params.set('search', search)
      else        params.delete('search')
      const q = params.toString()
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
    }, 250)
    return () => clearTimeout(t)
  // searchParams is intentionally excluded — including it would re-fire the
  // effect on every URL change (including the ones we just made), creating
  // an infinite loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, pathname, router])

  const refreshLabel = (() => {
    if (!lastRefresh) return ''
    const s = Math.floor((Date.now() - lastRefresh.getTime()) / 1000)
    if (s < 5)     return 'Updated just now'
    if (s < 60)    return `Updated ${s}s ago`
    if (s < 3600)  return `Updated ${Math.floor(s / 60)}m ago`
    return `Updated ${Math.floor(s / 3600)}h ago`
  })()


  async function changeRole(u: DBUser, role: string) {
    // Admin promotion is a privilege escalation that's one careless click
    // away on a select; require explicit confirm. Demotions don't need
    // the same gate (worst case: a re-promote click).
    if (role === 'admin' && u.role !== 'admin') {
      if (!window.confirm(`Promote ${u.name} to admin? They will gain full moderation and user-management powers.`)) return
    }
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
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, suspendedUntil: until } : x))
      toast.success(`${u.name} suspended ${days}d`)
    } else {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Failed to suspend')
    }
  }

  async function unsuspendUser(u: DBUser) {
    if (!window.confirm(`Lift suspension on ${u.name}?`)) return
    const res = await fetch(`/app/api/admin/users/${u.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suspendedUntil: null, suspensionNote: null }),
    })
    if (res.ok) {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, suspendedUntil: null } : x))
      toast.success(`${u.name} unsuspended`)
    } else {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Failed to unsuspend')
    }
  }

  async function unbanUser(u: DBUser) {
    if (!window.confirm(`Unban ${u.name}? They will regain access.`)) return
    const res = await fetch(`/app/api/admin/users/${u.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved', banReason: null }),
    })
    if (res.ok) {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, status: 'approved' } : x))
      toast.success(`${u.name} unbanned`)
    } else {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Failed to unban')
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

  async function warnUser(u: DBUser) {
    const reason = window.prompt(`Warn ${u.name}? Reason will be sent to them and logged.`)
    if (!reason || !reason.trim()) return
    const res = await fetch(`/app/api/admin/users/${u.id}/warn`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() }),
    })
    if (res.ok) {
      const data = await res.json().catch(() => ({}))
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, warningCount: data.warningCount ?? x.warningCount + 1 } : x))
      toast.success(`${u.name} warned`)
    } else {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Failed to warn')
    }
  }

  // Bulk actions — operate on the `selected` Set. Run in series so the user
  // gets one toast per success/failure and so a single 500 doesn't abort the
  // batch silently. Clearing the selection only happens after all complete.
  async function bulkRun(label: string, work: (u: DBUser) => Promise<boolean>) {
    if (selected.size === 0) return
    // Drop admins defensively — checkbox is hidden for admin rows, but a
    // role change between selection and click could still slip one through
    // and the resulting "1 failed" toast wouldn't explain why.
    const targets = users.filter(u => selected.has(u.id) && u.role !== 'admin')
    if (targets.length === 0) { toast.error('Selection contains only admins — nothing to do'); return }
    if (!window.confirm(`${label} ${targets.length} user${targets.length > 1 ? 's' : ''}?`)) return
    setBulkSaving(true)
    let ok = 0, fail = 0
    for (const u of targets) {
      try { if (await work(u)) ok++; else fail++ } catch { fail++ }
    }
    setBulkSaving(false)
    setSelected(new Set())
    if (ok)   toast.success(`${label}: ${ok} done`)
    if (fail) toast.error(`${label}: ${fail} failed`)
  }

  async function bulkBan(reason: string) {
    await bulkRun('Ban', async (u) => {
      const res = await fetch(`/app/api/admin/users/${u.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'banned', banReason: reason }),
      })
      if (res.ok) {
        setUsers(prev => prev.map(x => x.id === u.id ? { ...x, status: 'banned' } : x))
        return true
      }
      return false
    })
  }

  async function bulkSuspend(days: number) {
    const until = new Date(Date.now() + days * 86400000).toISOString()
    await bulkRun(`Suspend ${days}d`, async (u) => {
      const res = await fetch(`/app/api/admin/users/${u.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspendedUntil: until, suspensionNote: `Suspended ${days}d by admin (bulk)` }),
      })
      if (res.ok) {
        setUsers(prev => prev.map(x => x.id === u.id ? { ...x, suspendedUntil: until } : x))
        return true
      }
      return false
    })
  }

  async function bulkWarn(reason: string) {
    await bulkRun('Warn', async (u) => {
      const res = await fetch(`/app/api/admin/users/${u.id}/warn`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        setUsers(prev => prev.map(x => x.id === u.id ? { ...x, warningCount: data.warningCount ?? x.warningCount + 1 } : x))
        return true
      }
      return false
    })
  }

  function exportSelected() {
    if (selected.size === 0) return
    const targets = users.filter(u => selected.has(u.id))
    const headers = ['Name', 'Email', 'Role', 'Status', 'Warnings', 'Nationality', 'Joined', 'Last Active']
    const rows = targets.map(u => [
      u.name, u.email, u.role,
      isSuspended(u) ? 'suspended' : u.status,
      String(u.warningCount), u.nationality ?? '',
      new Date(u.joinedAt).toLocaleDateString('en-GB'),
      u.lastActive ? new Date(u.lastActive).toLocaleDateString('en-GB') : '',
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'members-selected.csv' })
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 200)
  }

  // Map of fingerprint → count of accounts sharing it. Used to surface a
  // "⚠ Same device" risk badge when two or more accounts last signed in
  // from the same FingerprintJS visitorId. Built once per `users` change so
  // we don't recompute per row.
  const fingerprintCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const u of users) {
      if (!u.lastFingerprint) continue
      m.set(u.lastFingerprint, (m.get(u.lastFingerprint) ?? 0) + 1)
    }
    return m
  }, [users])

  // Search + date-range filter. Runs once and memoizes, so the tab counts
  // below ALL reflect the narrowed set instead of pretending nothing was
  // filtered (the old code's counts ignored the search box, showing
  // misleading totals like "423 members" while only "1" was visible).
  const searchFiltered = useMemo(() => {
    const s = search.toLowerCase()
    // Date inputs are yyyy-mm-dd local; treat "from" as start-of-day and
    // "to" as end-of-day in the user's tz by appending T00 / T23:59:59.999.
    const fromTs = joinedFrom ? new Date(joinedFrom + 'T00:00:00').getTime() : null
    const toTs   = joinedTo   ? new Date(joinedTo   + 'T23:59:59.999').getTime() : null
    return users.filter(u => {
      if (s && !u.name.toLowerCase().includes(s) && !u.email.toLowerCase().includes(s)) return false
      if (fromTs !== null || toTs !== null) {
        const t = new Date(u.joinedAt).getTime()
        if (fromTs !== null && t < fromTs) return false
        if (toTs   !== null && t > toTs)   return false
      }
      return true
    })
  }, [users, search, joinedFrom, joinedTo])

  const ninetyDaysAgo = Date.now() - (90 * 86400000)
  const counts: Record<TabKey, number> = useMemo(() => ({
    all:        searchFiltered.length,
    member:     searchFiltered.filter(u => u.role === 'member').length,
    moderator:  searchFiltered.filter(u => u.role === 'moderator').length,
    admin:      searchFiltered.filter(u => u.role === 'admin').length,
    unverified: searchFiltered.filter(u => !u.emailVerified).length,
    banned:     searchFiltered.filter(u => u.status === 'banned').length,
    suspended:  searchFiltered.filter(isSuspended).length,
    inactive:   searchFiltered.filter(u =>
      !u.lastActive || new Date(u.lastActive).getTime() < ninetyDaysAgo
    ).length,
    warned:     searchFiltered.filter(u => u.warningCount > 0).length,
  }), [searchFiltered, ninetyDaysAgo])

  const visible = useMemo(() => {
    const filtered = searchFiltered.filter(u => {
      if (tab === 'member')    return u.role === 'member'
      if (tab === 'moderator') return u.role === 'moderator'
      if (tab === 'admin')     return u.role === 'admin'
      if (tab === 'unverified') return !u.emailVerified
      if (tab === 'banned')     return u.status === 'banned'
      if (tab === 'suspended')  return isSuspended(u)
      if (tab === 'warned')     return u.warningCount > 0
      if (tab === 'inactive') {
        return !u.lastActive || new Date(u.lastActive).getTime() < ninetyDaysAgo
      }
      return true  // 'all'
    })
    // Sort is applied after tab/search/date filtering so the rows you see
    // are ranked by whatever the admin picked. Spread into a fresh array
    // because Array.sort mutates and the upstream memo is shared.
    const sorted = [...filtered]
    if (sortBy === 'recent') {
      sorted.sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime())
    } else if (sortBy === 'active') {
      // Nulls (never active) sink to the bottom.
      sorted.sort((a, b) => {
        const at = a.lastActive ? new Date(a.lastActive).getTime() : 0
        const bt = b.lastActive ? new Date(b.lastActive).getTime() : 0
        return bt - at
      })
    } else if (sortBy === 'warnings') {
      sorted.sort((a, b) => b.warningCount - a.warningCount)
    }
    return sorted
  }, [searchFiltered, tab, sortBy, ninetyDaysAgo])

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'all',       label: 'All'        },
    { key: 'member',    label: 'Members'    },
    { key: 'moderator', label: 'Moderators' },
    { key: 'admin',     label: 'Admins'     },
    { key: 'unverified',label: 'Unverified' },
    { key: 'warned',    label: 'Warned'     },
    { key: 'suspended', label: 'Suspended'  },
    { key: 'banned',    label: 'Banned'     },
    { key: 'inactive',  label: 'Inactive'   },
  ]

  // Selection helpers — `selectAllVisible` toggles every *non-admin* row
  // currently on screen. Admins are excluded from selection because every
  // moderation action (warn/suspend/ban/remove) is already gated by
  // `u.role !== 'admin'` server-side and at the row-button level; letting
  // them be selected would just produce "N failed" toasts with no signal
  // about why (the self-actions-invisibly-fail audit item).
  const selectable = useMemo(() => visible.filter(u => u.role !== 'admin'), [visible])
  const allVisibleSelected = selectable.length > 0 && selectable.every(u => selected.has(u.id))
  const toggleOne = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])
  const toggleAllVisible = useCallback(() => {
    setSelected(prev => {
      const next = new Set(prev)
      if (selectable.every(u => next.has(u.id))) {
        for (const u of selectable) next.delete(u.id)
      } else {
        for (const u of selectable) next.add(u.id)
      }
      return next
    })
  }, [selectable])

  return (
    <div className="p-4 sm:p-6 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-white">Users</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          {loading
            ? 'Manage member accounts and roles'
            : searchFiltered.length === users.length
              ? <><span className="text-white font-bold">{users.length}</span> members · Manage accounts and roles</>
              : <><span className="text-white font-bold">{searchFiltered.length}</span> of {users.length} members match filters</>}
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
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortKey)}
          className="shrink-0 px-3 py-2 text-xs font-semibold rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors cursor-pointer"
          title="Sort by"
        >
          <option value="recent">Newest</option>
          <option value="active">Recent active</option>
          <option value="warnings">Most warnings</option>
        </select>
        <button
          onClick={() => {
            const headers = ['Name', 'Email', 'Role', 'Status', 'Warnings', 'Nationality', 'Joined', 'Last Active']
            const rows = visible.map(u => [
              u.name, u.email, u.role,
              isSuspended(u) ? 'suspended' : u.status,
              String(u.warningCount), u.nationality ?? '',
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

      {/* Date-range filter — collapses to its own row under the tabs/search
          on mobile. Both inputs are optional; the joined-date predicate
          short-circuits when both are empty. */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span className="font-semibold">Joined</span>
        <input type="date" value={joinedFrom} onChange={e => setJoinedFrom(e.target.value)}
          className="px-2 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-white focus:outline-none focus:ring-1 focus:ring-amber-500" />
        <span>→</span>
        <input type="date" value={joinedTo} onChange={e => setJoinedTo(e.target.value)}
          className="px-2 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-white focus:outline-none focus:ring-1 focus:ring-amber-500" />
        {(joinedFrom || joinedTo) && (
          <button onClick={() => { setJoinedFrom(''); setJoinedTo('') }} className="text-zinc-500 hover:text-white underline">clear</button>
        )}
      </div>

      {/* Bulk-action bar — only renders when something is checked. Mirrors
          the moderation toolkit on /admin/applications so admins don't need
          to click N×3 buttons to discipline a batch of accounts. */}
      {selected.size > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex flex-wrap items-center gap-2 sticky top-0 z-30">
          <span className="text-sm font-bold text-amber-300">{selected.size} selected</span>
          <span className="flex-1" />
          <button onClick={() => {
            const reason = window.prompt('Warning reason (sent to user, logged):')
            if (reason && reason.trim()) bulkWarn(reason.trim())
          }} disabled={bulkSaving} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 border border-orange-500/30 disabled:opacity-50 transition-colors">
            ⚠ Warn
          </button>
          <button onClick={() => bulkSuspend(7)} disabled={bulkSaving} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 border border-orange-500/30 disabled:opacity-50 transition-colors">
            Suspend 7d
          </button>
          <button onClick={() => {
            const reason = window.prompt('Ban reason:') ?? 'Banned by admin'
            bulkBan(reason)
          }} disabled={bulkSaving} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 disabled:opacity-50 transition-colors">
            Ban
          </button>
          <button onClick={exportSelected} disabled={bulkSaving} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 disabled:opacity-50 transition-colors">
            Export
          </button>
          <button onClick={() => setSelected(new Set())} disabled={bulkSaving} className="px-3 py-1.5 text-xs font-semibold rounded-lg text-zinc-400 hover:text-white disabled:opacity-50 transition-colors">
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
        {/* Desktop header */}
        <div className="hidden md:grid grid-cols-12 gap-3 px-6 py-3 border-b border-zinc-800 text-xs font-bold text-zinc-500 uppercase tracking-wider items-center">
          <div className="col-span-1">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible}
              className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-800 text-amber-500 focus:ring-amber-500 cursor-pointer"
              title="Select all visible" />
          </div>
          <div className="col-span-4">Name</div>
          <div className="col-span-4">Role</div>
          <div className="col-span-3 text-right">Actions</div>
        </div>

        <div className="divide-y divide-zinc-800">
          {/* Skeleton rows — match the real row height so the layout doesn't
              jump when data arrives. Matches the bar pattern on /admin
              (dashboard) and /admin/posts. */}
          {loading && [0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="px-4 sm:px-6 py-3.5 flex items-center gap-3">
              <div className="hidden md:block w-3.5 h-3.5 rounded bg-zinc-800 animate-pulse shrink-0" />
              <div className="w-9 h-9 rounded-full bg-zinc-800 animate-pulse shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="h-3.5 w-32 rounded bg-zinc-800 animate-pulse" />
                <div className="h-3 w-20 rounded bg-zinc-800/60 animate-pulse" />
              </div>
              <div className="hidden md:block h-6 w-24 rounded-full bg-zinc-800 animate-pulse" />
              <div className="h-7 w-20 rounded-lg bg-zinc-800 animate-pulse" />
            </div>
          ))}
          {!loading && visible.length === 0 && <div className="px-6 py-12 text-center text-zinc-500 text-sm">No users found.</div>}
          {visible.map(u => {
            // waLink replaces the earlier dead-code + duplicate of this
            // inline string. The helper applies the +90 prefix only when
            // nationality is Turkish (was unconditional before, which
            // broke non-Turkish users' local-format numbers).
            const waLink = u.phone ? whatsappUrl(u.phone, u.nationality) : null
            const sharedFp = u.lastFingerprint ? (fingerprintCounts.get(u.lastFingerprint) ?? 0) > 1 : false
            const userActions = (
              <div className="flex gap-1.5 items-center">
                <Link href={`/messages/${u.id}`} onClick={e => e.stopPropagation()}
                  className="p-2 rounded-lg text-amber-400 hover:bg-amber-500/10 transition-colors" title="Message in-app">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                </Link>
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
                {u.role !== 'admin' && u.status !== 'banned' && !isSuspended(u) && (
                  <button onClick={() => warnUser(u)} className="p-2 rounded-lg text-orange-400 hover:bg-orange-500/10 transition-colors" title="Warn">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  </button>
                )}
                {u.role !== 'admin' && u.status !== 'banned' && !isSuspended(u) && (
                  <SuspendMenu u={u} onSuspend={suspendUser} onBan={banUser} />
                )}
                {/* Reverse-moderation buttons — only appear on the row that
                    needs them, so the action bar doesn't get heavier for
                    healthy accounts. Replaces a trip to the user detail page. */}
                {isSuspended(u) && (
                  <button onClick={() => unsuspendUser(u)} className="p-2 rounded-lg text-green-400 hover:bg-green-500/10 transition-colors" title="Lift suspension">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  </button>
                )}
                {u.status === 'banned' && (
                  <button onClick={() => unbanUser(u)} className="p-2 rounded-lg text-green-400 hover:bg-green-500/10 transition-colors" title="Unban">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  </button>
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
                {/* Mobile card — info row on top, actions row underneath.
                    Earlier the actions sat to the right of the name and 5-6
                    icons would either crush the name truncation or visually
                    overlap on narrow viewports. Now they get their own row
                    so no element fights another for horizontal space. */}
                <div className="md:hidden px-4 py-3 space-y-2">
                  <div className="flex items-start gap-3">
                    {u.role === 'admin'
                      ? <div className="w-3.5 shrink-0 mt-1" />
                      : <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleOne(u.id)}
                          className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-800 text-amber-500 focus:ring-amber-500 cursor-pointer shrink-0 mt-1" />}
                    <Link href={`/admin/users/${u.id}`} className="shrink-0">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: u.color }}>{getInitials(u.name)}</div>
                    </Link>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link href={`/admin/users/${u.id}`} className="font-semibold text-sm text-white truncate hover:text-amber-400 transition-colors">{u.name}</Link>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize shrink-0 ${roleBadgeClass(u.role)}`}>{u.role}</span>
                      </div>
                      <div className="text-xs text-zinc-500">{new Date(u.joinedAt).toLocaleDateString('en-GB')}</div>
                      {(u.status === 'banned' || isSuspended(u) || u.warningCount > 0 || sharedFp) && (
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {u.status === 'banned' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">banned</span>}
                          {isSuspended(u) && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20" title={`Until ${new Date(u.suspendedUntil!).toLocaleDateString('en-GB')}`}>suspended</span>}
                          {u.warningCount > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">⚠ {u.warningCount} warning{u.warningCount !== 1 ? 's' : ''}</span>}
                          {sharedFp && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20" title={`Shares device fingerprint with ${(fingerprintCounts.get(u.lastFingerprint!) ?? 1) - 1} other account(s)`}>⚠ Same device</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 justify-end -mr-1">{userActions}</div>
                </div>

                {/* Desktop row */}
                <div className="hidden md:grid grid-cols-12 gap-3 px-6 py-3.5 items-center hover:bg-zinc-800/40 transition-colors">
                  <div className="col-span-1">
                    {u.role !== 'admin' && (
                      <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleOne(u.id)}
                        className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-800 text-amber-500 focus:ring-amber-500 cursor-pointer" />
                    )}
                  </div>
                  <Link href={`/admin/users/${u.id}`} className="col-span-4 flex items-center gap-3 min-w-0 group">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: u.color }}>{getInitials(u.name)}</div>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-white truncate group-hover:text-amber-400 transition-colors flex items-center gap-1.5">
                        {u.name}
                        {sharedFp && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20" title={`Shares device fingerprint with ${(fingerprintCounts.get(u.lastFingerprint!) ?? 1) - 1} other account(s)`}>⚠ Same device</span>}
                      </div>
                      <div className="text-xs text-zinc-500 flex items-center gap-2 flex-wrap">
                        <span>Joined {new Date(u.joinedAt).toLocaleDateString('en-GB')}</span>
                        {u.lastActive && <span className="text-zinc-600">· Active {new Date(u.lastActive).toLocaleDateString('en-GB')}</span>}
                        {u.warningCount > 0 && <span className="text-orange-400 font-semibold">⚠ {u.warningCount}</span>}
                      </div>
                    </div>
                  </Link>
                  <div className="col-span-4">
                    {u.role === 'admin' ? (
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${roleBadgeClass(u.role)}`}>{u.role}</span>
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
          <div className="px-6 py-3 border-t border-zinc-800 bg-zinc-800/50 text-xs text-zinc-500 flex items-center justify-between gap-3 flex-wrap">
            <span>Showing {visible.length} of {users.length} users</span>
            {refreshLabel && <span className="text-zinc-600">{refreshLabel}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
