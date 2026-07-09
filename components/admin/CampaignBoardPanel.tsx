'use client'

// Sponsors + Prizes management for a single campaign. Closes the
// admin gap where sponsors and prizes could only be created via
// the donation publish flow and could not be edited or manually
// added afterwards.
//
// Two stacked sections:
//   - Sponsors: list of CupSponsor rows, inline edit, add, delete
//   - Prizes:   list of CupPrize rows, inline edit, add, delete,
//               award-to-member
//
// Each section's mutations hit the existing global CRUD endpoints
// (/api/admin/cup/{sponsors,prizes}) so all the audit logging,
// validation, and slug-uniqueness already wired stays in play.
// Only the listing uses the campaign-scoped GET so the rows shown
// belong to this campaign alone.

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { confirmToast } from '@/lib/confirmToast'

import {
  type AdminSponsor, type AdminPrize,
  PRIZE_STATUSES, SPONSOR_STATUSES, STATUS_PILL,
} from '@/lib/admin/board'
import { isMaybeValidUrl } from '@/lib/admin/donations'
import { slugifyForCup }   from '@/lib/cup-prize-conversion'

export default function CampaignBoardPanel({ campaignId }: { campaignId: string }) {
  const [sponsors, setSponsors] = useState<AdminSponsor[] | null>(null)
  const [prizes,   setPrizes]   = useState<AdminPrize[]   | null>(null)

  const load = useCallback(() => {
    Promise.all([
      fetch(`/app/api/admin/campaigns/${campaignId}/sponsors`, { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      fetch(`/app/api/admin/campaigns/${campaignId}/prizes`,   { credentials: 'include' }).then(r => r.ok ? r.json() : null),
    ]).then(([s, p]) => {
      if (s?.sponsors) setSponsors(s.sponsors)
      if (p?.prizes)   setPrizes(p.prizes)
    })
  }, [campaignId])
  useEffect(load, [load])

  return (
    <div className="space-y-5">
      <SponsorsSection
        sponsors={sponsors} campaignId={campaignId}
        onChanged={load}
      />
      <PrizesSection
        prizes={prizes} sponsors={sponsors ?? []} campaignId={campaignId}
        onChanged={load}
      />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Sponsors
// ──────────────────────────────────────────────────────────────
function SponsorsSection({ sponsors, campaignId, onChanged }: {
  sponsors: AdminSponsor[] | null
  campaignId: string
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-white">Sponsors</h2>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            {sponsors?.length ?? '—'} on this campaign
          </p>
        </div>
        <button onClick={() => setAdding(s => !s)}
          className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 font-semibold">
          {adding ? 'Close' : '+ Add sponsor'}
        </button>
      </div>

      {adding && (
        <div className="px-5 py-4 border-b border-zinc-800 bg-zinc-950/40">
          <SponsorForm campaignId={campaignId}
            onSaved={() => { setAdding(false); onChanged() }}
            onCancel={() => setAdding(false)} />
        </div>
      )}

      {sponsors === null && (
        <p className="px-5 py-4 text-sm text-zinc-500">Loading…</p>
      )}
      {sponsors !== null && sponsors.length === 0 && !adding && (
        <p className="px-5 py-4 text-sm text-zinc-500">No sponsors yet.</p>
      )}

      <div className="divide-y divide-zinc-800">
        {sponsors?.map(s => <SponsorRow key={s.id} s={s} onChanged={onChanged} />)}
      </div>
    </div>
  )
}

function SponsorRow({ s, onChanged }: { s: AdminSponsor; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [busy,    setBusy]    = useState(false)

  async function destroy() {
    if (!(await confirmToast(`Delete sponsor "${s.name}"? Prizes tied to this sponsor lose their attribution.`))) return
    setBusy(true)
    const res = await fetch('/app/api/admin/cup/sponsors', {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id }),
    })
    setBusy(false)
    if (!res.ok) { toast.error('Delete failed'); return }
    toast.success(`Deleted ${s.name}`)
    onChanged()
  }

  return (
    <div className="px-5 py-4">
      {!editing ? (
        <div className="flex items-center gap-3">
          {s.logoUrl
            ? <img src={s.logoUrl} alt="" className="w-10 h-10 rounded-lg object-contain bg-white border border-zinc-800 shrink-0" />
            : <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-600 shrink-0">🤝</div>}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold text-white truncate">{s.name}</p>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_PILL[s.status] ?? STATUS_PILL.draft}`}>{s.status}</span>
              {(s._count?.prizes ?? 0) > 0 && (
                <span className="text-[10px] text-zinc-500">🎁 {s._count?.prizes}</span>
              )}
            </div>
            <p className="text-[10px] text-zinc-600 mt-0.5 font-mono truncate">/{s.slug}</p>
            {s.blurb && <p className="text-[11px] text-zinc-500 mt-1 line-clamp-2">{s.blurb}</p>}
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <button onClick={() => setEditing(true)} disabled={busy}
              className="text-[10px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold">
              Edit
            </button>
            <button onClick={destroy} disabled={busy}
              className="text-[10px] px-2 py-1 rounded bg-zinc-800 hover:bg-red-500/15 hover:text-red-400 text-zinc-500 font-semibold">
              Delete
            </button>
          </div>
        </div>
      ) : (
        <SponsorForm sponsor={s}
          onSaved={() => { setEditing(false); onChanged() }}
          onCancel={() => setEditing(false)} />
      )}
    </div>
  )
}

function SponsorForm({ sponsor, campaignId, onSaved, onCancel }: {
  sponsor?:   AdminSponsor
  campaignId?: string
  onSaved:    () => void
  onCancel:   () => void
}) {
  const isEdit = !!sponsor
  const [form, setForm] = useState({
    name:         sponsor?.name         ?? '',
    slug:         sponsor?.slug         ?? '',
    blurb:        sponsor?.blurb        ?? '',
    logoUrl:      sponsor?.logoUrl      ?? '',
    websiteUrl:   sponsor?.websiteUrl   ?? '',
    instagramUrl: sponsor?.instagramUrl ?? '',
    status:       sponsor?.status       ?? 'active',
  })
  const [busy, setBusy] = useState(false)

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm({ ...form, [k]: v }) }

  async function save() {
    if (!form.name.trim()) { toast.error('Name required'); return }
    if (!isMaybeValidUrl(form.logoUrl))      { toast.error('Logo URL: http(s):// or blank'); return }
    if (!isMaybeValidUrl(form.websiteUrl))   { toast.error('Website URL: http(s):// or blank'); return }
    if (!isMaybeValidUrl(form.instagramUrl)) { toast.error('Instagram URL: http(s):// or blank'); return }
    setBusy(true)
    const body: Record<string, unknown> = {
      name:         form.name.trim(),
      slug:         form.slug.trim() || slugifyForCup(form.name),
      blurb:        form.blurb.trim()        || null,
      logoUrl:      form.logoUrl.trim()      || null,
      websiteUrl:   form.websiteUrl.trim()   || null,
      instagramUrl: form.instagramUrl.trim() || null,
      status:       form.status,
    }
    if (isEdit) {
      body.id = sponsor.id
    } else if (campaignId) {
      body.campaignId = campaignId
    }
    const res = await fetch('/app/api/admin/cup/sponsors', {
      method: isEdit ? 'PATCH' : 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { toast.error(d.error ?? 'Save failed'); return }
    toast.success(isEdit ? 'Updated' : 'Created')
    onSaved()
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label="Name*"><input className={inputCls} value={form.name}
          onChange={e => { const v = e.target.value; setForm({ ...form, name: v, slug: form.slug === slugifyForCup(form.name) ? slugifyForCup(v) : form.slug }) }} /></Field>
        <Field label="Slug"><input className={inputCls} value={form.slug} onChange={e => set('slug', e.target.value)} placeholder="auto" /></Field>
        <div className="sm:col-span-2">
          <Field label="Blurb"><input className={inputCls} value={form.blurb} onChange={e => set('blurb', e.target.value)} placeholder="A modern restaurant in Beyoğlu." /></Field>
        </div>
        <Field label="Logo URL"><input className={inputCls} value={form.logoUrl} onChange={e => set('logoUrl', e.target.value)} placeholder="https://…" /></Field>
        <Field label="Website URL"><input className={inputCls} value={form.websiteUrl} onChange={e => set('websiteUrl', e.target.value)} placeholder="https://…" /></Field>
        <Field label="Instagram URL"><input className={inputCls} value={form.instagramUrl} onChange={e => set('instagramUrl', e.target.value)} placeholder="https://…" /></Field>
        <Field label="Status">
          <select className={inputCls} value={form.status} onChange={e => set('status', e.target.value)}>
            {SPONSOR_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-semibold">Cancel</button>
        <button onClick={save} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Prizes
// ──────────────────────────────────────────────────────────────
function PrizesSection({ prizes, sponsors, campaignId, onChanged }: {
  prizes:    AdminPrize[] | null
  sponsors:  AdminSponsor[]
  campaignId: string
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-white">Prizes</h2>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            {prizes?.length ?? '—'} on this campaign
          </p>
        </div>
        <button onClick={() => setAdding(s => !s)}
          className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 font-semibold">
          {adding ? 'Close' : '+ Add prize'}
        </button>
      </div>

      {adding && (
        <div className="px-5 py-4 border-b border-zinc-800 bg-zinc-950/40">
          <PrizeForm sponsors={sponsors} campaignId={campaignId}
            onSaved={() => { setAdding(false); onChanged() }}
            onCancel={() => setAdding(false)} />
        </div>
      )}

      {prizes === null && <p className="px-5 py-4 text-sm text-zinc-500">Loading…</p>}
      {prizes !== null && prizes.length === 0 && !adding && (
        <p className="px-5 py-4 text-sm text-zinc-500">No prizes yet.</p>
      )}

      <div className="divide-y divide-zinc-800">
        {prizes?.map(p => <PrizeRow key={p.id} p={p} sponsors={sponsors} onChanged={onChanged} />)}
      </div>
    </div>
  )
}

const RANK_LABEL: Record<string, string> = { '1': '🥇 1st', '2': '🥈 2nd', '3': '🥉 3rd' }

function PrizeRow({ p, sponsors, onChanged }: {
  p: AdminPrize
  sponsors: AdminSponsor[]
  onChanged: () => void
}) {
  const [editing,  setEditing]  = useState(false)
  const [awarding, setAwarding] = useState(false)
  const [busy,     setBusy]     = useState(false)

  async function destroy() {
    if (!(await confirmToast(`Delete prize "${p.title}"?`))) return
    setBusy(true)
    const res = await fetch('/app/api/admin/cup/prizes', {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id }),
    })
    setBusy(false)
    if (!res.ok) { toast.error('Delete failed'); return }
    toast.success(`Deleted ${p.title}`)
    onChanged()
  }

  async function unaward() {
    if (!(await confirmToast(`Remove the award from "${p.title}"? The prize will go back to active.`))) return
    setBusy(true)
    const res = await fetch('/app/api/admin/cup/prizes', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, awardedToUserId: null, status: 'active' }),
    })
    setBusy(false)
    if (!res.ok) { toast.error('Update failed'); return }
    toast.success('Award removed')
    onChanged()
  }

  return (
    <div className="px-5 py-4">
      {!editing && !awarding ? (
        <div className="flex items-start gap-3">
          {p.imageUrl
            ? <img src={p.imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
            : p.sponsor?.logoUrl
              ? <img src={p.sponsor.logoUrl} alt="" className="w-12 h-12 rounded-lg object-contain bg-white border border-zinc-800 shrink-0" />
              : <div className="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-600 shrink-0">🎁</div>}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold text-white">{p.title}</p>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_PILL[p.status] ?? STATUS_PILL.draft}`}>{p.status}</span>
              {p.rank && <span className="text-[10px] text-amber-400 font-bold">{RANK_LABEL[String(p.rank)]}</span>}
            </div>
            {p.sponsor && <p className="text-[10px] text-zinc-500 mt-0.5">via {p.sponsor.name}</p>}
            {p.description && <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2 leading-relaxed">{p.description}</p>}
            {p.awardedTo && (
              <p className="text-[10px] text-amber-400 mt-1 font-semibold">
                🏆 Awarded to {p.awardedTo.name}
                {p.awardedAt && ` · ${new Date(p.awardedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <button onClick={() => setEditing(true)} disabled={busy}
              className="text-[10px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold">Edit</button>
            {p.awardedTo
              ? <button onClick={unaward} disabled={busy}
                  className="text-[10px] px-2 py-1 rounded bg-zinc-800 hover:bg-amber-500/15 hover:text-amber-400 text-zinc-500 font-semibold">Unaward</button>
              : <button onClick={() => setAwarding(true)} disabled={busy}
                  className="text-[10px] px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/25 text-emerald-400 font-semibold">Award →</button>}
            <button onClick={destroy} disabled={busy}
              className="text-[10px] px-2 py-1 rounded bg-zinc-800 hover:bg-red-500/15 hover:text-red-400 text-zinc-500 font-semibold">Delete</button>
          </div>
        </div>
      ) : awarding ? (
        <AwardForm prize={p}
          onSaved={() => { setAwarding(false); onChanged() }}
          onCancel={() => setAwarding(false)} />
      ) : (
        <PrizeForm prize={p} sponsors={sponsors}
          onSaved={() => { setEditing(false); onChanged() }}
          onCancel={() => setEditing(false)} />
      )}
    </div>
  )
}

function PrizeForm({ prize, sponsors, campaignId, onSaved, onCancel }: {
  prize?:     AdminPrize
  sponsors:   AdminSponsor[]
  campaignId?: string
  onSaved:    () => void
  onCancel:   () => void
}) {
  const isEdit = !!prize
  const [form, setForm] = useState({
    title:       prize?.title       ?? '',
    description: prize?.description ?? '',
    imageUrl:    prize?.imageUrl    ?? '',
    rank:        prize?.rank        ? String(prize.rank) : '',
    sponsorId:   prize?.sponsorId   ?? '',
    status:      prize?.status      ?? 'active',
  })
  const [busy, setBusy] = useState(false)

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm({ ...form, [k]: v }) }

  async function save() {
    if (!form.title.trim()) { toast.error('Title required'); return }
    if (!isMaybeValidUrl(form.imageUrl)) { toast.error('Image URL: http(s):// or blank'); return }
    setBusy(true)
    const body: Record<string, unknown> = {
      title:       form.title.trim(),
      description: form.description.trim() || null,
      imageUrl:    form.imageUrl.trim()    || null,
      rank:        form.rank ? Number(form.rank) : null,
      sponsorId:   form.sponsorId || null,
      status:      form.status,
    }
    if (isEdit) {
      body.id = prize.id
    } else if (campaignId) {
      body.campaignId = campaignId
    }
    const res = await fetch('/app/api/admin/cup/prizes', {
      method: isEdit ? 'PATCH' : 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { toast.error(d.error ?? 'Save failed'); return }
    toast.success(isEdit ? 'Updated' : 'Created')
    onSaved()
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="sm:col-span-2">
          <Field label="Title*"><input className={inputCls} value={form.title} onChange={e => set('title', e.target.value)} /></Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Description"><textarea rows={2} className={`${inputCls} resize-none`} value={form.description} onChange={e => set('description', e.target.value)} /></Field>
        </div>
        <Field label="Image URL"><input className={inputCls} value={form.imageUrl} onChange={e => set('imageUrl', e.target.value)} placeholder="https://…" /></Field>
        <Field label="Sponsor">
          <select className={inputCls} value={form.sponsorId} onChange={e => set('sponsorId', e.target.value)}>
            <option value="">— no sponsor —</option>
            {sponsors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Rank">
          <select className={inputCls} value={form.rank} onChange={e => set('rank', e.target.value)}>
            <option value="">Spot prize</option>
            <option value="1">🥇 1st</option>
            <option value="2">🥈 2nd</option>
            <option value="3">🥉 3rd</option>
          </select>
        </Field>
        <Field label="Status">
          <select className={inputCls} value={form.status} onChange={e => set('status', e.target.value)}>
            {PRIZE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-semibold">Cancel</button>
        <button onClick={save} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}

// Award flow — small member search that hits the existing
// /api/admin/users?search=… endpoint, then PATCHes the prize with
// the chosen userId. Sets the prize status to 'awarded' as a
// side-effect so the chip turns amber on the public board.
function AwardForm({ prize, onSaved, onCancel }: {
  prize:    AdminPrize
  onSaved:  () => void
  onCancel: () => void
}) {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState<{ id: string; name: string; email?: string }[]>([])
  const [busy,    setBusy]    = useState(false)

  // Debounced search so each keystroke doesn't hammer the API.
  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const t = setTimeout(async () => {
      const res = await fetch(`/app/api/admin/users?search=${encodeURIComponent(query.trim())}&take=10`, { credentials: 'include' })
      if (!res.ok) return
      const d = await res.json()
      // Different versions of /api/admin/users may key this
      // differently; accept either shape.
      const list = Array.isArray(d?.users) ? d.users : Array.isArray(d) ? d : []
      setResults(list.map((u: { id: string; name: string; email?: string }) => ({ id: u.id, name: u.name, email: u.email })))
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  async function award(userId: string, userName: string) {
    if (!(await confirmToast(`Award "${prize.title}" to ${userName}?`))) return
    setBusy(true)
    const res = await fetch('/app/api/admin/cup/prizes', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: prize.id, awardedToUserId: userId, status: 'awarded' }),
    })
    setBusy(false)
    if (!res.ok) { toast.error('Award failed'); return }
    toast.success(`Awarded to ${userName}`)
    onSaved()
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-bold text-amber-400">Award &ldquo;{prize.title}&rdquo;</p>
      <Field label="Search by name or email">
        <input className={inputCls} value={query} onChange={e => setQuery(e.target.value)} placeholder="Type to search…" autoFocus />
      </Field>
      {results.length > 0 && (
        <div className="divide-y divide-zinc-800 border border-zinc-800 rounded-lg max-h-48 overflow-y-auto">
          {results.map(u => (
            <button key={u.id} onClick={() => award(u.id, u.name)} disabled={busy}
              className="w-full text-left px-3 py-2 hover:bg-zinc-800 disabled:opacity-50">
              <p className="text-xs font-semibold text-white">{u.name}</p>
              {u.email && <p className="text-[10px] text-zinc-500">{u.email}</p>}
            </button>
          ))}
        </div>
      )}
      {query.trim() && results.length === 0 && !busy && (
        <p className="text-xs text-zinc-500">No matches.</p>
      )}
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-semibold">Cancel</button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Shared form bits
// ──────────────────────────────────────────────────────────────
const inputCls = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  )
}
