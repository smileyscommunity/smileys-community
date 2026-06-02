'use client'

import { useState, useEffect, useMemo, Fragment, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { useAdminLoad } from '@/lib/admin/useAdminLoad'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'

interface Payment {
  id: string
  amount: number
  currency: string
  status: string
  method: string
  notes: string | null
  createdAt: string
  user: { name: string; email: string }
  event: { title: string; emoji: string }
}

interface PaymentLog {
  id: string
  adminName: string
  fromStatus: string | null
  toStatus: string | null
  note: string | null
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  paid:     'bg-green-500/10 text-green-400 border border-green-500/20',
  pending:  'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  refunded: 'bg-blue-500/10  text-blue-400  border border-blue-500/20',
  failed:   'bg-red-500/10   text-red-400   border border-red-500/20',
}

// Refunded is intentionally absent — terminal state. Previously
// the cycle `refunded → pending → paid` let a stray double-click
// undo a refund after the member had already received the email.
// Server now rejects transitions out of refunded with 409; UI
// hides the button so admins can't try.
const STATUS_NEXT: Record<string, string> = {
  pending: 'paid',
  paid:    'refunded',
  failed:  'pending',
}

const STATUS_ACTION: Record<string, string> = {
  pending: 'Mark as paid',
  paid:    'Mark refunded',
  failed:  'Mark pending',
}

type FilterKey = 'all' | 'paid' | 'pending' | 'refunded' | 'failed'
const FILTER_KEYS: readonly FilterKey[] = ['all', 'paid', 'pending', 'refunded', 'failed'] as const

// Suspense wrapper because useSearchParams forces it. Mirrors the
// pattern on /admin/events — the URL-sync filters need useSearchParams,
// which can't run during static rendering.
export default function AdminPaymentsPage() {
  return <Suspense><AdminPaymentsPageInner /></Suspense>
}

function AdminPaymentsPageInner() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()

  // Hydrate every filter from the URL so reload + deep links land on
  // the same view. Whitelist the filter against FILTER_KEYS so a
  // junk query string can't leave the chip bar with no button looking
  // selected.
  const initialFilter = (FILTER_KEYS as readonly string[]).includes(searchParams.get('filter') ?? '')
    ? (searchParams.get('filter') as FilterKey) : 'all'
  const initialSearch = searchParams.get('search') ?? ''

  // Shared admin-load hook gives r.ok + retry banner + cancellation
  // for free. Was using an unguarded fetch that treated 401/403/500
  // as "no payments" — admin couldn't tell the difference between
  // a real empty list and a failed load.
  const { data, loading, error: loadError, retry, setData } = useAdminLoad<Payment[]>(
    '/app/api/admin/payments',
    (v): v is Payment[] => Array.isArray(v),
  )
  const payments = data ?? []
  // Bridge function-form mutations (setPayments(prev => ...)) to the
  // hook's value-only setData escape hatch.
  const setPayments = (next: Payment[] | ((prev: Payment[]) => Payment[])) => {
    setData(typeof next === 'function' ? next(data ?? []) : next)
  }

  const [filter,        setFilter]        = useState<FilterKey>(initialFilter)
  const [search,        setSearch]        = useState(initialSearch)
  const [editNotes,     setEditNotes]     = useState<{ id: string; value: string } | null>(null)
  const [busy,          setBusy]          = useState<string | null>(null)
  const [expandedLog,   setExpandedLog]   = useState<string | null>(null)
  const [logs,          setLogs]          = useState<Record<string, PaymentLog[]>>({})
  const [refundConfirm, setRefundConfirm] = useState<Payment | null>(null)
  const [refundNote,    setRefundNote]    = useState('')

  // Debounce search so typing doesn't spam history.
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])

  // URL-sync filter + search. Replace (not push) so back-button
  // doesn't dump intermediate states. searchParams excluded from
  // deps to avoid feedback loop on the URL we just wrote.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (filter !== 'all')   params.set('filter', filter);          else params.delete('filter')
    if (debouncedSearch)    params.set('search', debouncedSearch); else params.delete('search')
    const q = params.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, debouncedSearch, pathname, router])

  async function toggleLog(id: string) {
    if (expandedLog === id) { setExpandedLog(null); return }
    setExpandedLog(id)
    if (!logs[id]) {
      const data = await fetch(`/app/api/admin/payments/${id}/logs`, { credentials: 'include' }).then(r => r.ok ? r.json() : [])
      setLogs(prev => ({ ...prev, [id]: Array.isArray(data) ? data : [] }))
    }
  }

  async function updateStatus(p: Payment, overrideNote?: string) {
    // STATUS_NEXT now omits terminal states — guard at the
    // call-site so we don't fire a doomed request that the server
    // would reject with 409 anyway.
    const next = STATUS_NEXT[p.status]
    if (!next) { toast.error(`Cannot change status from ${p.status}`); return }
    setBusy(p.id)
    const res = await fetch('/app/api/admin/payments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id: p.id, status: next, notes: overrideNote }),
    })
    if (res.ok) {
      const updated = await res.json()
      // Server returns `_refundEmail.sent` on refund requests so we
      // can split the toast — was "Status → refunded" regardless of
      // whether the email actually landed, which led admins to
      // assume SMTP was healthy when it wasn't. Strip the sidecar
      // field before storing the row.
      const refundEmail = updated?._refundEmail as { sent: boolean } | undefined
      const cleaned: Payment = { ...updated }
      delete (cleaned as { _refundEmail?: unknown })._refundEmail
      setPayments(prev => prev.map(x => x.id === p.id ? cleaned : x))
      // Drop the cached log entirely (was setting to []; an
      // empty array is truthy, so the toggleLog `!logs[id]` check
      // would skip the refetch and admins would see a stale
      // "no changes" view even though a fresh log just landed).
      setLogs(prev => { const n = { ...prev }; delete n[p.id]; return n })
      if (expandedLog === p.id) {
        const fresh = await fetch(`/app/api/admin/payments/${p.id}/logs`, { credentials: 'include' }).then(r => r.ok ? r.json() : [])
        setLogs(prev => ({ ...prev, [p.id]: Array.isArray(fresh) ? fresh : [] }))
      }
      if (refundEmail) {
        refundEmail.sent
          ? toast.success('Refund processed — confirmation email sent')
          : toast.error('Refund processed, but email failed to send. Notify the member manually.')
      } else {
        toast.success(`Status → ${next}`)
      }
    } else {
      // Surface 400 / 409 reasons (terminal-state guard, invalid
      // status, notes too long) instead of silently doing nothing.
      const err = await res.json().catch(() => ({}))
      toast.error(err?.error ?? 'Update failed')
    }
    setBusy(null)
    setRefundConfirm(null)
    setRefundNote('')
  }

  function handleStatusClick(p: Payment) {
    if (p.status === 'paid') {
      // Refund needs confirmation + note
      setRefundConfirm(p)
      setRefundNote('')
    } else {
      updateStatus(p)
    }
  }

  async function saveNotes(id: string, notes: string) {
    setBusy(id)
    const res = await fetch('/app/api/admin/payments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id, notes }),
    })
    if (res.ok) {
      const updated = await res.json()
      setPayments(prev => prev.map(x => x.id === id ? updated : x))
      // Same cache-drop as updateStatus — notes edits also write
      // a PaymentLog row now, so any expanded log view needs the
      // fresh entry on next open.
      setLogs(prev => { const n = { ...prev }; delete n[id]; return n })
      toast.success('Notes saved')
    } else {
      const err = await res.json().catch(() => ({}))
      toast.error(err?.error ?? 'Save failed')
    }
    setEditNotes(null)
    setBusy(null)
  }

  async function deletePayment(id: string) {
    if (!confirm('Delete this payment record?\n\nThis writes a snapshot to the audit log before deleting — the action is logged and visible to other admins.')) return
    setBusy(id)
    const res = await fetch('/app/api/admin/payments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      setPayments(prev => prev.filter(x => x.id !== id))
      toast.success('Deleted (audit logged)')
    } else {
      const err = await res.json().catch(() => ({}))
      toast.error(err?.error ?? 'Delete failed')
    }
    setBusy(null)
  }

  // Search across the fields admin most often hunts by — member
  // name + email + event title. Case-insensitive substring match,
  // applied after status filter so the counts in the summary cards
  // and chips stay anchored to the unfiltered totals.
  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    return payments.filter(p => {
      if (filter !== 'all' && p.status !== filter) return false
      if (q && !p.user.name.toLowerCase().includes(q)
            && !p.user.email.toLowerCase().includes(q)
            && !p.event.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [payments, filter, debouncedSearch])
  const totalPaid = payments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
  const pending   = payments.filter(p => p.status === 'pending').length

  // Group paid payments by event
  const byEvent = payments
    .filter(p => p.status === 'paid')
    .reduce<Record<string, { title: string; emoji: string; total: number; count: number }>>(
      (acc, p) => {
        const key = p.event.title
        if (!acc[key]) acc[key] = { title: p.event.title, emoji: p.event.emoji, total: 0, count: 0 }
        acc[key].total += p.amount
        acc[key].count++
        return acc
      }, {}
    )
  const byEventList = Object.values(byEvent).sort((a, b) => b.total - a.total)

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">Payments</h1>
        <p className="text-sm text-zinc-500 mt-0.5">{payments.length} total records</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Collected', value: `₺${totalPaid.toLocaleString()}`, color: 'text-green-400' },
          { label: 'Pending',         value: pending,                           color: 'text-amber-400' },
          { label: 'Transactions',    value: payments.length,                   color: 'text-white'     },
        ].map(s => (
          <div key={s.label} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-zinc-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Revenue by event */}
      {byEventList.length > 0 && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
          <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">Revenue by event</div>
          <div className="space-y-2.5">
            {byEventList.map(e => {
              const max = byEventList[0].total
              return (
                <div key={e.title}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-zinc-300 font-medium truncate max-w-[60%]">{e.emoji} {e.title}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-zinc-500">{e.count} txn</span>
                      <span className="text-xs font-bold text-green-400">₺{e.total.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full" style={{ width: `${(e.total / max) * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Load-error banner — replaces the silent 401/403/500 "no
          payments" fallthrough. Retry refires the underlying hook. */}
      <LoadErrorBanner message={loadError} onRetry={retry} title="Couldn't load payments" />

      <div className="flex flex-wrap gap-2">
        <div className="flex gap-1 bg-zinc-900 rounded-xl p-1 w-fit">
          {FILTER_KEYS.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold capitalize transition-colors ${filter === f ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'}`}>
              {f}
            </button>
          ))}
        </div>
        {/* Search across member name/email + event title — was no
            way to find "the payment from X" without scrolling. */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder="Search member, email, event…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-8 py-2 text-xs rounded-xl bg-zinc-900 border border-zinc-800 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500" />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-white" title="Clear search">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        // Page-shape skeleton — three summary cards + a few rows
        // matching the eventual table layout so the page doesn't
        // jump when data lands.
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[0, 1, 2].map(i => (
              <div key={i} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 space-y-2">
                <div className="h-6 w-24 rounded bg-zinc-800 animate-pulse" />
                <div className="h-3 w-20 rounded bg-zinc-800/60 animate-pulse" />
              </div>
            ))}
          </div>
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 divide-y divide-zinc-800">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="px-4 py-4 flex items-center gap-4">
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-1/3 rounded bg-zinc-800 animate-pulse" />
                  <div className="h-3 w-1/4 rounded bg-zinc-800/60 animate-pulse" />
                </div>
                <div className="h-4 w-16 rounded bg-zinc-800 animate-pulse" />
                <div className="h-6 w-20 rounded-full bg-zinc-800 animate-pulse" />
                <div className="h-7 w-24 rounded-lg bg-zinc-800 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-zinc-900 rounded-2xl p-10 text-center">
          <div className="text-3xl mb-2">💳</div>
          <p className="text-zinc-400 text-sm">No payments.</p>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800">

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-zinc-800">
            {filtered.map(p => (
              <div key={p.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{p.user.name}</div>
                    <div className="text-xs text-zinc-500 truncate">{p.user.email}</div>
                    <div className="text-xs text-zinc-400 mt-0.5">{p.event.emoji} {p.event.title}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-base font-bold text-white">₺{p.amount.toLocaleString()}</div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLORS[p.status] ?? 'bg-zinc-800 text-zinc-400'}`}>
                      {p.status}
                    </span>
                  </div>
                </div>

                {/* Notes */}
                {editNotes?.id === p.id ? (
                  <div className="flex gap-1">
                    <input autoFocus value={editNotes.value}
                      onChange={e => setEditNotes({ id: p.id, value: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') saveNotes(p.id, editNotes.value); if (e.key === 'Escape') setEditNotes(null) }}
                      className="bg-zinc-800 text-white text-xs rounded-lg px-2 py-1.5 w-full border border-zinc-600 outline-none"
                      placeholder="Add note…" />
                    <button onClick={() => saveNotes(p.id, editNotes.value)} className="text-xs text-green-400 hover:text-green-300 shrink-0 px-1">✓</button>
                  </div>
                ) : (
                  <button onClick={() => setEditNotes({ id: p.id, value: p.notes ?? '' })}
                    className="text-xs text-zinc-500 hover:text-white transition-colors text-left w-full">
                    {p.notes || <span className="italic text-zinc-600">Add note…</span>}
                  </button>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-600">{new Date(p.createdAt).toLocaleDateString()}</span>
                  <div className="flex gap-1.5">
                    {/* Status-change button hidden for terminal
                        states (refunded) — STATUS_NEXT omits them
                        on purpose; server returns 409 too. */}
                    {STATUS_NEXT[p.status] && (
                      <button onClick={() => handleStatusClick(p)} disabled={busy === p.id}
                        className={`text-xs px-3 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 ${
                          p.status === 'pending' ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                          : p.status === 'paid'  ? 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
                          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                        }`}>
                        {busy === p.id ? '…' : STATUS_ACTION[p.status]}
                      </button>
                    )}
                    <button onClick={() => toggleLog(p.id)}
                      className={`text-xs px-2.5 py-2 rounded-lg transition-colors ${expandedLog === p.id ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white hover:bg-zinc-800'}`}>
                      log
                    </button>
                    <button onClick={() => deletePayment(p.id)} disabled={busy === p.id}
                      className="text-xs px-2.5 py-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50">
                      ✕
                    </button>
                  </div>
                </div>

                {expandedLog === p.id && (
                  <div className="bg-zinc-800/50 rounded-xl px-3 py-2.5 space-y-1.5">
                    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Audit log</p>
                    {!logs[p.id] ? <p className="text-zinc-500 text-xs">Loading…</p>
                    : logs[p.id].length === 0 ? <p className="text-zinc-600 text-xs italic">No changes yet.</p>
                    : logs[p.id].map(log => (
                      <div key={log.id} className="text-xs text-zinc-400 flex flex-wrap gap-1 items-center">
                        <span className="text-zinc-600">{new Date(log.createdAt).toLocaleString()}</span>
                        <span className="text-zinc-500">· {log.adminName}</span>
                        <span className={`px-1.5 py-0.5 rounded font-semibold ${STATUS_COLORS[log.fromStatus ?? ''] ?? 'bg-zinc-700 text-zinc-400'}`}>{log.fromStatus ?? '—'}</span>
                        <span className="text-zinc-600">→</span>
                        <span className={`px-1.5 py-0.5 rounded font-semibold ${STATUS_COLORS[log.toStatus ?? ''] ?? 'bg-zinc-700 text-zinc-400'}`}>{log.toStatus ?? '—'}</span>
                        {log.note && <span className="italic text-zinc-500">"{log.note}"</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-800">
                <tr className="text-xs text-zinc-500 uppercase tracking-wider">
                  {['Member', 'Event', 'Amount', 'Status', 'Notes', 'Date', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {filtered.map(p => (
                  // Fragment was un-keyed (`<>`) which React warns
                  // about under StrictMode and silently breaks the
                  // reconciler's reuse of these two rows. Each map
                  // iteration now yields a keyed Fragment wrapping
                  // the data row + the expanded-log row.
                  <Fragment key={p.id}>
                    <tr className="hover:bg-zinc-800/40 transition-colors">
                      <td className="px-4 py-3">
                        <div className="text-white font-medium">{p.user.name}</div>
                        <div className="text-zinc-500 text-xs">{p.user.email}</div>
                      </td>
                      <td className="px-4 py-3 text-zinc-300">{p.event.emoji} {p.event.title}</td>
                      <td className="px-4 py-3 text-white font-bold">₺{p.amount.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${STATUS_COLORS[p.status] ?? 'bg-zinc-800 text-zinc-400'}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[160px]">
                        {editNotes?.id === p.id ? (
                          <div className="flex gap-1">
                            <input autoFocus value={editNotes.value}
                              onChange={e => setEditNotes({ id: p.id, value: e.target.value })}
                              onKeyDown={e => { if (e.key === 'Enter') saveNotes(p.id, editNotes.value); if (e.key === 'Escape') setEditNotes(null) }}
                              className="bg-zinc-800 text-white text-xs rounded px-2 py-1 w-full border border-zinc-600 outline-none"
                              placeholder="Add note…" />
                            <button onClick={() => saveNotes(p.id, editNotes.value)} className="text-xs text-green-400 hover:text-green-300 shrink-0">✓</button>
                          </div>
                        ) : (
                          <button onClick={() => setEditNotes({ id: p.id, value: p.notes ?? '' })}
                            className="text-xs text-zinc-400 hover:text-white transition-colors text-left truncate max-w-full block">
                            {p.notes || <span className="text-zinc-600 italic">Add note…</span>}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-500 text-xs whitespace-nowrap">
                        <div>{new Date(p.createdAt).toLocaleDateString()}</div>
                        <div className="text-zinc-600">{new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {/* Same terminal-state hide as mobile. */}
                          {STATUS_NEXT[p.status] && (
                            <button onClick={() => handleStatusClick(p)} disabled={busy === p.id}
                              className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors disabled:opacity-50 ${
                                p.status === 'pending' ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                                : p.status === 'paid'  ? 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
                                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                              }`}>
                              {busy === p.id ? '…' : STATUS_ACTION[p.status]}
                            </button>
                          )}
                          <button onClick={() => toggleLog(p.id)}
                            className={`text-xs px-2 py-1 rounded-lg transition-colors ${expandedLog === p.id ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white hover:bg-zinc-800'}`}
                            title="View audit log">
                            log
                          </button>
                          <button onClick={() => deletePayment(p.id)} disabled={busy === p.id}
                            className="text-xs px-2 py-1 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                            title="Delete record">
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedLog === p.id && (
                      <tr className="bg-zinc-800/30">
                        <td colSpan={7} className="px-6 py-3">
                          {!logs[p.id] ? (
                            <p className="text-zinc-500 text-xs">Loading…</p>
                          ) : logs[p.id].length === 0 ? (
                            <p className="text-zinc-600 text-xs italic">No status changes recorded yet.</p>
                          ) : (
                            <div className="space-y-1.5">
                              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Audit log</p>
                              {logs[p.id].map(log => (
                                <div key={log.id} className="flex items-center gap-2 text-xs text-zinc-400">
                                  <span className="text-zinc-600">{new Date(log.createdAt).toLocaleString()}</span>
                                  <span className="text-zinc-500">·</span>
                                  <span className="font-medium text-zinc-300">{log.adminName}</span>
                                  <span className="text-zinc-500">changed</span>
                                  <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${STATUS_COLORS[log.fromStatus ?? ''] ?? 'bg-zinc-700 text-zinc-400'}`}>{log.fromStatus ?? '—'}</span>
                                  <span className="text-zinc-600">→</span>
                                  <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${STATUS_COLORS[log.toStatus ?? ''] ?? 'bg-zinc-700 text-zinc-400'}`}>{log.toStatus ?? '—'}</span>
                                  {log.note && <span className="text-zinc-500 italic">"{log.note}"</span>}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Refund confirmation modal */}
      {refundConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => { setRefundConfirm(null); setRefundNote('') }}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md space-y-4"
            onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-white font-bold text-lg">Confirm refund</h3>
              <p className="text-zinc-400 text-sm mt-1">
                Refund <span className="text-white font-semibold">₺{refundConfirm.amount.toLocaleString()}</span> to{' '}
                <span className="text-white font-semibold">{refundConfirm.user.name}</span> for{' '}
                <span className="text-white">{refundConfirm.event.emoji} {refundConfirm.event.title}</span>?
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Reason for refund (required — sent to member)</label>
              <textarea
                autoFocus
                rows={3}
                value={refundNote}
                onChange={e => setRefundNote(e.target.value)}
                placeholder="e.g. Event was cancelled, duplicate payment, etc."
                className="w-full px-3 py-2.5 text-sm bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setRefundConfirm(null); setRefundNote('') }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors">
                Cancel
              </button>
              <button
                onClick={() => updateStatus(refundConfirm, refundNote || undefined)}
                disabled={!refundNote.trim() || busy === refundConfirm.id}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-blue-500 hover:bg-blue-600 text-white transition-colors disabled:opacity-40">
                {busy === refundConfirm.id ? 'Processing…' : 'Confirm refund'}
              </button>
            </div>
            <p className="text-xs text-zinc-600 text-center">A refund confirmation email will be sent to {refundConfirm.user.email}</p>
          </div>
        </div>
      )}
    </div>
  )
}
