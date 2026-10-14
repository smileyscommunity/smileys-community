'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useAdminLoad } from '@/lib/admin/useAdminLoad'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { formatMoney, KNOWN_CURRENCIES, DEFAULT_CURRENCY } from '@/lib/data'
import { COUNT_KINDS, MONEY_KINDS, ENTRY_KINDS, REPORT_SOURCES, type ReportSummary } from '@/lib/campaignReport'
import { STAGES } from '@/lib/partnerships'

interface Row { id: string; organizer: string; campaignName: string | null; stage: string; sourceTag: string | null; articleViews: number | null; enquiries: number | null; summary: ReportSummary }
interface Detail {
  partnership: { id: string; organizer: string; campaignName: string | null; sourceTag: string | null; feeAmount: number | null; feeCurrency: string; commissionType: string | null; commissionRate: number | null }
  entries: { id: string; kind: string; quantity: number | null; amount: number | null; currency: string | null; source: string; reportedAt: string; note: string | null }[]
  summary: ReportSummary
  measured: { articleTitle: string | null; articleViews: number | null; enquiries: number | null; ticketClicksPostHog: number | null; posthogConnected: boolean }
}

const inputCls = 'bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-1.5 text-white text-sm focus:outline-none focus:border-amber-500 w-full'
const labelCls = 'block text-xs font-semibold text-zinc-400 mb-1'
const STAGE_LABEL = Object.fromEntries(STAGES.map(s => [s.value, s.label]))
const KIND_LABEL = Object.fromEntries(ENTRY_KINDS.map(k => [k.value, k.label]))
const SRC_LABEL = Object.fromEntries(REPORT_SOURCES.map(s => [s.value, s.label]))
const nf = new Intl.NumberFormat('en-US')
const NA = <span className="text-zinc-600">not reported</span>

function Stat({ label, children, note }: { label: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-xl bg-zinc-950/60 border border-zinc-800 p-3">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="text-lg font-bold text-white mt-0.5">{children}</dd>
      {note && <dd className="text-[11px] text-zinc-500 mt-1 leading-snug">{note}</dd>}
    </div>
  )
}

