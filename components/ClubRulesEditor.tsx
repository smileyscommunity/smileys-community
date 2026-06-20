'use client'

import { useState } from 'react'

interface Props {
  slug: string
  initialRules: string | null
  canEdit: boolean
  dark?: boolean
}

export default function ClubRulesEditor({ slug, initialRules, canEdit, dark }: Props) {
  const [rules, setRules]     = useState<string | null>(initialRules)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(initialRules ?? '')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  if (!rules && !canEdit) return null

  async function save() {
    if (saving) return
    setSaving(true); setError('')
    const res = await fetch(`/app/api/clubs/${slug}/rules`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: draft }),
    })
    if (res.ok) { setRules(draft.trim() || null); setEditing(false) }
    else { const d = await res.json(); setError(d.error ?? 'Failed to save') }
    setSaving(false)
  }

  const card  = dark ? 'bg-zinc-900 border border-zinc-800 rounded-2xl p-6' : 'bg-white shadow-card rounded-2xl p-6'
  const title = dark ? 'text-white' : 'text-gray-900'
  const body  = dark ? 'text-zinc-300' : 'text-gray-700'
  const muted = dark ? 'text-zinc-500' : 'text-gray-400'
  const input = dark
    ? 'bg-zinc-800 border border-zinc-700 text-zinc-200 placeholder-zinc-600'
    : 'border border-gray-200 text-gray-800 placeholder-gray-400'

  return (
    <div className={card}>
      <div className="flex items-center justify-between mb-4">
        <h3 className={`font-bold ${title}`}>Club rules</h3>
        {canEdit && (
          <button onClick={() => { setEditing(v => !v); setDraft(rules ?? ''); setError('') }}
            className="text-xs text-amber-600 hover:text-amber-700 font-semibold">
            {editing ? 'Cancel' : rules ? 'Edit' : 'Add rules'}
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-3">
          <textarea value={draft} onChange={e => setDraft(e.target.value)}
            rows={6} maxLength={5000} placeholder="Write your club rules…"
            className={`w-full text-sm px-3 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 resize-y ${input}`} />
          <div className="flex items-center justify-between">
            <span className={`text-xs ${draft.length > 4500 ? 'text-red-500' : muted}`}>{draft.length} / 5000</span>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button onClick={save} disabled={saving}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-40">
              {saving ? 'Saving…' : 'Save rules'}
            </button>
          </div>
        </div>
      ) : rules ? (
        <p className={`text-sm ${body} leading-relaxed whitespace-pre-wrap`}>{rules}</p>
      ) : canEdit ? (
        <p className={`text-sm ${muted}`}>No club rules yet. Click &ldquo;Add rules&rdquo; to set them.</p>
      ) : null}
    </div>
  )
}
