'use client'

import { useState, useRef } from 'react'
import { toast } from 'sonner'
import RichText from '@/components/RichText'
import FormatToolbar from '@/components/FormatToolbar'

interface Props {
  slug: string
  initialRules: string | null
  canEdit: boolean
  clubName?: string
  dark?: boolean
}

export default function ClubRulesEditor({ slug, initialRules, canEdit, clubName, dark }: Props) {
  const [rules, setRules]     = useState<string | null>(initialRules)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(initialRules ?? '')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const editRef = useRef<HTMLTextAreaElement>(null)

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

  async function share() {
    if (!rules) return
    const heading = clubName ? `${clubName} — Club Rules` : 'Club Rules'
    const url  = `${window.location.origin}/app/clubs/${slug}#club-rules`
    const text = `${heading}\n\n${rules}`
    // Native share sheet on mobile (WhatsApp etc.); clipboard fallback on desktop.
    if (navigator.share) {
      try { await navigator.share({ title: heading, text, url }) } catch { /* user cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(`${text}\n\n${url}`)
        toast.success('Rules copied — paste them anywhere')
      } catch { toast.error('Could not copy') }
    }
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
        <div className="flex items-center gap-3">
          {rules && !editing && (
            <button onClick={share}
              className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-semibold"
              title="Share these rules">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share
            </button>
          )}
          {canEdit && (
            <button onClick={() => { setEditing(v => !v); setDraft(rules ?? ''); setError('') }}
              className="text-xs text-amber-600 hover:text-amber-700 font-semibold">
              {editing ? 'Cancel' : rules ? 'Edit' : 'Add rules'}
            </button>
          )}
        </div>
      </div>
      {editing ? (
        <div className="space-y-3">
          <div>
            <FormatToolbar getEl={() => editRef.current} value={draft} onChange={setDraft} dark={dark} />
            <textarea ref={editRef} value={draft} onChange={e => setDraft(e.target.value)}
              rows={6} maxLength={5000} placeholder="Write your club rules…"
              className={`w-full text-sm px-3 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 resize-y ${input}`} />
          </div>
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
        <p className={`text-sm ${body} leading-relaxed whitespace-pre-wrap`}><RichText text={rules} /></p>
      ) : canEdit ? (
        <p className={`text-sm ${muted}`}>No club rules yet. Click &ldquo;Add rules&rdquo; to set them.</p>
      ) : null}
    </div>
  )
}