function Detail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [tick, setTick] = useState(0)
  const { data, loading, error, retry } = useAdminLoad<Detail>(
    `/app/api/admin/partnership-reports?id=${encodeURIComponent(id)}&_=${tick}`,
    (v): v is Detail => typeof v === 'object' && v !== null && Array.isArray((v as Detail).entries),
  )
  const [f, setF] = useState({ kind: 'tickets_sold', value: '', currency: DEFAULT_CURRENCY, source: 'organizer_report', reportedAt: '', note: '' })
  const [saving, setSaving] = useState(false)
  const money = MONEY_KINDS.some(k => k.value === f.kind)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const n = f.value.trim() === '' ? NaN : Number(f.value)
      const res = await fetch('/app/api/admin/partnership-reports', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnershipId: id, kind: f.kind, source: f.source, reportedAt: f.reportedAt, note: f.note,
          ...(money ? { amount: n, currency: f.currency } : { quantity: n }) }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Save failed (${res.status})`)
      toast.success('Figure recorded'); setF(p => ({ ...p, value: '', note: '' })); setTick(t => t + 1); onChanged()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Save failed') }
    finally { setSaving(false) }
  }
  async function remove(entryId: string) {
    const res = await fetch(`/app/api/admin/partnership-reports?id=${encodeURIComponent(entryId)}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) { toast.error('Could not remove it'); return }
    toast.success('Removed'); setTick(t => t + 1); onChanged()
  }

  if (error) return <LoadErrorBanner message={error} onRetry={retry} />
  if (loading && !data) return <p className="text-zinc-500 text-sm">Loading…</p>
  if (!data) return null
  const { summary: s, measured: m, partnership: p } = data

  return (
    <div className="space-y-5 mt-4">
      <section aria-label="Measured by Smileys">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Measured by Smileys</h3>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="Article views" note="Cumulative since publication; one count per browser session.">{m.articleViews === null ? <span className="text-zinc-600">no article linked</span> : nf.format(m.articleViews)}</Stat>
          <Stat label="Ticket-link clicks" note="Clicks on the public ticket link. Not sales.">
            {m.ticketClicksPostHog !== null ? nf.format(m.ticketClicksPostHog)
              : m.posthogConnected ? <span className="text-zinc-600">unavailable</span> : <span className="text-zinc-600">PostHog not connected</span>}
          </Stat>
          <Stat label="Partnership enquiries" note={p.sourceTag ? `Enquiries tagged src=${p.sourceTag}.` : 'Set a source tag on the partnership to count these.'}>{m.enquiries === null ? <span className="text-zinc-600">no source tag</span> : nf.format(m.enquiries)}</Stat>
        </dl>
      </section>

      <section aria-label="Reported by others">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Reported figures</h3>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="Tickets sold" note="From organizer reports or an integration only.">{s.ticketsSold === null ? NA : nf.format(s.ticketsSold)}</Stat>
          <Stat label="Discount redemptions" note="As reported by the organizer.">{s.discountRedemptions === null ? NA : nf.format(s.discountRedemptions)}</Stat>
          <Stat label="Last reported">{s.latestReportedAt ?? NA}</Stat>
        </dl>
      </section>

      <section aria-label="Money">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-1">Money — kept separate</h3>
        <p className="text-xs text-zinc-500 mb-2">Agreed terms, money received and expenses are different things. Nothing here is a profit figure: other costs are not recorded.</p>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Agreed fixed fee">{p.feeAmount === null ? NA : formatMoney(p.feeAmount, p.feeCurrency)}</Stat>
          <Stat label="Agreed commission">{p.commissionType && p.commissionRate !== null ? (p.commissionType === 'percentage' ? `${p.commissionRate}%` : `${formatMoney(p.commissionRate, p.feeCurrency)} / ticket`) : NA}</Stat>
          <Stat label="Received">{s.received.length ? s.received.map(r => <div key={r.currency} className="text-sm">{formatMoney(r.fee, r.currency)} fee · {formatMoney(r.commission, r.currency)} commission</div>) : NA}</Stat>
          <Stat label="Expenses">{s.expenses.length ? s.expenses.map(r => <div key={r.currency} className="text-sm">{formatMoney(r.amount, r.currency)}</div>) : NA}</Stat>
        </dl>
      </section>

      <section aria-label="Add a figure">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Record a figure</h3>
        <form onSubmit={add} className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-zinc-950/60 border border-zinc-800 rounded-xl p-3">
          <div><label htmlFor={`k-${id}`} className={labelCls}>What was reported</label>
            <select id={`k-${id}`} value={f.kind} onChange={e => setF(p => ({ ...p, kind: e.target.value }))} className={inputCls}>
              <optgroup label="Counts">{COUNT_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</optgroup>
              <optgroup label="Money">{MONEY_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</optgroup>
            </select></div>
          <div className={money ? 'grid grid-cols-2 gap-2' : ''}>
            <div><label htmlFor={`v-${id}`} className={labelCls}>{money ? 'Amount' : 'Number'}</label>
              <input id={`v-${id}`} type="number" min={0} step={money ? '0.01' : '1'} inputMode={money ? 'decimal' : 'numeric'} required value={f.value} onChange={e => setF(p => ({ ...p, value: e.target.value }))} className={inputCls} /></div>
            {money && <div><label htmlFor={`c-${id}`} className={labelCls}>Currency</label>
              <select id={`c-${id}`} value={f.currency} onChange={e => setF(p => ({ ...p, currency: e.target.value }))} className={inputCls}>{KNOWN_CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>}
          </div>
          <div><label htmlFor={`s-${id}`} className={labelCls}>Source of the figure</label>
            <select id={`s-${id}`} value={f.source} onChange={e => setF(p => ({ ...p, source: e.target.value }))} className={inputCls}>{REPORT_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
          <div><label htmlFor={`d-${id}`} className={labelCls}>Reporting date</label>
            <input id={`d-${id}`} type="date" required value={f.reportedAt} onChange={e => setF(p => ({ ...p, reportedAt: e.target.value }))} className={inputCls} /></div>
          <div className="sm:col-span-2"><label htmlFor={`n-${id}`} className={labelCls}>Note (optional — never paste a discount code or private link)</label>
            <input id={`n-${id}`} maxLength={500} value={f.note} onChange={e => setF(p => ({ ...p, note: e.target.value }))} className={inputCls} /></div>
          <div className="sm:col-span-2 flex justify-end"><button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-amber-500 text-black text-sm font-bold disabled:opacity-50">{saving ? 'Saving…' : 'Record figure'}</button></div>
        </form>
      </section>

      {data.entries.length > 0 && (
        <section aria-label="Ledger">
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Ledger</h3>
          <ul className="list-none p-0 divide-y divide-zinc-800 border border-zinc-800 rounded-xl">
            {data.entries.map(e => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 text-zinc-300">
                  <b className="text-white">{KIND_LABEL[e.kind] ?? e.kind}:</b> {e.quantity !== null ? nf.format(e.quantity) : formatMoney(e.amount ?? 0, e.currency)}
                  <span className="text-zinc-500"> · {SRC_LABEL[e.source] ?? e.source} · {e.reportedAt}{e.note ? ` · ${e.note}` : ''}</span>
                </span>
                <button onClick={() => remove(e.id)} className="text-xs text-zinc-500 underline shrink-0">Remove</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export default function CampaignReportsPage() {
  const [tick, setTick] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const { data, loading, error, retry } = useAdminLoad<{ rows: Row[] }>(
    `/app/api/admin/partnership-reports?_=${tick}`,
    (v): v is { rows: Row[] } => typeof v === 'object' && v !== null && Array.isArray((v as { rows: Row[] }).rows),
  )
  if (error) return <div className="p-6"><LoadErrorBanner message={error} onRetry={retry} /></div>
  const rows = data?.rows ?? []

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
        <div>
          <Link href="/admin/partnerships" className="text-xs text-zinc-500 underline">← Partnerships</Link>
          <h1 className="text-xl font-bold text-white mt-1">Campaign results</h1>
          <p className="text-zinc-500 text-sm mt-1 max-w-2xl">Views and enquiries are measured. Ticket sales and redemptions are entered from an organizer report or integration, with a source and date; a click or RSVP is never counted as a sale.</p>
        </div>
        <div className="flex gap-3 text-xs font-semibold">
          <a href="/app/api/admin/partnership-reports/export" download className="text-amber-400 underline">Export summary CSV</a>
          <a href="/app/api/admin/partnership-reports/export?entries=1" download className="text-amber-400 underline">Export ledger CSV</a>
        </div>
      </div>

      {loading && !data ? <p className="text-zinc-500 text-sm">Loading…</p>
        : rows.length === 0 ? <p className="text-zinc-500 text-sm py-10 text-center">No partnerships yet. Add one under Partnerships first.</p>
        : (
        <ul className="space-y-3 list-none p-0">
          {rows.map(r => (
            <li key={r.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <button onClick={() => setOpen(o => o === r.id ? null : r.id)} aria-expanded={open === r.id} className="w-full text-left">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-bold text-white truncate">{r.organizer}</p>
                    <p className="text-xs text-zinc-500">{[r.campaignName, STAGE_LABEL[r.stage]].filter(Boolean).join(' · ')}</p>
                  </div>
                  <p className="text-xs text-zinc-400 flex gap-3 flex-wrap">
                    <span>Views {r.articleViews === null ? '–' : nf.format(r.articleViews)}</span>
                    <span>Enquiries {r.enquiries === null ? '–' : nf.format(r.enquiries)}</span>
                    <span>Tickets sold {r.summary.ticketsSold === null ? 'not reported' : nf.format(r.summary.ticketsSold)}</span>
                  </p>
                </div>
              </button>
              {open === r.id && <Detail id={r.id} onChanged={() => setTick(t => t + 1)} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
