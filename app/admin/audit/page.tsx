'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'

// Map an audit entry's targetType to the admin detail route for that
// resource. Returning null means the target has no admin landing page
// (payments, messages, reports, attendees) and the id stays as plain
// text. Centralised here so a new targetType only edits one place.
function targetHref(targetType: string | null, targetId: string | null): string | null {
  if (!targetType || !targetId) return null
  if (targetType === 'user')  return `/admin/users/${targetId}`
  if (targetType === 'event') return `/admin/events/${targetId}/edit`
  if (targetType === 'club')  return `/admin/clubs/${targetId}`
  return null
}

interface AuditEntry {
  id: string
  adminName: string
  action: string
  description: string | null
  targetId: string | null
  targetType: string | null
  meta: Record<string, unknown> | null
  createdAt: string
}

const ACTION_STYLES: Record<string, string> = {
  'user.ban':              'bg-red-500/10 text-red-400 border-red-500/20',
  'user.remove':           'bg-red-500/10 text-red-400 border-red-500/20',
  'user.warn':             'bg-orange-500/10 text-orange-400 border-orange-500/20',
  'user.role_change':      'bg-violet-500/10 text-violet-400 border-violet-500/20',
  'user.status_change':    'bg-amber-500/10 text-amber-400 border-amber-500/20',
  'user.update':           'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'payment.status':        'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'application.approve':   'bg-green-500/10 text-green-400 border-green-500/20',
  'application.reject':    'bg-red-500/10 text-red-400 border-red-500/20',
  'application.escalate':  'bg-violet-500/10 text-violet-400 border-violet-500/20',
  'report.escalate':       'bg-violet-500/10 text-violet-400 border-violet-500/20',
  'report.dismiss':        'bg-zinc-700 text-zinc-400 border-zinc-600',
  'message.delete':        'bg-orange-500/10 text-orange-400 border-orange-500/20',
  'event.published':       'bg-green-500/10 text-green-400 border-green-500/20',
  'event.flagged':         'bg-red-500/10 text-red-400 border-red-500/20',
  'event.unpublished':     'bg-zinc-700 text-zinc-400 border-zinc-600',
  'event.update':          'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'club.update':           'bg-blue-500/10 text-blue-400 border-blue-500/20',
}

const ACTION_LABELS: Record<string, string> = {
  'user.ban':              'Ban',
  'user.remove':           'Remove',
  'user.warn':             'Warn',
  'user.role_change':      'Role change',
  'user.status_change':    'Status change',
  'user.update':           'Update',
  'payment.status':        'Payment',
  'application.approve':   'Approve',
  'application.reject':    'Reject',
  'application.escalate':  'Escalate',
  'report.escalate':       'Escalate',
  'report.dismiss':        'Dismiss',
  'message.delete':        'Delete msg',
  'event.published':       'Publish',
  'event.flagged':         'Flag',
  'event.unpublished':     'Unpublish',
  'event.update':          'Update',
  'club.update':           'Update',
}

// The action suffix tells you which field a flat-shape diff (top-level
// `meta.from` / `meta.to`) is about — e.g. `user.role_change` → "role",
// `payment.status` → "status". Falls back to the whole action when the
// shape is unfamiliar.
function flatDiffLabel(action: string): string {
  if (action.endsWith('.role_change'))   return 'role'
  if (action.endsWith('.status_change')) return 'status'
  if (action.endsWith('.status'))        return 'status'
  return action
}

