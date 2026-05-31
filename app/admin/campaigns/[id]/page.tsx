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

  async function act(donationId: string, action: 'approve' | 'decline') {
    const res = await fetch(`/app/api/admin/campaigns/${id}/donations`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: donationId, action }),
    })
    if (!res.ok) { toast.error('Could not update'); return }
    toast.success(action === 'approve' ? 'Approved' : 'Declined')
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

function DonationRow({ d, onAction }: { d: Donation; onAction: (id: string, action: 'approve' | 'decline') => void }) {
  const isPending = d.status === 'pending'
  const created = new Date(d.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
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
      {isPending && (
        <div className="flex gap-2 pt-2">
          <button onClick={() => onAction(d.id, 'decline')}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-semibold">
            Decline
          </button>
          <button onClick={() => onAction(d.id, 'approve')}
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 font-semibold">
            Approve
          </button>
        </div>
      )}
      {!isPending && d.reviewedBy && (
        <p className="text-[10px] text-zinc-500 mt-1">
          {d.status} by {d.reviewedBy.name}
          {d.reviewedAt && ` · ${new Date(d.reviewedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
        </p>
      )}
    </div>
  )
}
