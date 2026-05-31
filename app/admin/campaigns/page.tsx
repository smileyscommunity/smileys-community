'use client'

// /admin/campaigns — list every sponsorship/fundraising drive on
// the platform. Each campaign carries its own Sponsor/Prize/
// Donation pool, surfaced via the count chips on each row. Drill
// into a campaign to manage its prizes + sponsors + donations.
//
// The Smileys Cup is the first one (slug: world-cup-2026); future
// tournaments and non-tournament drives get new rows here.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { type AdminCampaign, CAMPAIGN_STATUS_PILL } from '@/lib/admin/campaigns'

export default function AdminCampaignsPage() {
  const [campaigns, setCampaigns] = useState<AdminCampaign[] | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState({ slug: '', name: '', emoji: '', tagline: '', routeSlug: '' })

  function load() {
    fetch('/app/api/admin/campaigns', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.campaigns) setCampaigns(d.campaigns) })
  }
  useEffect(() => { load() }, [])

  async function create() {
    if (!draft.slug.trim() || !draft.name.trim()) { toast.error('slug + name required'); return }
    setSaving(true)
    const res = await fetch('/app/api/admin/campaigns', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...draft, routeSlug: draft.routeSlug || draft.slug, status: 'draft' }),
    })
    const d = await res.json()
    setSaving(false)
    if (!res.ok) { toast.error(d.error ?? 'Could not create'); return }
    toast.success(`"${d.campaign.name}" created`)
    setShowCreate(false)
    setDraft({ slug: '', name: '', emoji: '', tagline: '', routeSlug: '' })
    load()
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Campaigns</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Sponsorship + fundraising drives. Each one carries its own prizes + donations queue.</p>
        </div>
        <button onClick={() => setShowCreate(s => !s)}
          className="bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl px-4 py-2">
          + New campaign
        </button>
      </div>

      {showCreate && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
          <p className="text-sm font-bold text-white">Create campaign</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Slug (url-safe)*" value={draft.slug} onChange={v => setDraft({ ...draft, slug: v.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} placeholder="euros-2028" />
            <Input label="Name*" value={draft.name} onChange={v => setDraft({ ...draft, name: v })} placeholder="Smileys Euros 2028" />
            <Input label="Emoji" value={draft.emoji} onChange={v => setDraft({ ...draft, emoji: v })} placeholder="🇪🇺" />
            <Input label="Route slug" value={draft.routeSlug} onChange={v => setDraft({ ...draft, routeSlug: v })} placeholder="(defaults to slug)" />
            <div className="sm:col-span-2">
              <Input label="Tagline" value={draft.tagline} onChange={v => setDraft({ ...draft, tagline: v })} placeholder="Predict every match. Win the trophy." />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={create} disabled={saving}
              className="bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl px-4 py-2 disabled:opacity-60">
              {saving ? 'Creating…' : 'Create'}
            </button>
            <button onClick={() => setShowCreate(false)}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 text-sm rounded-xl px-4 py-2">
              Cancel
            </button>
          </div>
        </div>
      )}

      {!campaigns && <div className="text-zinc-500 text-sm py-8 text-center">Loading…</div>}
      {campaigns?.length === 0 && (
        <div className="bg-zinc-900 border border-dashed border-zinc-800 rounded-2xl py-12 text-center">
          <p className="text-2xl mb-2">📦</p>
          <p className="text-white font-semibold mb-1">No campaigns yet</p>
          <p className="text-sm text-zinc-500 mb-4">The Smileys Cup is seeded by the deploy script. Anything else (tournaments, fundraisers) gets created here.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {campaigns?.map(c => {
          // _count optional in the shared type (dedicated GET can
          // omit it); on this list endpoint it's always returned.
          const sponsors  = c._count?.sponsors         ?? 0
          const prizes    = c._count?.prizes           ?? 0
          const donations = c._count?.donations        ?? 0
          const pending   = c._count?.pendingDonations ?? 0
          return (
            // Wrapper is a plain div instead of <Link> so the "View
            // public →" link below can be a real <a> without nesting
            // anchors (HTML invalid + browsers handle it
            // inconsistently). The visible "Manage" link makes the
            // primary action explicit.
            <div key={c.id}
              className="bg-zinc-900 border border-zinc-800 hover:border-amber-500/40 rounded-2xl p-5 transition-colors">
              <Link href={`/admin/campaigns/${c.id}`} className="flex items-start gap-3 mb-3 group">
                <div className="text-2xl shrink-0">{c.emoji ?? '📢'}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-white truncate group-hover:text-amber-300 transition-colors">{c.name}</p>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${CAMPAIGN_STATUS_PILL[c.status] ?? CAMPAIGN_STATUS_PILL.draft}`}>{c.status}</span>
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-0.5 font-mono">/{c.slug}</p>
                  {c.tagline && <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{c.tagline}</p>}
                </div>
              </Link>
              <div className="flex items-center gap-3 text-[10px] text-zinc-500 border-t border-zinc-800 pt-2.5 font-semibold">
                <span>🤝 {sponsors} sponsor{sponsors === 1 ? '' : 's'}</span>
                <span>🎁 {prizes} prize{prizes === 1 ? '' : 's'}</span>
                {/* Pending count lifted out so admins can scan queue
                    depth without drilling in. Suppressed when zero
                    so the chips stay quiet during low-activity
                    periods. */}
                <span>
                  📥 {donations} donation{donations === 1 ? '' : 's'}
                  {pending > 0 && <span className="ml-1 text-amber-400">· {pending} pending</span>}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-zinc-800/60">
                <Link href={`/admin/campaigns/${c.id}`}
                  className="text-[11px] font-semibold text-amber-400 hover:text-amber-300">
                  Manage →
                </Link>
                <Link href={`/${c.routeSlug}`} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] font-semibold text-zinc-500 hover:text-white">
                  View public ↗
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500" />
    </div>
  )
}