function DiffView({ meta, action }: { meta: Record<string, unknown> | null; action: string }) {
  if (!meta) return null

  // Shape A — nested under meta.diff (clubs, events): a map of
  // field → { from, to }. Render every field on its own row.
  if (meta.diff && typeof meta.diff === 'object' && !Array.isArray(meta.diff)) {
    const entries = Object.entries(meta.diff as Record<string, { from: any; to: any }>)
    if (entries.length) {
      return (
        <div className="mt-1.5 space-y-0.5">
          {entries.map(([key, val]) => (
            <div key={key} className="flex items-center gap-2 text-xs">
              <span className="text-zinc-500 font-medium">{key}:</span>
              <span className="text-red-400 line-through decoration-red-400/50">{String(val.from ?? 'null')}</span>
              <span className="text-zinc-600">→</span>
              <span className="text-green-400 font-medium">{String(val.to ?? 'null')}</span>
            </div>
          ))}
        </div>
      )
    }
  }

  // Shape B — flat `{ from, to }` at meta top level (role_change,
  // status_change, payment.status). Render as a single-row diff using a
  // label derived from the action. Previously these entries got no
  // visual diff at all — the prose description was the only signal.
  if ('from' in meta && 'to' in meta) {
    return (
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        <span className="text-zinc-500 font-medium">{flatDiffLabel(action)}:</span>
        <span className="text-red-400 line-through decoration-red-400/50">{String(meta.from ?? 'null')}</span>
        <span className="text-zinc-600">→</span>
        <span className="text-green-400 font-medium">{String(meta.to ?? 'null')}</span>
      </div>
    )
  }
  return null
}

// Fallback for entries created before description field was added
function legacySummary(action: string, meta: Record<string, unknown> | null): string {
  if (!meta) return ''
  if (action === 'user.ban' || action === 'user.warn') return (meta.note ?? meta.reason ?? '') as string
  if (action === 'user.remove') return `${meta.name ?? ''} <${meta.email ?? ''}>`.trim()
  if (action === 'payment.status') return `${meta.from ?? '?'} → ${meta.to ?? '?'}`
  if (action === 'user.role_change') return `${meta.from ?? '?'} → ${meta.to ?? '?'}`
  return ''
}

const FILTER_GROUPS = [
  { key: '',                    label: 'All'          },
  { key: 'user.role_change',    label: 'Role changes' },
  { key: 'user.ban',            label: 'Bans'         },
  { key: 'user.warn',           label: 'Warnings'     },
  { key: 'user.remove',         label: 'Removes'      },
  { key: 'application',         label: 'Applications' },
  { key: 'report',              label: 'Reports'      },
  { key: 'payment.status',      label: 'Payments'     },
  { key: 'message.delete',      label: 'Messages'     },
  { key: 'event',               label: 'Events'       },
]

// Server caps `take` at 200; we keep page size below that so the
// "hasMore" inference (returned === PAGE_SIZE) actually triggers.
const PAGE_SIZE = 100

const FILTER_KEYS = new Set(FILTER_GROUPS.map(f => f.key))

export default function AdminAuditPage() {
  return <Suspense><AdminAuditPageInner /></Suspense>
}

