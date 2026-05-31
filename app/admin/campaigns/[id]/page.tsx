'use client'

// /admin/campaigns/[id] — single campaign detail. Header with
// status + dates, embedded donations queue (scoped to this
// campaign), and quick links to the prize/sponsor admin routes.
//
// For the world-cup-2026 campaign, the existing /admin/cup page
// still owns fixture/result entry — this surface complements it
// by handling the donate flow side.

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'

interface Campaign {
  id: string; slug: string; name: string
  emoji: string | null; tagline: string | null; description: string | null
  coverImage: string | null; status: string; routeSlug: string
  startsAt: string | null; endsAt: string | null
}

interface Donation {
  id: string
  donorName: string; donorEmail: string; donorOrganization: string | null; donorPhone: string | null
  prizeTitle: string; prizeDescription: string; estimatedValue: number | null; notes: string | null
  status: 'pending' | 'approved' | 'declined' | string
  reviewedAt: string | null; reviewNote: string | null
  reviewedBy: { id: string; name: string } | null
  linkedSponsorId: string | null; linkedPrizeId: string | null
  createdAt: string
}

const STATUS_PILL: Record<string, string> = {
  draft:    'bg-zinc-700 text-zinc-400',
  active:   'bg-emerald-500/10 text-emerald-400',
  wrapped:  'bg-amber-500/10 text-amber-400',
  archived: 'bg-zinc-800 text-zinc-500',
}

export default function AdminCampaignDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [campaign,  setCampaign]  = useState<Campaign | null>(null)
  const [donations, setDonations] = useState<Donation[] | null>(null)
  const [showResolved, setShowResolved] = useState(false)

  function load() {
    Promise.all([
      fetch('/app/api/admin/campaigns', { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      fetch(`/app/api/admin/campaigns/${id}/donations`, { credentials: 'include' }).then(r => r.ok ? r.json() : null),
    ]).then(([cList, dRes]) => {
      const found = cList?.campaigns?.find((c: Campaign) => c.id === id)
      if (found) setCampaign(found)
      if (dRes?.donations) setDonations(dRes.donations)
    })
  }
  useEffect(load, [id])

  async function act(donationId: string, action: 'approve' | 'decline', body?: Record<string, unknown>) {
    const res = await fetch(`/app/api/admin/campaigns/${id}/donations`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: donationId, action, ...(body ?? {}) }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Could not update')
      return
    }
    toast.success(action === 'approve' ? (body ? 'Published 🎉' : 'Approved') : 'Declined')
    load()
  }

  if (!campaign) return <div className="p-6 text-zinc-500 text-sm">Loading…</div>

  const isCup = campaign.slug === 'world-cup-2026'
  const pending  = (donations ?? []).filter(d => d.status === 'pending')
  const resolved = (donations ?? []).filter(d => d.status !== 'pending')

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl">
      <div className="flex items-center gap-3 text-xs text-zinc-500">
        <Link href="/admin/campaigns" className="hover:text-amber-400">← Campaigns</Link>
        <span>/</span>
        <span className="font-mono">{campaign.slug}</span>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
        <div className="flex items-start gap-3 mb-3">
          <span className="text-3xl shrink-0">{campaign.emoji ?? '📢'}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-extrabold text-white">{campaign.name}</h1>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_PILL[campaign.status] ?? STATUS_PILL.draft}`}>{campaign.status}</span>
            </div>
            {campaign.tagline && <p className="text-sm text-zinc-400 mt-1">{campaign.tagline}</p>}
            {(campaign.startsAt || campaign.endsAt) && (
              <p className="text-xs text-zinc-500 mt-2">
                {campaign.startsAt ? new Date(campaign.startsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                {' → '}
                {campaign.endsAt   ? new Date(campaign.endsAt).toLocaleDateString('en-GB',   { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
              </p>
            )}
          </div>
        </div>
        {isCup && (
          <div className="border-t border-zinc-800 pt-3 mt-3 flex flex-wrap gap-2">
            <Link href="/admin/cup" className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 font-semibold">
              Fixtures + results →
            </Link>
            <Link href={`/${campaign.routeSlug}`} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold">
              View public page →
            </Link>
          </div>
        )}
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">Prize donations</h2>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              {pending.length} pending · {resolved.length} reviewed
            </p>
          </div>
        </div>

        {pending.length === 0 && resolved.length === 0 && (
          <p className="px-5 py-4 text-sm text-zinc-500">No donations yet.</p>
        )}

        <div className="divide-y divide-zinc-800">
          {pending.map(d => <DonationRow key={d.id} d={d} onAction={act} />)}
        </div>

        {resolved.length > 0 && (
          <>
            <button onClick={() => setShowResolved(s => !s)}
              className="w-full px-5 py-3 text-left border-t border-zinc-800 text-xs font-semibold text-zinc-500 hover:text-white transition-colors">
              {showResolved ? '↑ Hide' : '↓ Show'} {resolved.length} reviewed
            </button>
            {showResolved && (
              <div className="divide-y divide-zinc-800 border-t border-zinc-800">
                {resolved.map(d => <DonationRow key={d.id} d={d} onAction={act} />)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function DonationRow({ d, onAction }: { d: Donation; onAction: (id: string, action: 'approve' | 'decline', body?: Record<string, unknown>) => void }) {
  const isPending = d.status === 'pending'
  const created = new Date(d.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  // Inline approve-and-publish form. Pre-filled from the donation
  // so admin can usually hit Save without editing.
  const [showForm, setShowForm] = useState(false)
  const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  const defaultSponsorName = d.donorOrganization?.trim() || d.donorName
  const [form, setForm] = useState({
    sponsorName:   defaultSponsorName,
    sponsorSlug:   slugify(defaultSponsorName),
    sponsorBlurb:  '',
    sponsorLogoUrl:    '',
    sponsorWebsiteUrl: '',
    prizeTitle:       d.prizeTitle,
    prizeDescription: d.prizeDescription,
    prizeRank:        '' as '' | '1' | '2' | '3',
  })
  const [publishing, setPublishing] = useState(false)

  async function publish() {
    if (!form.prizeTitle.trim()) { toast.error('Prize title required'); return }
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
        slug:        form.sponsorSlug.trim() || slugify(form.sponsorName),
        blurb:       form.sponsorBlurb.trim() || null,
        logoUrl:     form.sponsorLogoUrl.trim() || null,
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
          {d.estimatedValue !== null && <span className="text-[10px] text-zinc-500">~₺{d.estimatedValue.toLocaleString()}</span>}
        </div>
        <span className="text-[10px] text-zinc-600">{created}</span>
      </div>
      <p className="text-xs text-zinc-300 mb-2 leading-relaxed whitespace-pre-wrap">{d.prizeDescription}</p>
      {d.notes && <p className="text-[10px] text-zinc-500 mb-2 italic">Note: {d.notes}</p>}
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
            Approve &amp; publish →
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
          {d.linkedPrizeId && ' · published'}
        </p>
      )}
    </div>
  )
}

// Inline publish form — sponsor + prize fields pre-filled from
// the donation. Admin can tweak anything before committing. Saves
// in one transaction via the API's approve-with-conversion path.
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
  const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
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
              onChange={e => { const v = e.target.value; setForm({ ...form, sponsorName: v, sponsorSlug: form.sponsorSlug === slugify(form.sponsorName) ? slugify(v) : form.sponsorSlug }) }}
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
