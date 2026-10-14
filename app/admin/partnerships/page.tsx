'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAdminLoad } from '@/lib/admin/useAdminLoad'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { formatMoney, KNOWN_CURRENCIES, DEFAULT_CURRENCY } from '@/lib/data'
import { STAGES, PARTNERSHIP_TYPES, COMMISSION_TYPES, PAYMENT_STATUSES } from '@/lib/partnerships'

interface Partnership {
  id: string
  organizer: string
  contactName: string | null
  contactEmail: string | null
  website: string | null
  stage: string
  type: string | null
  leadId: string | null
  eventId: string | null
  postId: string | null
  campaignName: string | null
  deliverables: string | null
  startDate: string | null
  endDate: string | null
  feeAmount: number | null
  feeCurrency: string
  commissionType: string | null
  commissionRate: number | null
  commissionCurrency: string | null
  commissionBasis: string | null
  reportingTerms: string | null
  paymentTerms: string | null
  paymentStatus: string
  followUpDate: string | null
  internalNotes: string | null
  archivedAt: string | null
}
interface Payload { partnerships: Partnership[]; counts: { byStage: Record<string, number>; dueFollowUps: number }; today: string }

const inputCls = 'bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-1.5 text-white text-sm focus:outline-none focus:border-amber-500 w-full'
const labelCls = 'block text-xs font-semibold text-zinc-400 mb-1'
const STAGE_LABEL = Object.fromEntries(STAGES.map(s => [s.value, s.label]))
const TYPE_LABEL = Object.fromEntries(PARTNERSHIP_TYPES.map(s => [s.value, s.label]))
const PAY_LABEL = Object.fromEntries(PAYMENT_STATUSES.map(s => [s.value, s.label]))

// Form state is all strings; '' means "empty" and is sent as null.
const FIELDS = ['organizer', 'contactName', 'contactEmail', 'website', 'stage', 'type', 'campaignName', 'eventId', 'postId', 'deliverables', 'startDate', 'endDate',
  'feeAmount', 'feeCurrency', 'commissionType', 'commissionRate', 'commissionCurrency', 'commissionBasis', 'reportingTerms', 'paymentTerms',
  'paymentStatus', 'followUpDate', 'internalNotes'] as const
type Form = Record<(typeof FIELDS)[number], string>
const blank = (): Form => ({ ...Object.fromEntries(FIELDS.map(f => [f, ''])), stage: 'research', feeCurrency: DEFAULT_CURRENCY, paymentStatus: 'none' }) as Form
const fromRow = (p: Partnership): Form => Object.fromEntries(FIELDS.map(f => [f, p[f] == null ? '' : String(p[f])])) as Form
const toBody = (f: Form) => Object.fromEntries(FIELDS.map(k => {
  if (k === 'feeAmount' || k === 'commissionRate') return [k, f[k].trim() === '' ? null : Number(f[k])]
  return [k, f[k].trim() === '' ? null : f[k].trim()]
}))

