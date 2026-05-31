'use client'

// /admin/campaigns/[id] — single campaign detail. Header with
// status + dates, inline Edit panel (name/emoji/tagline/status/
// dates/routeSlug), then a tab pane:
//   - Donations: queue of pending/reviewed CupPrizeDonations
//     scoped to this campaign, with the shared <DonationRow />
//     publish form
//   - Fixtures + results (only when campaign.hasFixtures): the
//     full cup-fixture admin extracted from the now-deleted
//     /admin/cup page
//
// Active tab is mirrored to ?tab= so refreshes + bookmarks land
// where the admin left off. Pre-consolidation the fixtures tab
// was a standalone /admin/cup page with its own nav row; folding
// both surfaces into the same campaign-detail page kills the
// last bit of admin nav duplication.

import { useEffect, useState } from 'react'
import { useParams, useSearchParams, useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'

import { type AdminCampaign, CAMPAIGN_STATUS_PILL, CAMPAIGN_STATUSES, type CampaignStatus } from '@/lib/admin/campaigns'
import { type AdminDonation } from '@/lib/admin/donations'
import DonationRow      from '@/components/admin/DonationRow'
import CupFixturesPanel from '@/components/admin/CupFixturesPanel'

type Tab = 'donations' | 'fixtures'

export default function AdminCampaignDetailPage() {
  const { id }       = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()

  const [campaign,  setCampaign]  = useState<AdminCampaign | null>(null)
  const [donations, setDonations] = useState<AdminDonation[] | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const [editing,   setEditing]   = useState(false)

  // Active tab from URL. Defaults to donations (matches the
  // pre-tab behavior of the page). Setter writes back to ?tab=
  // via shallow router.replace so the browser back button doesn't
  // get polluted with one history entry per tab switch.
  const tabParam = searchParams.get('tab')
  const tab: Tab = tabParam === 'fixtures' ? 'fixtures' : 'donations'
  function setTab(t: Tab) {
    const next = new URLSearchParams(searchParams.toString())
    if (t === 'donations') next.delete('tab')
    else                   next.set('tab', t)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  function load() {
    Promise.all([
      // Dedicated GET — fetches only the campaign we render rather
      // than the entire collection + Array.find() client-side.
      fetch(`/app/api/admin/campaigns/${id}`, { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      fetch(`/app/api/admin/campaigns/${id}/donations`, { credentials: 'include' }).then(r => r.ok ? r.json() : null),
    ]).then(([cRes, dRes]) => {
      if (cRes?.campaign)  setCampaign(cRes.campaign)
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
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${CAMPAIGN_STATUS_PILL[campaign.status] ?? CAMPAIGN_STATUS_PILL.draft}`}>{campaign.status}</span>
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
          <button onClick={() => setEditing(s => !s)}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold shrink-0">
            {editing ? 'Close' : 'Edit'}
          </button>
        </div>
        <div className="border-t border-zinc-800 pt-3 mt-3 flex flex-wrap gap-2">
          <Link href={`/${campaign.routeSlug}`} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold">
            View public page →
          </Link>
        </div>
      </div>

      {editing && (
        <EditPanel campaign={campaign} onSaved={c => { setCampaign(c); setEditing(false) }} onCancel={() => setEditing(false)} />
      )}

      {/* Tab nav. Only renders the Fixtures tab when the campaign
          carries a fixtures admin surface (hasFixtures = true; set
          by the seed for world-cup-2026 and any future tournament).
          For donation-only campaigns the donations pane is the only
          thing surfaced — no tab chrome at all. */}
      {campaign.hasFixtures ? (
        <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 w-fit">
          <TabButton active={tab === 'donations'} onClick={() => setTab('donations')}>
            Donations {pending.length > 0 && <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-amber-500/20 text-amber-300">{pending.length}</span>}
          </TabButton>
          <TabButton active={tab === 'fixtures'} onClick={() => setTab('fixtures')}>
            Fixtures + results
          </TabButton>
        </div>
      ) : null}

      {tab === 'donations' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-white">Prize donations</h2>
              <p className="text-[10px] text-zinc-500 mt-0.5">
                {pending.length} pending · {resolved.length} reviewed
              </p>
            </div>
          </div>

          {donations === null && (
            <p className="px-5 py-4 text-sm text-zinc-500">Loading donations…</p>
          )}
          {donations !== null && pending.length === 0 && resolved.length === 0 && (
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
      )}

      {tab === 'fixtures' && campaign.hasFixtures && <CupFixturesPanel />}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors inline-flex items-center ${
        active ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white'
      }`}>
      {children}
    </button>
  )
}

// Inline edit panel. Hits PATCH /api/admin/campaigns with the
// fields the admin changed, plus exposes a destructive Delete
// button (cascades to sponsors/prizes/donations server-side; the
// API refuses the deletion for the protected world-cup-2026 slug
// so the cup row stays live). Only re-renders when the admin
// opens it so the form state resets cleanly between sessions.
function EditPanel({ campaign, onSaved, onCancel }: {
  campaign: AdminCampaign
  onSaved:  (c: AdminCampaign) => void
  onCancel: () => void
}) {
  const router = useRouter()
  const isCupSlug = campaign.slug === 'world-cup-2026'
  const [draft, setDraft] = useState({
    name:        campaign.name,
    emoji:       campaign.emoji ?? '',
    tagline:     campaign.tagline ?? '',
    description: campaign.description ?? '',
    status:      campaign.status as CampaignStatus,
    routeSlug:   campaign.routeSlug,
    startsAt:    campaign.startsAt ? campaign.startsAt.slice(0, 10) : '',
    endsAt:      campaign.endsAt   ? campaign.endsAt.slice(0, 10)   : '',
  })
  const [saving,    setSaving]    = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  // Two-step delete confirm — first click reveals the typed-name
  // gate, second click (after the name matches) actually fires.
  // window.confirm is too easy to dismiss without reading; a
  // type-the-name-to-confirm makes the destructive action
  // deliberate without needing a modal library.
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  async function save() {
    if (!draft.name.trim()) { toast.error('Name required'); return }
    setSaving(true)
    const body: Record<string, unknown> = {
      id:          campaign.id,
      name:        draft.name.trim(),
      emoji:       draft.emoji.trim(),
      tagline:     draft.tagline.trim(),
      description: draft.description.trim(),
      status:      draft.status,
      routeSlug:   draft.routeSlug.trim() || campaign.slug,
      startsAt:    draft.startsAt || null,
      endsAt:      draft.endsAt   || null,
    }
    const res = await fetch('/app/api/admin/campaigns', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { toast.error(d.error ?? 'Save failed'); return }
    toast.success('Saved')
    // The PATCH response returns the campaign without _count + hasFixtures
    // (the GET endpoint adds those). Preserve those from current state.
    onSaved({ ...campaign, ...d.campaign })
  }

  async function destroy() {
    if (deleteConfirmText.trim() !== campaign.name.trim()) {
      toast.error('Name doesn\'t match — type the exact campaign name to confirm')
      return
    }
    setDeleting(true)
    const res = await fetch('/app/api/admin/campaigns', {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: campaign.id }),
    })
    const d = await res.json().catch(() => ({}))
    setDeleting(false)
    if (!res.ok) { toast.error(d.error ?? 'Delete failed'); return }
    toast.success(`Deleted "${campaign.name}"`)
    router.push('/admin/campaigns')
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-white">Edit campaign</p>
        <span className="text-[10px] text-zinc-500 font-mono">/{campaign.slug}{isCupSlug ? ' · protected' : ''}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <EditField label="Name*">
          <input className={editInputCls} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
        </EditField>
        <EditField label="Emoji">
          <input className={editInputCls} value={draft.emoji} onChange={e => setDraft({ ...draft, emoji: e.target.value })} placeholder="⚽" />
        </EditField>
        <div className="sm:col-span-2">
          <EditField label="Tagline">
            <input className={editInputCls} value={draft.tagline} onChange={e => setDraft({ ...draft, tagline: e.target.value })} />
          </EditField>
        </div>
        <div className="sm:col-span-2">
          <EditField label="Description">
            <textarea rows={3} className={`${editInputCls} resize-none`} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} />
          </EditField>
        </div>
        <EditField label="Status">
          <select className={editInputCls} value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as CampaignStatus })}>
            {CAMPAIGN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </EditField>
        <EditField label="Route slug">
          <input className={editInputCls} value={draft.routeSlug} onChange={e => setDraft({ ...draft, routeSlug: e.target.value })} />
        </EditField>
        <EditField label="Starts at">
          <input type="date" className={editInputCls} value={draft.startsAt} onChange={e => setDraft({ ...draft, startsAt: e.target.value })} />
        </EditField>
        <EditField label="Ends at">
          <input type="date" className={editInputCls} value={draft.endsAt} onChange={e => setDraft({ ...draft, endsAt: e.target.value })} />
        </EditField>
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        {/* Delete lives on the left so it doesn't sit between Cancel
            and Save (no accidental clicks). Hidden for the protected
            cup row — the server refuses the call there anyway, but
            no point surfacing a button that always errors. */}
        <div>
          {!isCupSlug && !showDeleteConfirm && (
            <button onClick={() => setShowDeleteConfirm(true)} disabled={saving}
              className="text-xs px-3 py-2 rounded-lg bg-zinc-800 hover:bg-red-500/15 hover:text-red-400 text-zinc-500 font-semibold disabled:opacity-60">
              Delete campaign…
            </button>
          )}
          {isCupSlug && (
            <span className="text-[10px] text-zinc-600">Protected campaign · cannot delete</span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={saving || deleting}
            className="text-xs px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-semibold disabled:opacity-60">
            Cancel
          </button>
          <button onClick={save} disabled={saving || deleting || showDeleteConfirm}
            className="text-xs px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Two-step destructive confirm. Cascades to sponsors / prizes
          / donations server-side, so we ask the admin to type the
          name back to gate the action. Stays in the EditPanel
          rather than a modal so the muscle memory of "open edit →
          click delete" doesn't suddenly involve a portal. */}
      {showDeleteConfirm && (
        <div className="border border-red-500/30 bg-red-500/5 rounded-xl p-4 space-y-3">
          <div>
            <p className="text-sm font-bold text-red-300">Delete &ldquo;{campaign.name}&rdquo;?</p>
            <p className="text-[11px] text-red-400/80 mt-1 leading-snug">
              This cascades — every sponsor, prize, and donation tied to this campaign goes with it. Cannot be undone.
            </p>
          </div>
          <EditField label={`Type "${campaign.name}" to confirm`}>
            <input className={editInputCls} value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder={campaign.name} />
          </EditField>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText('') }} disabled={deleting}
              className="text-xs px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-semibold disabled:opacity-60">
              Back
            </button>
            <button onClick={destroy} disabled={deleting || deleteConfirmText.trim() !== campaign.name.trim()}
              className="text-xs px-3 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-bold disabled:opacity-40 disabled:cursor-not-allowed">
              {deleting ? 'Deleting…' : 'Delete permanently'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const editInputCls = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500'

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  )
}
