'use client'

import { useState } from 'react'
import { toast } from 'sonner'

interface Props {
  slug: string
  initialDescription: string | null
  canEdit: boolean
}

// "About this club" card with inline editing for admins/moderators —
// same pattern as ClubRulesEditor, so club copy is fixable on the spot
// without a round-trip through the admin panel.
export default function ClubAboutEditor({ slug, initialDescription, canEdit }: Props) {
  const [description, setDescription] = useState<string | null>(initialDescription)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(initialDescription ?? '')
  const [saving, setSaving]   = useState(false)

  if (!description && !canEdit) return null

  async function save() {
    if (saving) return
    if (!draft.trim()) { toast.error('Description cannot be empty'); return }
    setSaving(true)
    try {
      const res = await fetch(`/app/api/clubs/${slug}/description`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: draft }),
      })
      if (res.ok) {
        setDescription(draft.trim())
        setEditing(false)
        toast.success('Description updated')
      } else {
        const d = await res.json().catch(() => null)
        toast.error(d?.error ?? 'Failed to save')
      }
    } catch {
      toast.error('Network error — check your connection')
    }
    setSaving(false)
  }

  return (
    <div className="bg-white rounded-2xl shadow-card p-8 mb-8">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2 className="text-xl font-bold text-gray-900">About this club</h2>
        {canEdit && !editing && (
          <button
            onClick={() => { setDraft(description ?? ''); setEditing(true) }}
            aria-label="Edit description"
            className="flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-amber-600 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={6}
            maxLength={2000}
            autoFocus
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-700 leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">{draft.length}/2000</span>
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} disabled={saving}
                className="px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={save} disabled={saving || !draft.trim()}
                className="px-4 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-xl transition-colors disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : description ? (
        <p className="text-gray-600 leading-relaxed text-base whitespace-pre-wrap">{description}</p>
      ) : (
        <p className="text-sm text-gray-400 italic">No description yet — add one so members know what this club is about.</p>
      )}
    </div>
  )
}
