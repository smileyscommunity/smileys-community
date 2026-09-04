'use client'

// Shared donation row for /admin/cup and /admin/campaigns/[id].
// Renders a single CupPrizeDonation with the three review actions
// (Decline / Approve & publish / Approve only) and an inline
// publish form pre-filled from the donation fields.
//
// The two host pages each provide their own `onAction` that fires
// the PATCH to the right endpoint — this component stays endpoint-
// agnostic. Previously the row, the form, the field wrapper, the
// slugify helper, AND the input class string were duplicated
// verbatim across both pages (~200 lines). Drift was a matter of
// time.

import { useState } from 'react'
import { toast } from 'sonner'
import { type AdminDonation, isMaybeValidUrl } from '@/lib/admin/donations'
// Canonical slug helper lives in lib/cup-prize-conversion.ts — same
// rules the server enforces when it writes the row, so the preview
// in this form matches the slug allocated at publish time.
import { slugifyForCup } from '@/lib/cup-prize-conversion'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import { DEFAULT_CURRENCY, formatMoney, currencySymbol } from '@/lib/data'

interface Props {
  d:        AdminDonation
  onAction: (id: string, action: 'approve' | 'decline', body?: Record<string, unknown>) => Promise<void> | void
}

export default function DonationRow({ d, onAction }: Props) {
  const cur = useCurrentCity()?.currency ?? DEFAULT_CURRENCY
  const isPending = d.status === 'pending'
  const created   = new Date(d.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  // Inline approve-and-publish form. Pre-filled from the donation
  // so admin can usually hit Publish without editing.
  const [showForm,  setShowForm]  = useState(false)
  const defaultSponsorName = d.donorOrganization?.trim() || d.donorName
  const [form,      setForm]      = useState({
    sponsorName:       defaultSponsorName,
    sponsorSlug:       slugifyForCup(defaultSponsorName),
    sponsorBlurb:      '',
    sponsorLogoUrl:    '',
    sponsorWebsiteUrl: '',
    prizeTitle:        d.prizeTitle,
    prizeDescription:  d.prizeDescription,
    prizeRank:         '' as '' | '1' | '2' | '3',
  })
  const [publishing, setPublishing] = useState(false)

  async function publish() {
    if (!form.prizeTitle.trim()) { toast.error('Prize title required'); return }
    if (!isMaybeValidUrl(form.sponsorLogoUrl))    { toast.error('Logo URL needs http(s):// or leave blank');    return }
    if (!isMaybeValidUrl(form.sponsorWebsiteUrl)) { toast.error('Website URL needs http(s):// or leave blank'); return }
    setPublishing(true)
    const body: Record<string, unknown> = {
      prize: {
        title:       form.prizeTitle.trim(),
        description: form.prizeDescription.trim() || null,
        rank:        form.prizeRank ? Number(form.prizeRank) : null,
      },
    }
    if (form.sponsorName.trim()) {
      body.sponsor = {
        name:        form.sponsorName.trim(),
        slug:        form.sponsorSlug.trim() || slugifyForCup(form.sponsorName),
        blurb:       form.sponsorBlurb.trim()      || null,
        logoUrl:     form.sponsorLogoUrl.trim()    || null,
        websiteUrl:  form.sponsorWebsiteUrl.trim() || null,
      }
    }
    await onAction(d.id, 'approve', body)
    setPublishing(false)
    setShowForm(false)
  }

  return (
    <div className={`px-5 py-4 ${isPending ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {!isPending && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              d.status === 'approved' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-700 text-zinc-400'
            }`}>{d.status}</span>
          )}
          <p className="text-sm font-bold text-white">{d.prizeTitle}</p>
          {d.estimatedValue !== null && (
            <span className="text-[10px] text-zinc-500">~{formatMoney(d.estimatedValue, cur)}</span>
          )}
        </div>
        <span className="text-[10px] text-zinc-600">{created}</span>
      </div>
      <p className="text-xs text-zinc-300 mb-2 leading-relaxed whitespace-pre-wrap">{d.prizeDescription}</p>
      {d.notes && (
        <p className="text-[10px] text-zinc-500 mb-2 italic">Note: {d.notes}</p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-zinc-500 mb-2">
        <span className="font-semibold text-zinc-400">{d.donorName}</span>
        {d.donorOrganization && <span>· {d.donorOrganization}</span>}
        <a href={`mailto:${d.donorEmail}`} className="text-amber-500 hover:underline">{d.donorEmail}</a>
        {d.donorPhone && <a href={`tel:${d.donorPhone}`} className="text-zinc-400 hover:text-amber-500">{d.donorPhone}</a>}
      </div>
      {isPending && !showForm && (
        <div className="flex gap-2 pt-2">
          <button onClick={() => onAction(d.id, 'decline')}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-semibold">
            Decline
          </button>
          <button onClick={() => setShowForm(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 font-semibold">
            Publish prize →
          </button>
          <button onClick={() => onAction(d.id, 'approve')}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-500 font-semibold ml-auto"
            title="Approve without creating the public sponsor/prize entries — for offers that need follow-up first.">
            Approve only
          </button>
        </div>
      )}
      {isPending && showForm && (
        <PublishForm
          form={form} setForm={setForm}
          publishing={publishing}
          onCancel={() => setShowForm(false)}
          onPublish={publish}
        />
      )}
      {!isPending && d.reviewedBy && (
        <p className="text-[10px] text-zinc-500 mt-1">
          {d.status} by {d.reviewedBy.name}
          {d.reviewedAt && ` · ${new Date(d.reviewedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
          {d.linkedPrizeId && ' · ✓ published'}
        </p>
      )}
    </div>
  )
}

// Sponsor + prize fields pre-filled from the donation. Admin can
// tweak any value before committing. Single transaction via the
// API's approve-with-conversion path (lib/cup-prize-conversion.ts).
function PublishForm({ form, setForm, publishing, onCancel, onPublish }: {
  form: {
    sponsorName: string; sponsorSlug: string; sponsorBlurb: string
    sponsorLogoUrl: string; sponsorWebsiteUrl: string
    prizeTitle: string; prizeDescription: string
    prizeRank: '' | '1' | '2' | '3'
  }
  setForm: (v: typeof form) => void
  publishing: boolean
  onCancel: () => void
  onPublish: () => void
}) {
  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm({ ...form, [key]: value })
  }
  return (
    <div className="mt-3 pt-3 border-t border-zinc-800 space-y-4">
      <div className="space-y-2">
        <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Sponsor</p>
        <p className="text-[10px] text-zinc-500">Leave blank if you don&apos;t want a public sponsor credit (e.g. internal donation).</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field label="Name">
            <input type="text" value={form.sponsorName}
              onChange={e => { const v = e.target.value; setForm({ ...form, sponsorName: v, sponsorSlug: form.sponsorSlug === slugifyForCup(form.sponsorName) ? slugifyForCup(v) : form.sponsorSlug }) }}
              className={inputCls} />
          </Field>
          <Field label="Slug">
            <input type="text" value={form.sponsorSlug} onChange={e => set('sponsorSlug', e.target.value)}
              className={inputCls} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Blurb (1–2 lines)">
              <input type="text" value={form.sponsorBlurb} onChange={e => set('sponsorBlurb', e.target.value)}
                className={inputCls} placeholder="A modern restaurant in Beyoğlu." />
            </Field>
          </div>
          <Field label="Logo URL">
            <input type="text" value={form.sponsorLogoUrl} onChange={e => set('sponsorLogoUrl', e.target.value)}
              className={inputCls} placeholder="https://…" />
          </Field>
          <Field label="Website URL">
            <input type="text" value={form.sponsorWebsiteUrl} onChange={e => set('sponsorWebsiteUrl', e.target.value)}
              className={inputCls} placeholder="https://…" />
          </Field>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Prize</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="sm:col-span-2">
            <Field label="Title">
              <input type="text" value={form.prizeTitle} onChange={e => set('prizeTitle', e.target.value)}
                className={inputCls} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Description">
              <textarea rows={2} value={form.prizeDescription} onChange={e => set('prizeDescription', e.target.value)}
                className={`${inputCls} resize-none`} />
            </Field>
          </div>
          <Field label="Rank">
            <select value={form.prizeRank} onChange={e => set('prizeRank', e.target.value as '' | '1' | '2' | '3')}
              className={inputCls}>
              <option value="">Spot prize</option>
              <option value="1">🥇 1st</option>
              <option value="2">🥈 2nd</option>
              <option value="3">🥉 3rd</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onCancel} disabled={publishing}
          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-semibold">
          Cancel
        </button>
        <button onClick={onPublish} disabled={publishing}
          className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-bold disabled:opacity-60">
          {publishing ? 'Publishing…' : 'Publish prize 🎉'}
        </button>
      </div>
    </div>
  )
}

const inputCls = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  )
}