function Editor({ initial, onSaved, onCancel }: { initial: Partnership | null; onSaved: () => void; onCancel: () => void }) {
  const [f, setF] = useState<Form>(() => initial ? fromRow(initial) : blank())
  const [saving, setSaving] = useState(false)
  const set = (k: keyof Form, v: string) => setF(p => ({ ...p, [k]: v }))
  const id = (k: string) => `${initial?.id ?? 'new'}-${k}`

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const body = toBody(f)
      // Stage and payment status never go null; the server treats them as required choices.
      const res = await fetch('/app/api/admin/partnerships', {
        method: initial ? 'PATCH' : 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(initial ? { id: initial.id, ...body } : body),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Save failed (${res.status})`)
      toast.success(initial ? 'Saved' : 'Partnership added')
      onSaved()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Save failed') }
    finally { setSaving(false) }
  }

  const txt = (k: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div><label htmlFor={id(k)} className={labelCls}>{label}</label>
      <input id={id(k)} value={f[k]} onChange={e => set(k, e.target.value)} className={inputCls} {...props} /></div>
  )
  const area = (k: keyof Form, label: string, rows = 3) => (
    <div><label htmlFor={id(k)} className={labelCls}>{label}</label>
      <textarea id={id(k)} rows={rows} value={f[k]} onChange={e => set(k, e.target.value)} className={`${inputCls} resize-y`} /></div>
  )
  const sel = (k: keyof Form, label: string, opts: readonly { value: string; label: string }[], blankLabel?: string) => (
    <div><label htmlFor={id(k)} className={labelCls}>{label}</label>
      <select id={id(k)} value={f[k]} onChange={e => set(k, e.target.value)} className={inputCls}>
        {blankLabel !== undefined && <option value="">{blankLabel}</option>}
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select></div>
  )
  const grid = 'grid grid-cols-1 sm:grid-cols-2 gap-3'

  return (
    <form onSubmit={save} className="space-y-5 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5">
      <fieldset className="space-y-3"><legend className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Organizer and contact</legend>
        <div className={grid}>{txt('organizer', 'Organizer *', { required: true, maxLength: 160 })}{txt('contactName', 'Contact name', { maxLength: 120 })}</div>
        <div className={grid}>{txt('contactEmail', 'Contact email', { type: 'email', maxLength: 200 })}{txt('website', 'Website (https://…)', { type: 'url', maxLength: 300 })}</div>
      </fieldset>
      <fieldset className="space-y-3"><legend className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Pipeline</legend>
        <div className={grid}>{sel('stage', 'Stage', STAGES)}{sel('type', 'Partnership type', PARTNERSHIP_TYPES, 'Not set')}</div>
        <div className={grid}>{txt('followUpDate', 'Follow-up date', { type: 'date' })}{txt('campaignName', 'Event or campaign', { maxLength: 160 })}</div>
        <div className={grid}>{txt('eventId', 'Linked event id (optional)', { maxLength: 40 })}{txt('postId', 'Linked article id (optional)', { maxLength: 40 })}</div>
      </fieldset>
      <fieldset className="space-y-3"><legend className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Agreement</legend>
        {area('deliverables', 'Agreed deliverables')}
        <div className={grid}>{txt('startDate', 'Start date', { type: 'date' })}{txt('endDate', 'End date', { type: 'date' })}</div>
        <p className="text-xs text-zinc-500">Agreed terms only. What was actually received is recorded separately and is never worked out from these.</p>
        <div className="grid grid-cols-2 gap-3">{txt('feeAmount', 'Fixed fee (agreed)', { type: 'number', min: 0, step: '0.01', inputMode: 'decimal' })}
          <div><label htmlFor={id('feeCurrency')} className={labelCls}>Fee currency</label>
            <select id={id('feeCurrency')} value={f.feeCurrency} onChange={e => set('feeCurrency', e.target.value)} className={inputCls}>
              {KNOWN_CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div></div>
        <div className={grid}>{sel('commissionType', 'Commission type', COMMISSION_TYPES, 'No commission')}
          {txt('commissionRate', f.commissionType === 'percentage' ? 'Commission rate (%)' : 'Commission amount per ticket', { type: 'number', min: 0, step: '0.01', inputMode: 'decimal' })}</div>
        {f.commissionType === 'amount_per_ticket' && (
          <div><label htmlFor={id('commissionCurrency')} className={labelCls}>Commission currency</label>
            <select id={id('commissionCurrency')} value={f.commissionCurrency} onChange={e => set('commissionCurrency', e.target.value)} className={inputCls}>
              <option value="">Same as fee</option>{KNOWN_CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
        )}
        {area('commissionBasis', 'Commission calculation basis (e.g. net ticket price, which tickets are eligible)', 2)}
        {area('reportingTerms', 'Reporting terms', 2)}
        {area('paymentTerms', 'Payment terms', 2)}
        {sel('paymentStatus', 'Payment status', PAYMENT_STATUSES)}
      </fieldset>
      <fieldset><legend className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Internal</legend>
        {area('internalNotes', 'Internal notes (admins only)', 4)}
      </fieldset>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl border border-zinc-700 text-zinc-300 text-sm">Cancel</button>
        <button type="submit" disabled={saving || !f.organizer.trim()} className="px-4 py-2 rounded-xl bg-amber-500 text-black text-sm font-bold disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  )
}

export default function AdminPartnershipsPage() {
  const [stage, setStage] = useState('all')
  const [due, setDue] = useState(false)
  const [archived, setArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [tick, setTick] = useState(0)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t) }, [search])

  const query = new URLSearchParams({ ...(stage !== 'all' ? { stage } : {}), ...(due ? { due: '1' } : {}), ...(archived ? { archived: '1' } : {}), ...(q ? { q } : {}), _: String(tick) })
  const { data, loading, error, retry } = useAdminLoad<Payload>(
    `/app/api/admin/partnerships?${query}`,
    (v): v is Payload => typeof v === 'object' && v !== null && Array.isArray((v as Payload).partnerships),
  )
  const reload = () => { setEditing(null); setTick(t => t + 1) }

  async function setStageFor(p: Partnership, next: string) {
    const res = await fetch('/app/api/admin/partnerships', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, stage: next }) })
    if (!res.ok) { toast.error((await res.json().catch(() => ({}))).error ?? 'Update failed'); return }
    toast.success(`${p.organizer} → ${STAGE_LABEL[next]}`); setTick(t => t + 1)
  }
  async function setArchivedFor(p: Partnership, a: boolean) {
    const res = await fetch('/app/api/admin/partnerships', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, archived: a }) })
    if (!res.ok) { toast.error('Update failed'); return }
    toast.success(a ? 'Archived' : 'Restored'); setTick(t => t + 1)
  }

  if (error) return <div className="p-6"><LoadErrorBanner message={error} onRetry={retry} /></div>
  const rows = data?.partnerships ?? []
  const counts = data?.counts.byStage ?? {}
  const today = data?.today ?? ''

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Partnerships</h1>
          <p className="text-zinc-500 text-sm mt-1">Organizer relationships from first research to active partner. This is a record only: nothing here sends email or contacts anyone.</p>
        </div>
        <div className="flex items-center gap-3">
          <a href="/app/api/admin/partnerships/export" download className="text-xs font-semibold text-amber-400 underline">Export CSV</a>
          <button onClick={() => setEditing('new')} className="px-4 py-2 rounded-xl bg-amber-500 text-black text-sm font-bold">Add partnership</button>
        </div>
      </div>

      {editing === 'new' && <div className="mb-5"><Editor initial={null} onSaved={reload} onCancel={() => setEditing(null)} /></div>}

      <div role="group" aria-label="Stage" className="flex gap-2 flex-wrap mb-3">
        {[{ value: 'all', label: 'All' }, ...STAGES].map(s => (
          <button key={s.value} onClick={() => setStage(s.value)} aria-pressed={stage === s.value}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${stage === s.value ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
            {s.label}{s.value !== 'all' ? ` · ${counts[s.value] ?? 0}` : ''}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 mb-4 flex-wrap text-xs">
        <input type="search" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search partnerships" placeholder="Search organizer, contact, campaign…" className={`${inputCls} text-xs flex-1 min-w-[200px]`} />
        <button onClick={() => setDue(d => !d)} aria-pressed={due}
          className={`px-3 py-1.5 rounded-xl font-semibold border ${due ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
          Follow-ups due · {data?.counts.dueFollowUps ?? 0}
        </button>
        <button onClick={() => setArchived(a => !a)} aria-pressed={archived}
          className={`px-3 py-1.5 rounded-xl font-semibold border ${archived ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
          {archived ? 'Showing archived' : 'Show archived'}
        </button>
      </div>

      {loading && !data ? <p className="text-zinc-500 text-sm">Loading…</p>
        : rows.length === 0 ? <p className="text-zinc-500 text-sm py-10 text-center">No partnerships match. Add one, or start one from an enquiry in Sponsors &amp; partnerships.</p>
        : (
        <ul className="space-y-3 list-none p-0">
          {rows.map(p => {
            const overdue = !!p.followUpDate && p.followUpDate <= today && p.stage !== 'closed' && p.stage !== 'active_partner'
            return (
              <li key={p.id}>
                {editing === p.id ? <Editor initial={p} onSaved={reload} onCancel={() => setEditing(null)} /> : (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="font-bold text-white truncate">{p.organizer}</p>
                        <p className="text-xs text-zinc-500">
                          {[p.type && TYPE_LABEL[p.type], p.campaignName, p.contactName].filter(Boolean).join(' · ') || 'No details yet'}
                        </p>
                      </div>
                      <select aria-label={`Stage for ${p.organizer}`} value={p.stage} onChange={e => setStageFor(p, e.target.value)} className={`${inputCls} !w-auto text-xs`}>
                        {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3 text-xs">
                      {p.followUpDate && <span className={`px-2 py-0.5 rounded-full border ${overdue ? 'border-amber-500/40 text-amber-300 bg-amber-500/10' : 'border-zinc-700 text-zinc-400'}`}>Follow up {p.followUpDate}{overdue ? ' (due)' : ''}</span>}
                      {p.feeAmount !== null && <span className="px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300">Agreed fee {formatMoney(p.feeAmount, p.feeCurrency)}</span>}
                      {p.commissionType && p.commissionRate !== null && <span className="px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300">
                        Commission {p.commissionType === 'percentage' ? `${p.commissionRate}%` : `${formatMoney(p.commissionRate, p.commissionCurrency ?? p.feeCurrency)} / ticket`}</span>}
                      {p.paymentStatus !== 'none' && <span className="px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300">Payment: {PAY_LABEL[p.paymentStatus]}</span>}
                    </div>
                    {p.internalNotes && <p className="text-xs text-zinc-400 mt-3 whitespace-pre-wrap line-clamp-3">{p.internalNotes}</p>}
                    <div className="flex gap-3 mt-3 text-xs">
                      <button onClick={() => setEditing(p.id)} className="font-semibold text-amber-400 underline">Edit</button>
                      <button onClick={() => setArchivedFor(p, !p.archivedAt)} className="text-zinc-500 underline">{p.archivedAt ? 'Restore' : 'Archive'}</button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
