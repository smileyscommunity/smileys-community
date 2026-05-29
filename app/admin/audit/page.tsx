'use client'

import { useState, useEffect } from 'react'

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

export default function AdminAuditPage() {
  const [logs,    setLogs]    = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState('')

  // Re-fetch when the filter changes so the server-side action prefix
  // narrows the result set — previously the route accepted ?action= and
  // ?take= but the client never used them, so the page filtered a
  // rolling-100 window client-side and an active filter often emptied
  // the visible list (the 100 latest entries might contain zero matches
  // for "Payments" if recent activity was elsewhere). take=200 is the
  // server's hard cap.
  useEffect(() => {
    setLoading(true)
    const qs = new URLSearchParams({ take: '200' })
    if (filter) qs.set('action', filter)
    fetch(`/app/api/admin/audit?${qs.toString()}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setLogs(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false))
  }, [filter])

  // Server has already narrowed by action prefix; no further client
  // filter needed. (The old `|| adminName.includes(filter)` clause was
  // dead — every filter chip is an action prefix, no admin is named
  // "user.ban".)
  const visible = logs

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">Audit Log</h1>
        <p className="text-sm text-zinc-500 mt-0.5">All sensitive admin actions — {logs.length} entries</p>
      </div>

      <div className="flex gap-1 bg-zinc-900 rounded-xl p-1 w-fit border border-zinc-800 flex-wrap">
        {FILTER_GROUPS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${filter === f.key ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-10 text-center">
          <div className="text-3xl mb-2">🗒</div>
          <p className="text-zinc-400 text-sm">No audit entries yet.</p>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          <div className="divide-y divide-zinc-800">
            {visible.map(log => {
              const style   = ACTION_STYLES[log.action] ?? 'bg-zinc-700 text-zinc-400 border-zinc-600'
              const label   = ACTION_LABELS[log.action] ?? log.action
              const summary = log.description || legacySummary(log.action, log.meta)
              return (
                <div key={log.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-zinc-800/40 transition-colors">
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
                    {log.targetId && (
                      <div className="text-xs text-zinc-600 font-mono mt-0.5">{log.targetType} · {log.targetId}</div>
                    )}
                  </div>
                  <div className="text-xs text-zinc-600 whitespace-nowrap shrink-0 mt-0.5">
                    {new Date(log.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
