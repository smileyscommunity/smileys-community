'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAdminLoad } from '@/lib/admin/useAdminLoad'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'

interface SponsorLead {
  id: string
  name: string
  email: string
  company: string
  format: string
  message: string
  status: string
  dealValue: number | null
  currency: string
  adminNotes: string | null
  createdAt: string
}

interface SponsorsPayload {
  leads: SponsorLead[]
  summary: { wonValue: number; wonCount: number }
}

const STATUSES = ['new', 'contacted', 'negotiating', 'won', 'lost'] as const

const STATUS_STYLES: Record<string, string> = {
  new:         'bg-blue-500/15 text-blue-300 border-blue-500/30',
  contacted:   'bg-amber-500/15 text-amber-300 border-amber-500/30',
  negotiating: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  won:         'bg-green-500/15 text-green-300 border-green-500/30',
  lost:        'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
}

const FORMAT_LABELS: Record<string, string> = {
  event_sponsorship: 'Event Sponsorship',
  newsletter:        'Newsletter Feature',
  club_partnership:  'Club Partnership',
  branded_event:     'Branded Event',
  other:             'Not sure yet',
}

const inputCls = 'bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-1.5 text-white text-sm focus:outline-none focus:border-amber-500'

function fmtTRY(n: number) {
  return `₺${n.toLocaleString('tr-TR')}`
}

export default function AdminSponsorsPage() {
  const { data, loading, error, retry, setData } = useAdminLoad<SponsorsPayload>(
    '/app/api/admin/sponsors',
    (v): v is SponsorsPayload =>
      typeof v === 'object' && v !== null && Array.isArray((v as SponsorsPayload).leads),
  )

  const [filter, setFilter] = useState<string>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  // Per-lead draft for value/notes so typing doesn't fire a PATCH per
  // keystroke — saved explicitly via the Save button.
  const [drafts, setDrafts] = useState<Record<string, { dealValue: string; adminNotes: string }>>({})

  const leads = useMemo(() => {
    const all = data?.leads ?? []
    return filter === 'all' ? all : all.filter(l => l.status === filter)
  }, [data, filter])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const l of data?.leads ?? []) c[l.status] = (c[l.status] ?? 0) + 1
    return c
  }, [data])

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch('/app/api/admin/sponsors', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error ?? `Update failed (${res.status})`)
    }
    return res.json() as Promise<SponsorLead>
  }

  async function setStatus(lead: SponsorLead, status: string) {
    try {
      const updated = await patch(lead.id, { status })
      setData(prev => prev && {
        ...prev,
        leads: prev.leads.map(l => (l.id === lead.id ? updated : l)),
        summary: recalcSummary(prev.leads.map(l => (l.id === lead.id ? updated : l))),
      })
      toast.success(`${lead.company} → ${status}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }

  async function saveDraft(lead: SponsorLead) {
    const draft = drafts[lead.id]
    if (!draft) return
    const value = draft.dealValue.trim() === '' ? null : Number(draft.dealValue)
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      toast.error('Deal value must be a positive number')
      return
    }
    try {
      const updated = await patch(lead.id, { dealValue: value, adminNotes: draft.adminNotes })
      setData(prev => prev && {
        ...prev,
        leads: prev.leads.map(l => (l.id === lead.id ? updated : l)),
        summary: recalcSummary(prev.leads.map(l => (l.id === lead.id ? updated : l))),
      })
      setDrafts(prev => { const next = { ...prev }; delete next[lead.id]; return next })
      toast.success('Saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }

  function recalcSummary(all: SponsorLead[]) {
    const won = all.filter(l => l.status === 'won')
    return { wonValue: won.reduce((s, l) => s + (l.dealValue ?? 0), 0), wonCount: won.length }
  }

  function draftFor(lead: SponsorLead) {
    return drafts[lead.id] ?? {
      dealValue:  lead.dealValue === null ? '' : String(lead.dealValue),
      adminNotes: lead.adminNotes ?? '',
    }
  }

  if (error) return <div className="p-6"><LoadErrorBanner message={error} onRetry={retry} /></div>

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Sponsors</h1>
          <p className="text-zinc-500 text-sm mt-1">B2B leads from the advertise page — work them from enquiry to closed deal.</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-green-400">{fmtTRY(data?.summary.wonValue ?? 0)}</div>
          <div className="text-xs text-zinc-500">{data?.summary.wonCount ?? 0} won deal{(data?.summary.wonCount ?? 0) === 1 ? '' : 's'}</div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap mb-5">
        {['all', ...STATUSES].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors capitalize ${
              filter === s
                ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}>
            {s}{s !== 'all' && counts[s] ? ` · ${counts[s]}` : ''}
          </button>
        ))}
      </div>

      {loading && <div className="text-zinc-500 text-sm py-10 text-center">Loading…</div>}

      {!loading && leads.length === 0 && (
        <div className="text-zinc-500 text-sm py-10 text-center border border-dashed border-zinc-800 rounded-2xl">
          {filter === 'all' ? 'No sponsor leads yet. They arrive from the /advertise form.' : `No ${filter} leads.`}
        </div>
      )}

      <div className="space-y-3">
        {leads.map(lead => {
          const open  = openId === lead.id
          const draft = draftFor(lead)
          return (
            <div key={lead.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => setOpenId(open ? null : lead.id)} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white truncate">{lead.company}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border capitalize ${STATUS_STYLES[lead.status] ?? STATUS_STYLES.new}`}>
                      {lead.status}
                    </span>
                    <span className="text-xs text-zinc-500">{FORMAT_LABELS[lead.format] ?? lead.format}</span>
                    {lead.status === 'won' && lead.dealValue !== null && (
                      <span className="text-xs font-semibold text-green-400">{fmtTRY(lead.dealValue)}</span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1 truncate">
                    {lead.name} · {lead.email} · {new Date(lead.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </button>
                <select value={lead.status} onChange={e => setStatus(lead, e.target.value)}
                  className={`${inputCls} capitalize`}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {open && (
                <div className="mt-4 pt-4 border-t border-zinc-800 space-y-4">
                  <p className="text-sm text-zinc-300 whitespace-pre-wrap">{lead.message}</p>
                  <div className="flex items-end gap-3 flex-wrap">
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">Deal value (₺)</label>
                      <input type="number" min={0} value={draft.dealValue}
                        onChange={e => setDrafts(prev => ({ ...prev, [lead.id]: { ...draft, dealValue: e.target.value } }))}
                        placeholder="—" className={`${inputCls} w-36`} />
                    </div>
                    <div className="flex-1 min-w-[220px]">
                      <label className="block text-xs text-zinc-500 mb-1">Notes</label>
                      <input type="text" value={draft.adminNotes}
                        onChange={e => setDrafts(prev => ({ ...prev, [lead.id]: { ...draft, adminNotes: e.target.value } }))}
                        placeholder="Call summary, next step, who's handling it…" className={`${inputCls} w-full`} />
                    </div>
                    <button onClick={() => saveDraft(lead)}
                      disabled={!drafts[lead.id]}
                      className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-black text-sm font-semibold transition-colors">
                      Save
                    </button>
                    <a href={`mailto:${lead.email}?subject=${encodeURIComponent(`Smileys Community — your ${FORMAT_LABELS[lead.format] ?? 'sponsorship'} enquiry`)}`}
                      className="px-4 py-1.5 rounded-xl border border-zinc-700 hover:bg-zinc-800 text-zinc-300 text-sm font-semibold transition-colors">
                      Reply
                    </a>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
