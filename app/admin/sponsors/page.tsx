'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAdminLoad } from '@/lib/admin/useAdminLoad'
import { confirmToast } from '@/lib/confirmToast'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import { DEFAULT_CURRENCY, formatMoney, KNOWN_CURRENCIES } from '@/lib/data'

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
  source?: string | null
  archivedAt?: string | null
  scrubbedAt?: string | null
  otherFromSameEmail?: number
  eventName?: string | null
  eventDate?: string | null
  eventWebsite?: string | null
  eventVenue?: string | null
  budgetRange?: string | null
  createdAt: string
}

interface SponsorsPayload {
  leads: SponsorLead[]
  nextCursor: string | null
  counts: { byStatus: Record<string, number>; byKind: { all: number; sponsors: number; partnerships: number } }
  summary: { won: { currency: string; value: number; count: number }[]; wonCount: number }
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
  partner_coverage:   'Partnership · Coverage & guides',
  partner_interview:  'Partnership · Interview',
  partner_discount:   'Partnership · Member discount',
  partner_giveaway:   'Partnership · Ticket giveaway',
  partner_attendance: 'Partnership · Hosted attendance',
  partner_business:   'Partnership · Business event',
  partner_other:      'Partnership · Not sure yet',
}

// Whole days from today (the admin's own calendar day) to a 'YYYY-MM-DD' event
// date; negative = already happened.
function daysUntil(isoDay: string): number {
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((Date.parse(`${isoDay}T00:00:00Z`) - today) / 86_400_000)
}

