'use client'

// Read-only audit log for a campaign — shows the 100 most recent
// admin actions tied to either this campaign (campaign.* with
// matching targetId) or any cup-scoped action (cup.* — currently
// only one cup campaign exists, so the noise is bounded).
//
// Forensic visibility only; no mutations. writeAudit already
// records every meaningful campaign / donation / sponsor /
// prize event, this just surfaces them.

import { useEffect, useState } from 'react'

interface AuditEntry {
  id:          string
  adminName:   string
  action:      string
  description: string | null
  targetType:  string | null
  targetId:    string | null
  meta:        unknown
  createdAt:   string
}

export default function CampaignAuditPanel({ campaignId }: { campaignId: string }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)

  useEffect(() => {
    fetch(`/app/api/admin/campaigns/${campaignId}/audit`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.entries) setEntries(d.entries) })
  }, [campaignId])

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-zinc-800">
        <h2 className="text-sm font-bold text-white">Audit log</h2>
        <p className="text-[10px] text-zinc-500 mt-0.5">
          {entries === null ? 'Loading…' : `${entries.length} most recent admin actions`}
        </p>
      </div>

      {entries !== null && entries.length === 0 && (
        <p className="px-5 py-4 text-sm text-zinc-500">No audit entries yet.</p>
      )}

      <div className="divide-y divide-zinc-800">
        {entries?.map(e => <AuditRow key={e.id} e={e} />)}
      </div>
    </div>
  )
}

// Color the action chip by domain so the eye can scan the column
// — campaign.* are amber, cup.donation_* are emerald, cup.prize_*
// are violet, anything else stays neutral.
function actionPillClass(action: string): string {
  if (action.startsWith('campaign.'))         return 'bg-amber-500/10 text-amber-400'
  if (action.startsWith('cup.donation_'))     return 'bg-emerald-500/10 text-emerald-400'
  if (action.startsWith('cup.prize_'))        return 'bg-violet-500/10 text-violet-400'
  if (action.startsWith('cup.sponsor_'))      return 'bg-sky-500/10 text-sky-400'
  return 'bg-zinc-800 text-zinc-400'
}

function AuditRow({ e }: { e: AuditEntry }) {
  const when = new Date(e.createdAt).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
  return (
    <div className="px-5 py-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${actionPillClass(e.action)}`}>{e.action}</span>
          <span className="text-xs font-semibold text-zinc-300">{e.adminName}</span>
        </div>
        <span className="text-[10px] text-zinc-600 font-mono">{when}</span>
      </div>
      {e.description && <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">{e.description}</p>}
      {e.targetId && (
        <p className="text-[9px] text-zinc-600 mt-1 font-mono truncate">
          {e.targetType ? `${e.targetType} · ` : ''}{e.targetId}
        </p>
      )}
    </div>
  )
}
