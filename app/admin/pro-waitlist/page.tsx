'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useAdminLoad } from '@/lib/admin/useAdminLoad'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'

interface Entry {
  id:         string
  position:   number
  isFounder:  boolean
  userId:     string | null
  name:       string
  email:      string
  industry:   string | null
  role:       string | null
  status:     string
  adminNotes: string | null
  createdAt:  string
}

interface Payload {
  entries: Entry[]
  summary: { total: number; founders: number; converted: number; invited: number }
}

const STATUSES = ['waitlisted', 'invited', 'converted', 'declined'] as const

const STATUS_STYLES: Record<string, string> = {
  waitlisted: 'bg-zinc-700/40 text-zinc-300 border-zinc-600/30',
  invited:    'bg-amber-500/15 text-amber-300 border-amber-500/30',
  converted:  'bg-green-500/15 text-green-300 border-green-500/30',
  declined:   'bg-red-500/15 text-red-300 border-red-500/30',
}

const inputCls = 'bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-1.5 text-white text-sm focus:outline-none focus:border-amber-500'

function csvEscape(s: string) {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export default function AdminProWaitlistPage() {
  const { data, loading, error, retry, setData } = useAdminLoad<Payload>(
    '/app/api/admin/pro-waitlist',
    (v): v is Payload =>
      typeof v === 'object' && v !== null && Array.isArray((v as Payload).entries),
  )
  const [openId, setOpenId] = useState<string | null>(null)

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch('/app/api/admin/pro-waitlist', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error ?? `Update failed (${res.status})`)
    }
    return res.json() as Promise<Entry>
  }

  async function setStatus(entry: Entry, status: string) {
    try {
      const updated = await patch(entry.id, { status })
      setData(prev => prev && {
        ...prev,
        entries: prev.entries.map(e => e.id === entry.id ? { ...e, ...updated } : e),
      })
      toast.success(`${entry.email} → ${status}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }

  function downloadCsv() {
    if (!data) return
    const rows = [
      ['position', 'founder', 'name', 'email', 'industry', 'role', 'status', 'createdAt'].join(','),
      ...data.entries.map(e => [
        e.position, e.isFounder ? 'yes' : 'no',
        csvEscape(e.name), csvEscape(e.email),
        csvEscape(e.industry ?? ''), csvEscape(e.role ?? ''),
        e.status, e.createdAt,
      ].join(',')),
    ]
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `pro-waitlist-${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (error) return <div className="p-6"><LoadErrorBanner message={error} onRetry={retry} /></div>

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Pro waitlist</h1>
          <p className="text-zinc-500 text-sm mt-1">Founding members lock in the founder rate. First 100 = 50% off for life.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-2xl font-bold text-amber-400 tabular-nums">{data?.summary.founders ?? 0}<span className="text-zinc-600 text-base">/100</span></div>
            <div className="text-xs text-zinc-500">founder seats filled</div>
          </div>
          <button onClick={downloadCsv} disabled={!data}
            className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 text-xs font-semibold transition-colors">
            Export CSV
          </button>
        </div>
      </div>

      {loading && <div className="text-zinc-500 text-sm py-10 text-center">Loading…</div>}

      {!loading && (data?.entries.length ?? 0) === 0 && (
        <div className="text-zinc-500 text-sm py-10 text-center border border-dashed border-zinc-800 rounded-2xl">
          No waitlist entries yet. Share /pro to start collecting founders.
        </div>
      )}

      <div className="space-y-2">
        {data?.entries.map(entry => {
          const open = openId === entry.id
          return (
            <div key={entry.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              {/* Single flex container that stacks on mobile and
                  collapses back to one row on sm+. Identity block
                  takes flex-1 so it absorbs remaining width on
                  desktop; on mobile the action row drops underneath
                  with its own width. Previous `flex-wrap` version
                  forced the action controls into a cramped trailing
                  row that fragmented across two visual lines on
                  narrow viewports. */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold tabular-nums shrink-0 ${entry.isFounder ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'bg-zinc-800 text-zinc-500 border border-zinc-700'}`}>
                    #{entry.position}{entry.isFounder && ' · 🪪'}
                  </span>
                  <button onClick={() => setOpenId(open ? null : entry.id)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-white truncate">{entry.name}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border capitalize ${STATUS_STYLES[entry.status] ?? STATUS_STYLES.waitlisted}`}>
                        {entry.status}
                      </span>
                      {entry.industry && <span className="text-xs text-zinc-500">{entry.industry}</span>}
                      {entry.role && <span className="text-xs text-zinc-500">· {entry.role}</span>}
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5 truncate">
                      {entry.email} · {new Date(entry.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </div>
                  </button>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select value={entry.status} onChange={e => setStatus(entry, e.target.value)}
                    className={`${inputCls} capitalize flex-1 sm:flex-initial`}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <a href={`mailto:${entry.email}?subject=${encodeURIComponent('Your Smileys Pro founding spot')}`}
                    className="px-3 py-1.5 rounded-xl border border-zinc-700 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold transition-colors shrink-0">
                    Reply
                  </a>
                </div>
              </div>
              {open && entry.adminNotes && (
                <p className="text-sm text-zinc-300 whitespace-pre-wrap mt-3 pt-3 border-t border-zinc-800">{entry.adminNotes}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