function eventTiming(isoDay: string | null | undefined): { label: string; cls: string } | null {
  if (!isoDay || Number.isNaN(Date.parse(isoDay))) return null
  const d = daysUntil(isoDay)
  if (d < 0)  return { label: 'Event passed', cls: 'border-zinc-600/40 bg-zinc-500/10 text-zinc-400' }
  if (d === 0) return { label: 'Event today', cls: 'border-red-500/40 bg-red-500/10 text-red-300' }
  if (d <= 14) return { label: `Event in ${d} day${d === 1 ? '' : 's'}`, cls: 'border-red-500/40 bg-red-500/10 text-red-300' }
  return { label: `Event in ${d} days`, cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' }
}

const inputCls = 'bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-1.5 text-white text-sm focus:outline-none focus:border-amber-500'

function fmtMoney(n: number, currency: string) {
  return formatMoney(n, currency)
}

export default function AdminSponsorsPage() {
  const cur = useCurrentCity()?.currency ?? DEFAULT_CURRENCY
  const [filter, setFilter] = useState<string>('all')
  // Paid sponsor leads (/advertise) vs event-organizer partnership enquiries
  // (/partner-with-us, source = 'partners') — same table, two inboxes.
  const [kind, setKind] = useState<'all' | 'sponsors' | 'partnerships'>('all')
  const [archived, setArchived] = useState(false)
  // 'event' = soonest upcoming event first, then undated, then past — applied to
  // the leads loaded so far (paging is by newest).
  const [sort, setSort] = useState<'newest' | 'event'>('newest')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [tick, setTick] = useState(0)
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t) }, [search])

  const query = new URLSearchParams({ kind, ...(filter !== 'all' ? { status: filter } : {}), ...(archived ? { archived: '1' } : {}), ...(q ? { q } : {}), _: String(tick) })
  const { data, loading, error, retry } = useAdminLoad<SponsorsPayload>(
    `/app/api/admin/sponsors?${query}`,
    (v): v is SponsorsPayload =>
      typeof v === 'object' && v !== null && Array.isArray((v as SponsorsPayload).leads),
  )
  // Further pages (Load more). Cleared whenever the first page reloads.
  const [older, setOlder] = useState<SponsorLead[]>([])
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  useEffect(() => { setOlder([]); setOlderCursor(undefined) }, [kind, filter, archived, q, tick])

  const nextCursor = olderCursor === undefined ? data?.nextCursor ?? null : olderCursor
  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await fetch(`/app/api/admin/sponsors?${query}&cursor=${encodeURIComponent(nextCursor)}`, { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      const page = await res.json() as SponsorsPayload
      setOlder(prev => [...prev, ...page.leads])
      setOlderCursor(page.nextCursor)
    } catch { toast.error('Could not load more leads') }
    finally { setLoadingMore(false) }
  }

  const [openId, setOpenId] = useState<string | null>(null)
  // Per-lead draft for value/notes so typing doesn't fire a PATCH per
  // keystroke — saved explicitly via the Save button.
  const [drafts, setDrafts] = useState<Record<string, { dealValue: string; currency: string; adminNotes: string }>>({})

  const leads = useMemo(() => {
    const all = [...(data?.leads ?? []), ...older]
    if (sort === 'newest') return all
    const rank = (l: SponsorLead) => {
      if (!l.eventDate || Number.isNaN(Date.parse(l.eventDate))) return 1e9           // undated: after upcoming
      const d = daysUntil(l.eventDate)
      return d >= 0 ? d : 2e9 - d                                                      // upcoming asc, then past (most recent first)
    }
    return [...all].sort((a, b) => rank(a) - rank(b))
  }, [data, older, sort])

  const counts = data?.counts.byStatus ?? {}
  const kindCounts = data?.counts.byKind ?? { all: 0, sponsors: 0, partnerships: 0 }

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
      await patch(lead.id, { status })
      // Counts, the filter and the revenue total are server-side: reload.
      setTick(t => t + 1)
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
      await patch(lead.id, { dealValue: value, currency: draft.currency, adminNotes: draft.adminNotes })
      setTick(t => t + 1)
      setDrafts(prev => { const next = { ...prev }; delete next[lead.id]; return next })
      toast.success('Saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }

  async function setArchivedFlag(lead: SponsorLead, value: boolean) {
    try {
      await patch(lead.id, { archived: value })
      setTick(t => t + 1)
      toast.success(value ? `${lead.company} archived` : `${lead.company} restored`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Update failed') }
  }

  async function deleteLead(lead: SponsorLead) {
    if (!(await confirmToast(`Permanently delete ${lead.company}? This can't be undone.`, { confirmLabel: 'Delete' }))) return
    try {
      const res = await fetch(`/app/api/admin/sponsors?id=${encodeURIComponent(lead.id)}`, { method: 'DELETE', credentials: 'include' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Delete failed (${res.status})`)
      setTick(t => t + 1)
      toast.success('Deleted')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Delete failed') }
  }

  function draftFor(lead: SponsorLead) {
    return drafts[lead.id] ?? {
      dealValue:  lead.dealValue === null ? '' : String(lead.dealValue),
      currency:   lead.currency || cur,
      adminNotes: lead.adminNotes ?? '',
    }
  }

  if (error) return <div className="p-6"><LoadErrorBanner message={error} onRetry={retry} /></div>

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Sponsors &amp; partnerships</h1>
          <p className="text-zinc-500 text-sm mt-1">Paid sponsor leads from the advertise page and collaboration enquiries from the partner-with-us page — work them from inquiry to closed deal.</p>
        </div>
        <div className="text-right">
          <a href="/app/api/admin/sponsors/export" download className="inline-block mb-2 text-xs font-semibold text-amber-400 underline">Export all as CSV</a>
          {/* Won deals per currency — never one sum across lira and euros. */}
          <div className="text-2xl font-bold text-green-400">
            {(data?.summary.won?.length ?? 0) > 0
              ? data!.summary.won.map(w => fmtMoney(w.value, w.currency)).join(' + ')
              : fmtMoney(0, cur)}
          </div>
          <div className="text-xs text-zinc-500">{data?.summary.wonCount ?? 0} won sponsor deal{(data?.summary.wonCount ?? 0) === 1 ? '' : 's'} · partnerships not counted</div>
        </div>
      </div>

      <div role="group" aria-label="Lead type" className="flex gap-2 flex-wrap mb-3">
        {([['all', 'All leads'], ['sponsors', 'Sponsors'], ['partnerships', 'Partnerships']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
              kind === k
                ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}>
            {label} · {kindCounts[k]}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap text-xs text-zinc-500">
        <input type="search" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search leads"
          placeholder="Search name, email, company, event, message…" className={`${inputCls} text-xs flex-1 min-w-[200px]`} />
        <button onClick={() => setArchived(a => !a)} aria-pressed={archived}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${archived ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
          {archived ? 'Showing archived' : 'Show archived'}
        </button>
        <label htmlFor="lead-sort">Sort</label>
        <select id="lead-sort" value={sort} onChange={e => setSort(e.target.value as 'newest' | 'event')} className={`${inputCls} text-xs`}>
          <option value="newest">Newest first</option>
          <option value="event">Soonest event first</option>
        </select>
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

      {!loading && leads.length === 0 && (q || archived) && (
        <div className="text-zinc-500 text-sm py-10 text-center border border-dashed border-zinc-800 rounded-2xl">
          {q ? `No ${archived ? 'archived ' : ''}leads match “${q}”.` : 'Nothing archived here.'}
        </div>
      )}

      {!loading && leads.length === 0 && !q && !archived && (
        <div className="text-zinc-500 text-sm py-10 text-center border border-dashed border-zinc-800 rounded-2xl">
          {filter === 'all'
            ? kind === 'partnerships' ? 'No partnership enquiries yet. They arrive from the /partner-with-us form.'
              : kind === 'sponsors'   ? 'No sponsor leads yet. They arrive from the /advertise form.'
              : 'No leads yet. They arrive from the /advertise and /partner-with-us forms.'
            : `No ${filter} ${kind === 'partnerships' ? 'partnership enquiries' : kind === 'sponsors' ? 'sponsor leads' : 'leads'}.`}
        </div>
      )}

      <div className="space-y-3">
        {leads.map(lead => {
          const open  = openId === lead.id
          const draft = draftFor(lead)
          return (
            <div key={lead.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              {/* Mobile: identity button on row 1, status dropdown
                  full-width on row 2. sm+: collapses back to one row.
                  Previous `flex-wrap` version pushed the dropdown
                  awkwardly under the name on narrow viewports. */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <button onClick={() => setOpenId(open ? null : lead.id)} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white truncate">{lead.company}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border capitalize ${STATUS_STYLES[lead.status] ?? STATUS_STYLES.new}`}>
                      {lead.status}
                    </span>
                    <span className="text-xs text-zinc-500">{FORMAT_LABELS[lead.format] ?? lead.format}</span>
                    {eventTiming(lead.eventDate) && (
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${eventTiming(lead.eventDate)!.cls}`}>{eventTiming(lead.eventDate)!.label}</span>
                    )}
                    {(lead.otherFromSameEmail ?? 0) > 0 && (
                      <span title="Other leads (any state) from the same email address" className="px-2 py-0.5 rounded-full text-[11px] font-semibold border border-amber-500/30 bg-amber-500/10 text-amber-300">
                        +{lead.otherFromSameEmail} from this email
                      </span>
                    )}
                    {lead.scrubbedAt && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border border-zinc-600/40 bg-zinc-500/10 text-zinc-400">Contact removed</span>
                    )}
                    {lead.source === 'partners' && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border border-sky-500/30 bg-sky-500/10 text-sky-300">Partnership</span>
                    )}
                    {lead.status === 'won' && lead.dealValue !== null && (
                      <span className="text-xs font-semibold text-green-400">{fmtMoney(lead.dealValue, lead.currency || cur)}</span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1 truncate">
                    {lead.name} · {lead.email} · {new Date(lead.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </button>
                <select value={lead.status} onChange={e => setStatus(lead, e.target.value)}
                  className={`${inputCls} capitalize shrink-0`}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {open && (
                <div className="mt-4 pt-4 border-t border-zinc-800 space-y-4">
                  {(lead.eventVenue || lead.budgetRange) && (
                    <p className="text-xs text-zinc-400 mt-1">
                      {lead.eventVenue && <>Venue: <span className="text-zinc-200">{lead.eventVenue}</span></>}
                      {lead.eventVenue && lead.budgetRange && ' · '}
                      {lead.budgetRange && <>Stated budget: <span className="text-zinc-200">{lead.budgetRange}</span></>}
                    </p>
                  )}
                  {(lead.eventName || lead.eventWebsite) && (
                    <p className="text-xs text-zinc-400 break-words">
                      Event: <span className="text-zinc-200">{lead.eventName}</span>
                      {lead.eventDate ? ` · ${lead.eventDate}` : ''}
                      {lead.eventWebsite && /^https:\/\//i.test(lead.eventWebsite) && (
                        <> · <a href={lead.eventWebsite} target="_blank" rel="noopener noreferrer" className="text-amber-400 underline">{lead.eventWebsite}</a></>
                      )}
                    </p>
                  )}
                  <p className="text-sm text-zinc-300 whitespace-pre-wrap break-words">{lead.message}</p>
                  <div className="flex items-end gap-3 flex-wrap">
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">Deal value</label>
                      <div className="flex gap-1.5">
                        <input type="number" min={0} value={draft.dealValue}
                          onChange={e => setDrafts(prev => ({ ...prev, [lead.id]: { ...draft, dealValue: e.target.value } }))}
                          placeholder="—" className={`${inputCls} w-32`} />
                        {/* The deal's own currency — it used to take the
                            currency of whichever city the admin was viewing. */}
                        <select value={draft.currency} aria-label="Currency"
                          onChange={e => setDrafts(prev => ({ ...prev, [lead.id]: { ...draft, currency: e.target.value } }))}
                          className={`${inputCls} w-24`}>
                          {KNOWN_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
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
                    <button onClick={() => setArchivedFlag(lead, !lead.archivedAt)}
                      className="px-4 py-1.5 rounded-xl border border-zinc-700 hover:bg-zinc-800 text-zinc-300 text-sm font-semibold transition-colors">
                      {lead.archivedAt ? 'Restore' : 'Archive'}
                    </button>
                    {lead.status !== 'won' && (
                      <button onClick={() => deleteLead(lead)}
                        className="px-4 py-1.5 rounded-xl border border-red-500/40 hover:bg-red-500/10 text-red-300 text-sm font-semibold transition-colors">
                        Delete
                      </button>
                    )}
                    {!lead.scrubbedAt && <a href={`mailto:${lead.email}?subject=${encodeURIComponent(lead.source === 'partners' && lead.eventName ? `Re: ${lead.eventName} — Smileys Community` : `Smileys Community — your ${FORMAT_LABELS[lead.format] ?? 'sponsorship'} inquiry`)}`}
                      className="px-4 py-1.5 rounded-xl border border-zinc-700 hover:bg-zinc-800 text-zinc-300 text-sm font-semibold transition-colors">
                      Reply
                    </a>}
                    <button onClick={async () => {
                      const res = await fetch('/app/api/admin/partnerships', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: lead.id }) })
                      const body = await res.json().catch(() => ({}))
                      if (res.ok) toast.success('Partnership record created — see Partnerships')
                      else toast.error(body.error ?? 'Could not create the record')
                    }}
                      className="px-4 py-1.5 rounded-xl border border-zinc-700 hover:bg-zinc-800 text-zinc-300 text-sm font-semibold transition-colors">
                      Start partnership record
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {nextCursor && (
        <div className="text-center mt-5">
          <button onClick={loadMore} disabled={loadingMore}
            className="px-5 py-2 rounded-xl border border-zinc-700 hover:bg-zinc-800 text-zinc-300 text-sm font-semibold disabled:opacity-50">
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