function AdminAuditPageInner() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()

  // Hydrate every filter from the URL so reload + deep links land on
  // the same view. Whitelist the action filter against the known chip
  // keys to keep junk query strings from putting the chip bar into a
  // state where no button looks selected.
  const initialFilter = FILTER_KEYS.has(searchParams.get('filter') ?? '') ? (searchParams.get('filter') ?? '') : ''
  const initialSearch = searchParams.get('search') ?? ''
  const initialFrom   = searchParams.get('from')   ?? ''
  const initialTo     = searchParams.get('to')     ?? ''

  const [logs,        setLogs]        = useState<AuditEntry[]>([])
  const [loading,     setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore,     setHasMore]     = useState(false)
  const [filter,      setFilter]      = useState(initialFilter)
  const [search,      setSearch]      = useState(initialSearch)
  const [fromDate,    setFromDate]    = useState(initialFrom)
  const [toDate,      setToDate]      = useState(initialTo)
  // Debounced version of `search` — keeps typing from spamming the API.
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch.trim())

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  // URL-sync filter + search + date range so reload preserves the view
  // and admins can share a deep link (e.g. "?filter=user.ban&from=…").
  // Debounced via debouncedSearch so we don't push intermediate URLs on
  // every keystroke. Replace (not push) keeps the back button useful.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (filter)          params.set('filter', filter);          else params.delete('filter')
    if (debouncedSearch) params.set('search', debouncedSearch); else params.delete('search')
    if (fromDate)        params.set('from',   fromDate);        else params.delete('from')
    if (toDate)          params.set('to',     toDate);          else params.delete('to')
    const q = params.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  // searchParams excluded — including it would re-fire on every URL
  // change we just made and loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, debouncedSearch, fromDate, toDate, pathname, router])

  // Build the query string for both initial and load-more fetches. The
  // only difference between them is the `before` cursor.
  function buildQs(before?: string) {
    const qs = new URLSearchParams({ take: String(PAGE_SIZE) })
    if (filter)          qs.set('action', filter)
    if (debouncedSearch) qs.set('search', debouncedSearch)
    if (fromDate)        qs.set('from',   fromDate)
    // `to` is a yyyy-mm-dd; the server compares to createdAt which is a
    // datetime, so push it to end-of-day so an entry created at 23:00
    // still falls inside "today".
    if (toDate)          qs.set('to',     `${toDate}T23:59:59.999`)
    if (before)          qs.set('before', before)
    return qs.toString()
  }

  // Re-fetch from scratch whenever any filter changes. Resets the list
  // (this is a new query, not a continuation) and recomputes hasMore.
  useEffect(() => {
    setLoading(true)
    fetch(`/app/api/admin/audit?${buildQs()}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((d: AuditEntry[]) => {
        const data = Array.isArray(d) ? d : []
        setLogs(data)
        setHasMore(data.length === PAGE_SIZE)
      })
      .finally(() => setLoading(false))
  // buildQs depends on every filter via closure, so rebuilding it
  // doesn't need to be a dep — listing the fields is enough.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, debouncedSearch, fromDate, toDate])

  async function loadMore() {
    if (!hasMore || loadingMore || logs.length === 0) return
    const cursor = logs[logs.length - 1].createdAt
    setLoadingMore(true)
    try {
      const res = await fetch(`/app/api/admin/audit?${buildQs(cursor)}`, { credentials: 'include' })
      const d   = res.ok ? await res.json() : []
      const data: AuditEntry[] = Array.isArray(d) ? d : []
      setLogs(prev => [...prev, ...data])
      setHasMore(data.length === PAGE_SIZE)
    } finally {
      setLoadingMore(false)
    }
  }

  // Shared formatter — yyyy-mm-dd in local time, the shape the <input
  // type="date"> elements expect.
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  // "Today" means start-of-today → now, NOT the rolling last-24h window
  // the old `applyPreset(1)` produced. Clicking it at 14:00 should show
  // actions taken since midnight, not actions since yesterday-at-14:00.
  function applyToday() {
    const t = fmt(new Date())
    setFromDate(t); setToDate(t)
  }

  // Rolling lookback — fromDate = N days before today (inclusive),
  // toDate = today. The server pushes `to` to end-of-day.
  function applyLookback(days: number) {
    const t = new Date()
    const f = new Date(); f.setDate(f.getDate() - days)
    setFromDate(fmt(f)); setToDate(fmt(t))
  }

  const visible = logs

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">Audit Log</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          All sensitive admin actions — showing {logs.length}
          {hasMore && ' (more available)'}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex gap-1 bg-zinc-900 rounded-xl p-1 w-fit border border-zinc-800 flex-wrap">
          {FILTER_GROUPS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${filter === f.key ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search admin, description, target id…"
            className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500" />
        </div>
      </div>

      {/* Date range — quick presets + two open inputs. Same shape the
          users page uses. Date range is server-applied so combining it
          with a filter chip or search narrows accurately even when the
          last incident was months ago. */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span className="font-semibold">When</span>
        <button onClick={applyToday}            className="px-2 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors">Today</button>
        <button onClick={() => applyLookback(7)}  className="px-2 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors">7d</button>
        <button onClick={() => applyLookback(30)} className="px-2 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors">30d</button>
        <button onClick={() => applyLookback(90)} className="px-2 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors">90d</button>
        <span className="text-zinc-700">|</span>
        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
          className="px-2 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-white focus:outline-none focus:ring-1 focus:ring-amber-500" />
        <span>→</span>
        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
          className="px-2 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-white focus:outline-none focus:ring-1 focus:ring-amber-500" />
        {(fromDate || toDate) && (
          <button onClick={() => { setFromDate(''); setToDate('') }} className="text-zinc-500 hover:text-white underline">clear</button>
        )}
      </div>

      {loading ? (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          <div className="divide-y divide-zinc-800">
            {/* Skeleton rows mirror the real row layout so nothing
                jumps when data arrives. Matches the bar pattern on
                /admin/users + /admin/moderation. */}
            {[0, 1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="flex items-start gap-3 px-5 py-3.5">
                <div className="h-5 w-16 rounded-full bg-zinc-800 animate-pulse shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="h-3.5 w-32 rounded bg-zinc-800 animate-pulse" />
                  <div className="h-3 w-2/3 rounded bg-zinc-800/60 animate-pulse" />
                </div>
                <div className="h-3 w-16 rounded bg-zinc-800/60 animate-pulse shrink-0 mt-1" />
              </div>
            ))}
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-10 text-center">
          <div className="text-3xl mb-2">🗒</div>
          <p className="text-zinc-400 text-sm">No audit entries yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          <div className="divide-y divide-zinc-800">
            {/* Day grouping: insert a date divider when the calendar
                day changes between adjacent (sorted-desc) entries.
                "Today" / "Yesterday" labels at the top for quick
                scanning; older days show full date. */}
            {visible.map((log, i) => {
              const style   = ACTION_STYLES[log.action] ?? 'bg-zinc-700 text-zinc-400 border-zinc-600'
              const label   = ACTION_LABELS[log.action] ?? log.action
              const summary = log.description || legacySummary(log.action, log.meta)
              const day     = new Date(log.createdAt).toDateString()
              const prevDay = i > 0 ? new Date(visible[i - 1].createdAt).toDateString() : null
              const showDivider = day !== prevDay

              // Human-friendly day label. toDateString gives stable
              // identity for the comparison above; this label is just
              // for display.
              let dayLabel = day
              const today = new Date().toDateString()
              const y     = new Date(); y.setDate(y.getDate() - 1)
              const yesterday = y.toDateString()
              if (day === today)     dayLabel = 'Today'
              else if (day === yesterday) dayLabel = 'Yesterday'
              else dayLabel = new Date(log.createdAt).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })

              return (
                <div key={log.id}>
                  {showDivider && (
                    <div className="bg-zinc-950/60 px-5 py-1.5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                      {dayLabel}
                    </div>
                  )}
                  <div className="flex items-start gap-3 px-5 py-3.5 hover:bg-zinc-800/40 transition-colors">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border shrink-0 mt-0.5 ${style}`}>
                      {label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-sm font-semibold text-white">{log.adminName}</span>
                      </div>
                      {summary ? (
                        <p className="text-xs text-zinc-300 leading-snug">{summary}</p>
                      ) : (
                        <p className="text-xs text-zinc-600 font-mono">{log.action}</p>
                      )}

                      <DiffView meta={log.meta} action={log.action} />
                      {log.targetId && (() => {
                        const href = targetHref(log.targetType, log.targetId)
                        const text = `${log.targetType} · ${log.targetId}`
                        // Click through to the resource's admin page when
                        // one exists (user / event / club). Other target
                        // types fall back to plain text — no detail
                        // route to navigate to.
                        return href ? (
                          <Link href={href} className="text-xs text-zinc-600 hover:text-amber-400 font-mono mt-0.5 inline-block transition-colors">
                            {text} →
                          </Link>
                        ) : (
                          <div className="text-xs text-zinc-600 font-mono mt-0.5">{text}</div>
                        )
                      })()}
                    </div>
                    {/* Day divider now carries the date — row shows
                        just time so the eye doesn't read the date twice. */}
                    <div className="text-xs text-zinc-600 whitespace-nowrap shrink-0 mt-0.5">
                      {new Date(log.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        {hasMore && (
          <button onClick={loadMore} disabled={loadingMore}
            className="w-full py-3 text-xs font-semibold rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 transition-colors">
            {loadingMore ? 'Loading…' : `Load more (next ${PAGE_SIZE})`}
          </button>
        )}
        {!hasMore && logs.length >= PAGE_SIZE && (
          <p className="text-center text-xs text-zinc-600 py-2">End of log.</p>
        )}
        </div>
      )}
    </div>
  )
}
